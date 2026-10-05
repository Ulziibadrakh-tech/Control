/**
 * Changes: the atoms of history.
 *
 * Every change records the state it expects *before* and produces *after*, so
 * every change has an exact inverse. A change is an arrow between two states;
 * applying it to any other state is a conflict, never a silent overwrite.
 * Arrows compose and invert, which makes the set of states and changes a
 * groupoid (see docs/ALGEBRA.md).
 */
import type { PersonId, TaskId } from './ids';
import { personEquals, taskEquals, type Person, type State, type Task } from './model';
import type { Action, Perms } from './permissions';
import { err, ok, type Result } from './result';

export type TaskChange =
  | { readonly op: 'task.add'; readonly task: Task }
  | { readonly op: 'task.remove'; readonly task: Task }
  | { readonly op: 'task.edit'; readonly id: TaskId; readonly from: string; readonly to: string }
  | { readonly op: 'task.check'; readonly id: TaskId; readonly from: boolean; readonly to: boolean };

export type PersonChange =
  | { readonly op: 'person.add'; readonly person: Person }
  | { readonly op: 'person.remove'; readonly person: Person }
  | { readonly op: 'person.perms'; readonly id: PersonId; readonly from: Perms; readonly to: Perms };

export type Change = TaskChange | PersonChange;

/** The single thing a change touches. Changes on different entities commute. */
export type EntityKey = `task:${string}` | `person:${string}`;

export type ConflictCode = 'exists' | 'missing' | 'differs';

export interface Conflict {
  readonly code: ConflictCode;
  readonly entity: EntityKey;
  readonly change: Change;
}

export function isTaskChange(c: Change): c is TaskChange {
  return c.op.startsWith('task.');
}

export function taskIdOf(c: TaskChange): TaskId {
  return c.op === 'task.add' || c.op === 'task.remove' ? c.task.id : c.id;
}

export function personIdOf(c: PersonChange): PersonId {
  return c.op === 'person.perms' ? c.id : c.person.id;
}

export function entityOf(c: Change): EntityKey {
  return isTaskChange(c) ? `task:${taskIdOf(c)}` : `person:${personIdOf(c)}`;
}

/** Which permission a change needs. People changes always need "manage". */
export function actionOf(c: Change): Action | 'manage' {
  switch (c.op) {
    case 'task.add':
      return 'add';
    case 'task.remove':
      return 'remove';
    case 'task.edit':
      return 'edit';
    case 'task.check':
      return 'check';
    default:
      return 'manage';
  }
}

export function isNoop(c: Change): boolean {
  return (c.op === 'task.edit' || c.op === 'task.check' || c.op === 'person.perms') && c.from === c.to;
}

export function invert(c: Change): Change {
  switch (c.op) {
    case 'task.add':
      return { op: 'task.remove', task: c.task };
    case 'task.remove':
      return { op: 'task.add', task: c.task };
    case 'task.edit':
      return { op: 'task.edit', id: c.id, from: c.to, to: c.from };
    case 'task.check':
      return { op: 'task.check', id: c.id, from: c.to, to: c.from };
    case 'person.add':
      return { op: 'person.remove', person: c.person };
    case 'person.remove':
      return { op: 'person.add', person: c.person };
    case 'person.perms':
      return { op: 'person.perms', id: c.id, from: c.to, to: c.from };
  }
}

export function changeEquals(a: Change, b: Change): boolean {
  switch (a.op) {
    case 'task.add':
    case 'task.remove':
      return b.op === a.op && taskEquals(a.task, b.task);
    case 'task.edit':
      return b.op === 'task.edit' && a.id === b.id && a.from === b.from && a.to === b.to;
    case 'task.check':
      return b.op === 'task.check' && a.id === b.id && a.from === b.from && a.to === b.to;
    case 'person.add':
    case 'person.remove':
      return b.op === a.op && personEquals(a.person, b.person);
    case 'person.perms':
      return b.op === 'person.perms' && a.id === b.id && a.from === b.from && a.to === b.to;
  }
}

function withTask(s: State, t: Task): State {
  const tasks = new Map(s.tasks);
  tasks.set(t.id, t);
  return { ...s, tasks };
}

function withoutTask(s: State, id: TaskId): State {
  const tasks = new Map(s.tasks);
  tasks.delete(id);
  return { ...s, tasks };
}

function withPerson(s: State, p: Person): State {
  const people = new Map(s.people);
  people.set(p.id, p);
  return { ...s, people };
}

function withoutPerson(s: State, id: PersonId): State {
  const people = new Map(s.people);
  people.delete(id);
  return { ...s, people };
}

/** Apply one change. Fails, without touching anything, if the state is not the one the change expects. */
export function applyChange(s: State, c: Change): Result<State, Conflict> {
  const conflict = (code: ConflictCode) => err({ code, entity: entityOf(c), change: c });
  switch (c.op) {
    case 'task.add':
      return s.tasks.has(c.task.id) ? conflict('exists') : ok(withTask(s, c.task));
    case 'task.remove': {
      const t = s.tasks.get(c.task.id);
      if (!t) return conflict('missing');
      if (!taskEquals(t, c.task)) return conflict('differs');
      return ok(withoutTask(s, t.id));
    }
    case 'task.edit': {
      const t = s.tasks.get(c.id);
      if (!t) return conflict('missing');
      if (t.text !== c.from) return conflict('differs');
      return ok(withTask(s, { ...t, text: c.to }));
    }
    case 'task.check': {
      const t = s.tasks.get(c.id);
      if (!t) return conflict('missing');
      if (t.done !== c.from) return conflict('differs');
      return ok(withTask(s, { ...t, done: c.to }));
    }
    case 'person.add':
      return s.people.has(c.person.id) ? conflict('exists') : ok(withPerson(s, c.person));
    case 'person.remove': {
      const p = s.people.get(c.person.id);
      if (!p) return conflict('missing');
      if (!personEquals(p, c.person)) return conflict('differs');
      return ok(withoutPerson(s, p.id));
    }
    case 'person.perms': {
      const p = s.people.get(c.id);
      if (!p) return conflict('missing');
      if (p.perms !== c.from) return conflict('differs');
      return ok(withPerson(s, { ...p, perms: c.to }));
    }
  }
}
