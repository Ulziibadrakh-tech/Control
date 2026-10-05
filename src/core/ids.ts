/**
 * Identifiers and the injected environment.
 *
 * Ids are branded strings: they are plain strings at runtime, but the compiler
 * will not let a PersonId be passed where a TaskId is expected.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TaskId = Brand<string, 'TaskId'>;
export type PersonId = Brand<string, 'PersonId'>;
export type SuggestionId = Brand<string, 'SuggestionId'>;
export type BatchId = Brand<string, 'BatchId'>;

export const TaskId = (s: string): TaskId => s as TaskId;
export const PersonId = (s: string): PersonId => s as PersonId;
export const SuggestionId = (s: string): SuggestionId => s as SuggestionId;
export const BatchId = (s: string): BatchId => s as BatchId;

/**
 * Everything impure the core needs. Passing it in keeps every core function
 * deterministic and testable: tests use a fake clock and counting ids.
 */
export interface Env {
  now(): number;
  newId(): string;
}

/** RFC 4122 v4 id. Works in insecure contexts (plain http on a LAN), where crypto.randomUUID is missing. */
export function uuid(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // randomUUID throws outside secure contexts in some browsers; fall through.
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const systemEnv: Env = {
  now: () => Date.now(),
  newId: uuid,
};

/** A deterministic environment for tests and for generating the sample history. */
export function fixedEnv(start: number, prefix = 'id'): Env & { advance(ms: number): void; set(t: number): void } {
  let t = start;
  let n = 0;
  return {
    now: () => t,
    newId: () => `${prefix}-${++n}`,
    advance(ms: number) {
      t += ms;
    },
    set(next: number) {
      t = next;
    },
  };
}
