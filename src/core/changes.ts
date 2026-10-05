/**
 * Changes: the atoms of history.
 *
 * Every change records the state it expects *before* and produces *after*, so
 * every change has an exact inverse. A change is an arrow between two states;
 * applying it to any other state is a conflict, never a silent overwrite.
 * Arrows compose and invert, which makes the set of states and changes a
 * groupoid (see docs/ALGEBRA.md).
 *
 * Every change touches exactly one entity (a task, a step or a person) and
 * reads and writes only that entity, so changes to different entities
 * commute. Rules that relate entities — a step's task exists, it only waits
 * for steps of the same task, no circles, done steps never wait for undone
 * ones — are invariants of states, checked at version boundaries (plan.ts),
 * not preconditions of single changes. That keeps the commutation law exact.
 */
import type { PersonId, StepId, TaskId } from './ids';
import { personEquals, sameIds, stepEquals, taskEquals, type Person, type State, type Step, type Task } from './model';
import type { Action, Perms } from './permissions';
import { err, ok, type Result } from './result';

export type TaskChange =
  | { readonly op: 'task.add'; readonly task: Task }
  | { readonly op: 'task.remove'; readonly task: Task }
  | { readonly op: 'task.edit'; readonly id: TaskId; readonly from: string; readonly to: string }
  | { readonly op: 'task.check'; readonly id: TaskId; readonly from: boolean; readonly to: boolean };

export type StepChange =
  | { readonly op: 'step.add'; readonly step: Step }
  | { readonly op: 'step.remove'; readonly step: Step }
  | { readonly op: 'step.edit'; readonly id: StepId; readonly from: string; readonly to: string }
  | { readonly op: 'step.check'; readonly id: StepId; readonly from: boolean; readonly to: boolean }
  | { readonly op: 'step.assign'; readonly id: StepId; readonly from: PersonId; readonly to: PersonId }
  | { readonly op: 'step.deps'; readonly id: StepId; readonly from: readonly StepId[]; readonly to: readonly StepId[] };

export type PersonChange =
  | { readonly op: 'person.add'; readonly person: Person }
  | { readonly op: 'person.remove'; readonly person: Person }
  | { readonly op: 'person.perms'; readonly id: PersonId; readonly from: Perms; readonly to: Perms };

export type Change = TaskChange | StepChange | PersonChange;

/** A step change that sets one field. */
export type StepFieldChange = Extract<StepChange, { readonly id: StepId }>;

/** The single thing a change touches. Changes on different entities commute. */
export type EntityKey = `task:${string}` | `step:${string}` | `person:${string}`;

export type ConflictCode = 'exists' | 'missing' | 'differs';

export interface Conflict {
  readonly code: ConflictCode;
  readonly entity: EntityKey;
  readonly change: Change;
}

export function isTaskChange(c: Change): c is TaskChange {
  return c.op.startsWith('task.');
}

export function isStepChange(c: Change): c is StepChange {
  return c.op.startsWith('step.');
}

export function isPersonChange(c: Change): c is PersonChange {
  return c.op.startsWith('person.');
}

export function taskIdOf(c: TaskChange): TaskId {
  return c.op === 'task.add' || c.op === 'task.remove' ? c.task.id : c.id;
}

export function stepIdOf(c: StepChange): StepId {
  return c.op === 'step.add' || c.op === 'step.remove' ? c.step.id : c.id;
}

export function personIdOf(c: PersonChange): PersonId {
  return c.op === 'person.perms' ? c.id : c.person.id;
}

export function entityOf(c: Change): EntityKey {
  if (isTaskChange(c)) return `task:${taskIdOf(c)}`;
  if (isStepChange(c)) return `step:${stepIdOf(c)}`;
  return `person:${personIdOf(c)}`;
}

/** Which kind of permission a change needs. Changing a plan's shape or people counts as "edit"; people need "manage". */
export function actionOf(c: Change): Action | 'manage' {
  switch (c.op) {
    case 'task.add':
    case 'step.add':
      return 'add';
    case 'task.remove':
    case 'step.remove':
      return 'remove';
    case 'task.edit':
    case 'step.edit':
    case 'step.assign':
    case 'step.deps':
      return 'edit';
    case 'task.check':
    case 'step.check':
      return 'check';
    default:
      return 'manage';
  }
}

export function isNoop(c: Change): boolean {
  switch (c.op) {
    case 'task.edit':
    case 'task.check':
    case 'step.edit':
    case 'step.check':
    case 'step.assign':
    case 'person.perms':
      return c.from === c.to;
    case 'step.deps':
      return sameIds(c.from, c.to);
    default:
      return false;
  }
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
    case 'step.add':
      return { op: 'step.remove', step: c.step };
    case 'step.remove':
      return { op: 'step.add', step: c.step };
    case 'step.edit':
      return { op: 'step.edit', id: c.id, from: c.to, to: c.from };
    case 'step.check':
      return { op: 'step.check', id: c.id, from: c.to, to: c.from };
    case 'step.assign':
      return { op: 'step.assign', id: c.id, from: c.to, to: c.from };
    case 'step.deps':
      return { op: 'step.deps', id: c.id, from: c.to, to: c.from };
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
    case 'step.add':
    case 'step.remove':
      return b.op === a.op && stepEquals(a.step, b.step);
    case 'step.edit':
      return b.op === 'step.edit' && a.id === b.id && a.from === b.from && a.to === b.to;
    case 'step.check':
      return b.op === 'step.check' && a.id === b.id && a.from === b.from && a.to === b.to;
    case 'step.assign':
      return b.op === 'step.assign' && a.id === b.id && a.from === b.from && a.to === b.to;
    case 'step.deps':
      return b.op === 'step.deps' && a.id === b.id && sameIds(a.from, b.from) && sameIds(a.to, b.to);
    case 'person.add':
    case 'person.remove':
      return b.op === a.op && personEquals(a.person, b.person);
    case 'person.perms':
      return b.op === 'person.perms' && a.id === b.id && a.from === b.from && a.to === b.to;
  }
}

/* ------------------------------------------------- one field of a step */

/** Does the step currently hold this field change's `from` (or `to`) value? */
export function stepHolds(st: Step, c: StepFieldChange, which: 'from' | 'to'): boolean {
  switch (c.op) {
    case 'step.edit':
      return st.text === c[which];
    case 'step.check':
      return st.done === c[which];
    case 'step.assign':
      return st.who === c[which];
    case 'step.deps':
      return sameIds(st.after, c[which]);
  }
}

/** The step with this field change's `from` (or `to`) value written into it. */
export function stepWith(st: Step, c: StepFieldChange, which: 'from' | 'to'): Step {
  switch (c.op) {
    case 'step.edit':
      return { ...st, text: c[which] };
    case 'step.check':
      return { ...st, done: c[which] };
    case 'step.assign':
      return { ...st, who: c[which] };
    case 'step.deps':
      return { ...st, after: c[which] };
  }
}

/** The same field change, starting from the step's current value instead. */
export function fromCurrent(st: Step, c: StepFieldChange): StepFieldChange {
  switch (c.op) {
    case 'step.edit':
      return { ...c, from: st.text };
    case 'step.check':
      return { ...c, from: st.done };
    case 'step.assign':
      return { ...c, from: st.who };
    case 'step.deps':
      return { ...c, from: st.after };
  }
}

/** The field changes that turn step `a` into step `b` (same identity). */
export function stepDiff(a: Step, b: Step): StepFieldChange[] {
  const out: StepFieldChange[] = [];
  if (a.text !== b.text) out.push({ op: 'step.edit', id: a.id, from: a.text, to: b.text });
  if (a.done !== b.done) out.push({ op: 'step.check', id: a.id, from: a.done, to: b.done });
  if (a.who !== b.who) out.push({ op: 'step.assign', id: a.id, from: a.who, to: b.who });
  if (!sameIds(a.after, b.after)) out.push({ op: 'step.deps', id: a.id, from: a.after, to: b.after });
  return out;
}

/** Same step apart from the fields that field changes can set. */
export function sameStepIdentity(a: Step, b: Step): boolean {
  return a.id === b.id && a.task === b.task && a.n === b.n && a.createdAt === b.createdAt && a.createdBy === b.createdBy;
}

/* ------------------------------------------------------------ applying */

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

function withStep(s: State, st: Step): State {
  const steps = new Map(s.steps);
  steps.set(st.id, st);
  return { ...s, steps };
}

function withoutStep(s: State, id: StepId): State {
  const steps = new Map(s.steps);
  steps.delete(id);
  return { ...s, steps };
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
    case 'step.add':
      return s.steps.has(c.step.id) ? conflict('exists') : ok(withStep(s, c.step));
    case 'step.remove': {
      const st = s.steps.get(c.step.id);
      if (!st) return conflict('missing');
      if (!stepEquals(st, c.step)) return conflict('differs');
      return ok(withoutStep(s, st.id));
    }
    case 'step.edit':
    case 'step.check':
    case 'step.assign':
    case 'step.deps': {
      const st = s.steps.get(c.id);
      if (!st) return conflict('missing');
      if (!stepHolds(st, c, 'from')) return conflict('differs');
      return ok(withStep(s, stepWith(st, c, 'to')));
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
