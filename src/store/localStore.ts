/**
 * WorkspaceStore on top of localStorage.
 *
 * - Never crashes on storage problems: if storage is missing, blocked or full,
 *   it keeps working in memory and says so through status().
 * - Never destroys data it cannot read: unreadable data is copied aside first;
 *   data from a newer app version is left alone and never overwritten, even
 *   when another tab writes it later.
 * - Several tabs stay in step: every save also writes a unique token. Before
 *   each write the store checks the token; if another tab saved since, it
 *   reloads first, so a write always starts from the newest saved version.
 *   Comparing tokens (not counters) means two tabs can never both believe
 *   they hold the latest copy.
 */
import { hydrate, uuid, type Workspace } from '../core';
import { decode, encode } from './schema';
import type { StoreStatus, WorkspaceStore } from './store';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage if it really works here, otherwise null. Probing catches private modes that throw on write. */
export function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const s = window.localStorage;
    const probe = '__control_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export interface LocalStoreOptions {
  readonly key: string;
  readonly storage: StorageLike | null;
  /** Builds the workspace to start with when nothing usable is saved. */
  readonly seed: () => Workspace;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

type Loaded = { kind: 'ok'; ws: Workspace; rev: number } | { kind: 'newer' } | { kind: 'invalid' };

export function createLocalStore(opts: LocalStoreOptions): WorkspaceStore {
  const { key, storage, seed } = opts;
  const tokenKey = `${key}.rev`;
  const now = opts.now ?? (() => Date.now());
  const warn = opts.warn ?? ((m: string) => console.warn(`[control] ${m}`));
  const listeners = new Set<() => void>();

  let ws: Workspace;
  let rev = 0;
  /** The token of the copy in storage that our in-memory state is based on. */
  let basedOn: string | null = null;
  let status: StoreStatus = { persistent: storage !== null, recovered: false, newerData: false };

  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };

  const parse = (raw: string): Loaded => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'invalid' };
    }
    const decoded = decode(parsed);
    if (!decoded.ok) {
      if (decoded.error.kind === 'newer') return { kind: 'newer' };
      warn(`saved data is invalid (${decoded.error.why})`);
      return { kind: 'invalid' };
    }
    try {
      return { kind: 'ok', ws: hydrate(decoded.value.data), rev: decoded.value.rev };
    } catch (e) {
      warn(`saved history does not replay: ${String(e)}`);
      return { kind: 'invalid' };
    }
  };

  const keepAside = (raw: string): void => {
    try {
      storage?.setItem(`${key}.unreadable.${now()}`, raw);
    } catch {
      // Nowhere to keep a copy; carry on rather than block the person.
    }
  };

  /** Save the in-memory workspace. Leaves `basedOn` alone if the save fails, so nothing is reloaded over it. */
  const save = (): void => {
    if (!storage || status.newerData) return;
    const token = `${rev}:${uuid()}`;
    try {
      storage.setItem(key, JSON.stringify(encode(ws.data, rev, now())));
      storage.setItem(tokenKey, token);
      basedOn = token;
      if (!status.persistent) status = { ...status, persistent: true };
    } catch (e) {
      if (status.persistent) status = { ...status, persistent: false };
      warn(`could not save: ${String(e)}`);
    }
  };

  /**
   * Bring in whatever another tab saved since we last read or wrote.
   * Returns true when something visible changed (the list or the status).
   */
  const refresh = (): boolean => {
    if (!storage || status.newerData) return false;
    const token = read(tokenKey);
    if (token === basedOn) return false;
    const raw = read(key);
    if (raw === null) return false;
    const loaded = parse(raw);
    switch (loaded.kind) {
      case 'ok':
        ws = loaded.ws;
        rev = loaded.rev;
        basedOn = token;
        return true;
      case 'newer':
        // A newer version of the app saved this. Hands off: stop saving from here on.
        status = { ...status, newerData: true, persistent: false };
        basedOn = token;
        return true;
      case 'invalid':
        // Someone wrote something we cannot read. Keep a copy, then carry on with ours.
        keepAside(raw);
        status = { ...status, recovered: true };
        basedOn = token;
        rev = Math.max(rev, Number.parseInt(token ?? '0', 10) || 0);
        return true;
    }
  };

  const start = (): void => {
    const raw = read(key);
    if (raw === null) {
      ws = seed();
      rev = 1;
      save();
      return;
    }
    const loaded = parse(raw);
    if (loaded.kind === 'ok') {
      ws = loaded.ws;
      rev = loaded.rev;
      basedOn = read(tokenKey);
      return;
    }
    if (loaded.kind === 'newer') {
      ws = seed();
      rev = 0;
      basedOn = read(tokenKey);
      status = { persistent: false, recovered: false, newerData: true };
      return;
    }
    keepAside(raw);
    ws = seed();
    rev = 1;
    status = { ...status, recovered: true };
    save();
  };

  start();

  return {
    get: () => ws,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    transact(fn) {
      const changedElsewhere = refresh();
      const { next, result } = fn(ws);
      if (next !== null && next !== ws) {
        ws = next;
        rev += 1;
        save();
        emit();
      } else if (changedElsewhere) {
        emit();
      }
      return result;
    },
    replace(next) {
      refresh();
      ws = next;
      rev += 1;
      save();
      emit();
    },
    sync() {
      if (refresh()) emit();
    },
  };
}

/** A storage that only lives in memory. Used in tests. */
export function memoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    dump: () => Object.fromEntries(m),
  };
}
