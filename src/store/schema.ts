/**
 * The stored shape of a workspace, and a strict decoder for it.
 *
 * Stored data is versioned (`schema`). Permissions are stored as readable atom
 * names, never as bit masks, so the in-memory representation can change
 * without a migration. Anything that does not decode is reported, not guessed.
 */
import {
  BatchId,
  HUES,
  PersonId,
  SuggestionId,
  TaskId,
  fromAtoms,
  isAtom,
  toAtoms,
  type Batch,
  type BatchStatus,
  type Cause,
  type Change,
  type Hue,
  type Origin,
  type Perms,
  type Person,
  type Resolution,
  type Suggestion,
  type Task,
  type Version,
  type WorkspaceData,
} from '../core';
import { err, ok, type Result } from '../core/result';

export const SCHEMA = 1;

export interface Persisted {
  readonly schema: number;
  readonly rev: number;
  readonly savedAt: number;
  readonly workspace: unknown;
}

export type DecodeFailure = { readonly kind: 'newer'; readonly schema: number } | { readonly kind: 'invalid'; readonly why: string };

/* ----------------------------------------------------------------- encode */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const permsOut = (p: Perms): Json => toAtoms(p);

const personOut = (p: Person): Json => ({ id: p.id, name: p.name, hue: p.hue, perms: permsOut(p.perms) });

const taskOut = (t: Task): Json => ({
  id: t.id,
  text: t.text,
  done: t.done,
  createdAt: t.createdAt,
  createdBy: t.createdBy,
});

function changeOut(c: Change): Json {
  switch (c.op) {
    case 'task.add':
    case 'task.remove':
      return { op: c.op, task: taskOut(c.task) };
    case 'task.edit':
      return { op: c.op, id: c.id, from: c.from, to: c.to };
    case 'task.check':
      return { op: c.op, id: c.id, from: c.from, to: c.to };
    case 'person.add':
    case 'person.remove':
      return { op: c.op, person: personOut(c.person) };
    case 'person.perms':
      return { op: c.op, id: c.id, from: permsOut(c.from), to: permsOut(c.to) };
  }
}

const causeOut = (c: Cause): Json => (c.type === 'suggestion' ? { ...c, contributors: [...c.contributors] } : { ...c });

const versionOut = (v: Version): Json => ({
  n: v.n,
  at: v.at,
  by: v.by,
  changes: v.changes.map(changeOut),
  cause: causeOut(v.cause),
});

const batchOut = (b: Batch): Json => ({
  id: b.id,
  by: b.by,
  at: b.at,
  changes: b.changes.map(changeOut),
  origin: { ...b.origin },
  status: b.status,
  decidedBy: b.decidedBy,
  decidedAt: b.decidedAt,
});

const suggestionOut = (s: Suggestion): Json => ({
  id: s.id,
  openedAt: s.openedAt,
  batches: s.batches.map(batchOut),
  resolution: s.resolution ? { ...s.resolution } : null,
});

export function encode(data: WorkspaceData, rev: number, savedAt: number): Persisted {
  return {
    schema: SCHEMA,
    rev,
    savedAt,
    workspace: {
      id: data.id,
      log: data.log.map(versionOut),
      suggestions: data.suggestions.map(suggestionOut),
    },
  };
}

/* ----------------------------------------------------------------- decode */

class DecodeError extends Error {}

const fail = (path: string, what: string): never => {
  throw new DecodeError(`${path}: expected ${what}`);
};

function obj(x: unknown, path: string): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : fail(path, 'an object');
}
const str = (x: unknown, path: string): string => (typeof x === 'string' ? x : fail(path, 'text'));
const num = (x: unknown, path: string): number => (typeof x === 'number' && Number.isFinite(x) ? x : fail(path, 'a number'));
const bool = (x: unknown, path: string): boolean => (typeof x === 'boolean' ? x : fail(path, 'true or false'));
const arr = (x: unknown, path: string): unknown[] => (Array.isArray(x) ? x : fail(path, 'a list'));
const nullable = <T>(x: unknown, path: string, f: (x: unknown, p: string) => T): T | null => (x === null ? null : f(x, path));

function oneOf<T extends string>(x: unknown, values: readonly T[], path: string): T {
  return typeof x === 'string' && (values as readonly string[]).includes(x) ? (x as T) : fail(path, values.join(' | '));
}

function perms(x: unknown, path: string): Perms {
  return fromAtoms(arr(x, path).map((a, i) => (isAtom(a) ? a : fail(`${path}[${i}]`, 'a permission name'))));
}

function person(x: unknown, path: string): Person {
  const o = obj(x, path);
  return {
    id: PersonId(str(o.id, `${path}.id`)),
    name: str(o.name, `${path}.name`),
    hue: oneOf<Hue>(o.hue, HUES, `${path}.hue`),
    perms: perms(o.perms, `${path}.perms`),
  };
}

function task(x: unknown, path: string): Task {
  const o = obj(x, path);
  return {
    id: TaskId(str(o.id, `${path}.id`)),
    text: str(o.text, `${path}.text`),
    done: bool(o.done, `${path}.done`),
    createdAt: num(o.createdAt, `${path}.createdAt`),
    createdBy: PersonId(str(o.createdBy, `${path}.createdBy`)),
  };
}

function change(x: unknown, path: string): Change {
  const o = obj(x, path);
  const op = str(o.op, `${path}.op`);
  switch (op) {
    case 'task.add':
    case 'task.remove':
      return { op, task: task(o.task, `${path}.task`) };
    case 'task.edit':
      return { op, id: TaskId(str(o.id, `${path}.id`)), from: str(o.from, `${path}.from`), to: str(o.to, `${path}.to`) };
    case 'task.check':
      return { op, id: TaskId(str(o.id, `${path}.id`)), from: bool(o.from, `${path}.from`), to: bool(o.to, `${path}.to`) };
    case 'person.add':
    case 'person.remove':
      return { op, person: person(o.person, `${path}.person`) };
    case 'person.perms':
      return {
        op,
        id: PersonId(str(o.id, `${path}.id`)),
        from: perms(o.from, `${path}.from`),
        to: perms(o.to, `${path}.to`),
      };
    default:
      return fail(`${path}.op`, 'a known change');
  }
}

function cause(x: unknown, path: string): Cause {
  const o = obj(x, path);
  const type = str(o.type, `${path}.type`);
  switch (type) {
    case 'setup':
    case 'direct':
      return { type };
    case 'undo':
      return { type, of: num(o.of, `${path}.of`) };
    case 'restore':
      return { type, to: num(o.to, `${path}.to`) };
    case 'suggestion':
      return {
        type,
        id: SuggestionId(str(o.id, `${path}.id`)),
        contributors: arr(o.contributors, `${path}.contributors`).map((c, i) => PersonId(str(c, `${path}.contributors[${i}]`))),
      };
    default:
      return fail(`${path}.type`, 'a known cause');
  }
}

function origin(x: unknown, path: string): Origin {
  const o = obj(x, path);
  const type = str(o.type, `${path}.type`);
  if (type === 'action') return { type };
  if (type === 'undo') return { type, of: num(o.of, `${path}.of`) };
  if (type === 'restore') return { type, to: num(o.to, `${path}.to`) };
  return fail(`${path}.type`, 'a known origin');
}

const STATUSES: readonly BatchStatus[] = ['pending', 'withdrawn', 'declined', 'applied', 'skipped'];

function batch(x: unknown, path: string): Batch {
  const o = obj(x, path);
  return {
    id: BatchId(str(o.id, `${path}.id`)),
    by: PersonId(str(o.by, `${path}.by`)),
    at: num(o.at, `${path}.at`),
    changes: arr(o.changes, `${path}.changes`).map((c, i) => change(c, `${path}.changes[${i}]`)),
    origin: origin(o.origin, `${path}.origin`),
    status: oneOf(o.status, STATUSES, `${path}.status`),
    decidedBy: nullable(o.decidedBy, `${path}.decidedBy`, (v, p) => PersonId(str(v, p))),
    decidedAt: nullable(o.decidedAt, `${path}.decidedAt`, num),
  };
}

function resolution(x: unknown, path: string): Resolution {
  const o = obj(x, path);
  const type = str(o.type, `${path}.type`);
  const at = num(o.at, `${path}.at`);
  if (type === 'withdrawn') return { type, at };
  const by = PersonId(str(o.by, `${path}.by`));
  if (type === 'declined') return { type, by, at };
  if (type === 'accepted') return { type, by, at, version: num(o.version, `${path}.version`) };
  return fail(`${path}.type`, 'a known resolution');
}

function suggestion(x: unknown, path: string): Suggestion {
  const o = obj(x, path);
  return {
    id: SuggestionId(str(o.id, `${path}.id`)),
    openedAt: num(o.openedAt, `${path}.openedAt`),
    batches: arr(o.batches, `${path}.batches`).map((b, i) => batch(b, `${path}.batches[${i}]`)),
    resolution: nullable(o.resolution, `${path}.resolution`, resolution),
  };
}

function version(x: unknown, path: string): Version {
  const o = obj(x, path);
  return {
    n: num(o.n, `${path}.n`),
    at: num(o.at, `${path}.at`),
    by: PersonId(str(o.by, `${path}.by`)),
    changes: arr(o.changes, `${path}.changes`).map((c, i) => change(c, `${path}.changes[${i}]`)),
    cause: cause(o.cause, `${path}.cause`),
  };
}

/** Upgrade older stored shapes step by step. Schema 1 is the first, so there is nothing to do yet. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

export function decode(raw: unknown): Result<{ data: WorkspaceData; rev: number }, DecodeFailure> {
  try {
    const top = migrate(obj(raw, 'stored'));
    const schema = num(top.schema, 'stored.schema');
    if (schema > SCHEMA) return err({ kind: 'newer', schema });
    const w = obj(top.workspace, 'workspace');
    const data: WorkspaceData = {
      id: str(w.id, 'workspace.id'),
      log: arr(w.log, 'workspace.log').map((v, i) => version(v, `log[${i}]`)),
      suggestions: arr(w.suggestions, 'workspace.suggestions').map((s, i) => suggestion(s, `suggestions[${i}]`)),
    };
    return ok({ data, rev: num(top.rev, 'stored.rev') });
  } catch (e) {
    if (e instanceof DecodeError) return err({ kind: 'invalid', why: e.message });
    throw e;
  }
}
