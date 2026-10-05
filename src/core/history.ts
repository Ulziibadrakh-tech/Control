/**
 * The published history: an append-only log of versions.
 *
 * The current state is never stored; it is the fold of every version over the
 * empty state. That single rule gives the audit trail, "what changed", the
 * state at any moment, and undo, all from the same data.
 */
import { applySet, type ChangeSet, type SetConflict } from './changeset';
import { entityOf, isStepChange, isTaskChange, stepIdOf, type EntityKey, type StepChange, type TaskChange } from './changes';
import type { PersonId, StepId, SuggestionId, TaskId } from './ids';
import { EMPTY_STATE, type State } from './model';
import { err, ok, type Result } from './result';

export type Cause =
  | { readonly type: 'setup' }
  | { readonly type: 'direct' }
  | { readonly type: 'undo'; readonly of: number }
  | { readonly type: 'restore'; readonly to: number }
  | { readonly type: 'suggestion'; readonly id: SuggestionId; readonly contributors: readonly PersonId[] };

export interface Version {
  /** 1, 2, 3, … Version 0 is the empty state. */
  readonly n: number;
  readonly at: number;
  /** Who published it (for an accepted suggestion: the person who said OK). */
  readonly by: PersonId;
  readonly changes: ChangeSet;
  readonly cause: Cause;
}

/** Facts about a task gathered from history. Kept for removed tasks too. */
export interface TaskFacts {
  readonly id: TaskId;
  readonly createdAt: number;
  readonly createdBy: PersonId;
  readonly text: string;
  readonly done: boolean;
  readonly doneAt: number | null;
  readonly doneBy: PersonId | null;
  readonly removedAt: number | null;
  readonly removedBy: PersonId | null;
  readonly edits: number;
  readonly versions: readonly number[];
}

/** Facts about a step gathered from history. Kept for removed steps too. */
export interface StepFacts {
  readonly id: StepId;
  readonly task: TaskId;
  readonly n: number;
  readonly text: string;
  readonly who: PersonId;
  readonly done: boolean;
  readonly doneAt: number | null;
  readonly doneBy: PersonId | null;
  readonly removedAt: number | null;
}

export interface Replay {
  readonly head: number;
  readonly state: State;
  readonly facts: ReadonlyMap<TaskId, TaskFacts>;
  readonly stepFacts: ReadonlyMap<StepId, StepFacts>;
  /** The last version that touched each entity. */
  readonly lastTouch: ReadonlyMap<EntityKey, number>;
}

export const EMPTY_REPLAY: Replay = {
  head: 0,
  state: EMPTY_STATE,
  facts: new Map(),
  stepFacts: new Map(),
  lastTouch: new Map(),
};

export class LogCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogCorruptError';
  }
}

/** Append one version. Fails if it does not follow the head or does not fit the state. */
export function advance(r: Replay, v: Version): Result<Replay, SetConflict | 'out-of-order'> {
  if (v.n !== r.head + 1) return err('out-of-order');
  const applied = applySet(r.state, v.changes);
  if (!applied.ok) return err(applied.error);
  const facts = new Map(r.facts);
  const stepFacts = v.changes.some(isStepChange) ? new Map(r.stepFacts) : r.stepFacts;
  const lastTouch = new Map(r.lastTouch);
  for (const c of v.changes) {
    lastTouch.set(entityOf(c), v.n);
    if (isTaskChange(c)) recordFact(facts, c, v);
    else if (isStepChange(c)) recordStepFact(stepFacts as Map<StepId, StepFacts>, c, v);
  }
  return ok({ head: v.n, state: applied.value, facts, stepFacts, lastTouch });
}

export function step(r: Replay, v: Version): Replay {
  const next = advance(r, v);
  if (!next.ok) {
    const why = next.error === 'out-of-order' ? 'out of order' : `conflict (${next.error.code} on ${next.error.entity})`;
    throw new LogCorruptError(`Version ${v.n} cannot be replayed: ${why}`);
  }
  return next.value;
}

export function replay(log: readonly Version[]): Replay {
  return log.reduce(step, EMPTY_REPLAY);
}

export function stateAt(log: readonly Version[], n: number): State {
  return replay(log.slice(0, Math.max(0, n))).state;
}

function recordFact(facts: Map<TaskId, TaskFacts>, c: TaskChange, v: Version): void {
  const id = c.op === 'task.add' || c.op === 'task.remove' ? c.task.id : c.id;
  const prev = facts.get(id);
  const versions = prev ? (prev.versions.at(-1) === v.n ? prev.versions : [...prev.versions, v.n]) : [v.n];
  switch (c.op) {
    case 'task.add': {
      const t = c.task;
      facts.set(id, {
        id,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
        text: t.text,
        done: t.done,
        doneAt: t.done ? (prev?.doneAt ?? v.at) : null,
        doneBy: t.done ? (prev?.doneBy ?? v.by) : null,
        removedAt: null,
        removedBy: null,
        edits: prev?.edits ?? 0,
        versions,
      });
      return;
    }
    case 'task.remove':
      if (prev) facts.set(id, { ...prev, removedAt: v.at, removedBy: v.by, versions });
      return;
    case 'task.edit':
      if (prev) facts.set(id, { ...prev, text: c.to, edits: prev.edits + 1, versions });
      return;
    case 'task.check':
      if (prev)
        facts.set(id, {
          ...prev,
          done: c.to,
          doneAt: c.to ? v.at : null,
          doneBy: c.to ? v.by : null,
          versions,
        });
      return;
  }
}

function recordStepFact(facts: Map<StepId, StepFacts>, c: StepChange, v: Version): void {
  const id = stepIdOf(c);
  const prev = facts.get(id);
  switch (c.op) {
    case 'step.add': {
      const st = c.step;
      facts.set(id, {
        id,
        task: st.task,
        n: st.n,
        text: st.text,
        who: st.who,
        done: st.done,
        doneAt: st.done ? (prev?.doneAt ?? v.at) : null,
        doneBy: st.done ? (prev?.doneBy ?? v.by) : null,
        removedAt: null,
      });
      return;
    }
    case 'step.remove':
      if (prev) facts.set(id, { ...prev, removedAt: v.at });
      return;
    case 'step.edit':
      if (prev) facts.set(id, { ...prev, text: c.to });
      return;
    case 'step.assign':
      if (prev) facts.set(id, { ...prev, who: c.to });
      return;
    case 'step.check':
      if (prev) facts.set(id, { ...prev, done: c.to, doneAt: c.to ? v.at : null, doneBy: c.to ? v.by : null });
      return;
    case 'step.deps':
      return;
  }
}
