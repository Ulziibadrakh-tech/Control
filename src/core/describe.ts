/**
 * Plain-language descriptions of history, as structured data.
 *
 * The core never produces sentences: it produces Phrases, and the interface
 * turns them into words in the person's language. That keeps translation in
 * one place and keeps the core testable.
 */
import { applyChange, isPersonChange, isStepChange, isTaskChange, stepIdOf, taskIdOf, type Change } from './changes';
import type { ChangeSet } from './changeset';
import { EMPTY_REPLAY, step, type Replay, type Version } from './history';
import type { PersonId, StepId, TaskId } from './ids';
import type { State } from './model';
import type { Perms } from './permissions';
import { changeVisibleTo } from './plan';
import type { Suggestion } from './suggestions';
import { planUndo, type Refusal, type Workspace } from './workspace';

export type Phrase =
  | { readonly kind: 'added'; readonly text: string; readonly steps: number }
  | { readonly kind: 'removed'; readonly text: string; readonly steps: number }
  | { readonly kind: 'edited'; readonly from: string; readonly to: string }
  | { readonly kind: 'ticked'; readonly text: string }
  | { readonly kind: 'unticked'; readonly text: string }
  | { readonly kind: 'step-added'; readonly task: string; readonly text: string; readonly who: PersonId }
  | { readonly kind: 'step-removed'; readonly task: string; readonly text: string }
  | { readonly kind: 'step-edited'; readonly task: string; readonly from: string; readonly to: string }
  | { readonly kind: 'step-ticked'; readonly task: string; readonly text: string }
  | { readonly kind: 'step-unticked'; readonly task: string; readonly text: string }
  | { readonly kind: 'step-assigned'; readonly task: string; readonly text: string; readonly to: PersonId }
  | { readonly kind: 'step-waits'; readonly task: string; readonly text: string; readonly count: number }
  | { readonly kind: 'joined'; readonly name: string; readonly perms: Perms }
  | { readonly kind: 'left'; readonly name: string }
  | { readonly kind: 'role'; readonly name: string; readonly from: Perms; readonly to: Perms };

export interface Lookups {
  readonly task: (id: TaskId) => string | undefined;
  readonly step: (id: StepId) => { readonly text: string; readonly task: TaskId } | undefined;
}

const NONE_LOOKUPS: Lookups = { task: () => undefined, step: () => undefined };

/** Lookups for things that may since have been removed, from the facts history keeps. */
export function lookupsOf(r: Replay): Lookups {
  return {
    task: (id) => r.facts.get(id)?.text,
    step: (id) => {
      const f = r.stepFacts.get(id);
      return f ? { text: f.text, task: f.task } : undefined;
    },
  };
}

function stepInfo(c: Change, before: State, look: Lookups): { text: string; task: string } {
  if (!isStepChange(c)) return { text: '…', task: '…' };
  const st = c.op === 'step.add' || c.op === 'step.remove' ? c.step : before.steps.get(c.id);
  const info = st ?? look.step(stepIdOf(c));
  const taskId = st?.task ?? info?.task;
  const task = (taskId && (before.tasks.get(taskId)?.text ?? look.task(taskId))) || '…';
  return { text: info?.text ?? '…', task };
}

export function phrase(c: Change, before: State, look: Lookups = NONE_LOOKUPS): Phrase {
  switch (c.op) {
    case 'task.add':
      return { kind: 'added', text: c.task.text, steps: 0 };
    case 'task.remove':
      return { kind: 'removed', text: c.task.text, steps: 0 };
    case 'task.edit':
      return { kind: 'edited', from: c.from, to: c.to };
    case 'task.check': {
      const text = before.tasks.get(c.id)?.text ?? look.task(c.id) ?? '…';
      return { kind: c.to ? 'ticked' : 'unticked', text };
    }
    case 'step.add':
      return { kind: 'step-added', ...stepInfo(c, before, look), who: c.step.who };
    case 'step.remove':
      return { kind: 'step-removed', ...stepInfo(c, before, look) };
    case 'step.edit':
      return { kind: 'step-edited', task: stepInfo(c, before, look).task, from: c.from, to: c.to };
    case 'step.check':
      return { kind: c.to ? 'step-ticked' : 'step-unticked', ...stepInfo(c, before, look) };
    case 'step.assign':
      return { kind: 'step-assigned', ...stepInfo(c, before, look), to: c.to };
    case 'step.deps':
      return { kind: 'step-waits', ...stepInfo(c, before, look), count: c.to.length };
    case 'person.add':
      return { kind: 'joined', name: c.person.name, perms: c.person.perms };
    case 'person.remove':
      return { kind: 'left', name: c.person.name };
    case 'person.perms':
      return { kind: 'role', name: before.people.get(c.id)?.name ?? '…', from: c.from, to: c.to };
  }
}

/**
 * Describe a change set, walking the state forward so later changes see
 * earlier ones. A task added or removed together with its steps is one
 * phrase ("added “Exam week” with 7 steps"), and steps rewired because a
 * step was removed are part of that removal.
 */
export function phrases(cs: ChangeSet, before: State, look: Lookups = NONE_LOOKUPS): Phrase[] {
  const addedTasks = new Set(cs.filter((c) => c.op === 'task.add').map((c) => (c.op === 'task.add' ? c.task.id : '')));
  const removedTasks = new Set(cs.filter((c) => c.op === 'task.remove').map((c) => (c.op === 'task.remove' ? c.task.id : '')));
  const removedSteps = new Set(cs.filter((c) => c.op === 'step.remove').map((c) => (c.op === 'step.remove' ? c.step.id : '')));
  const stepCount = new Map<string, number>();
  let s = before;
  const out: Phrase[] = [];
  const later: Array<{ index: number; task: TaskId }> = [];
  for (const c of cs) {
    let skip = false;
    if (c.op === 'step.add' && addedTasks.has(c.step.task)) {
      stepCount.set(c.step.task, (stepCount.get(c.step.task) ?? 0) + 1);
      skip = true;
    } else if (c.op === 'step.remove' && removedTasks.has(c.step.task)) {
      stepCount.set(c.step.task, (stepCount.get(c.step.task) ?? 0) + 1);
      skip = true;
    } else if (c.op === 'step.deps' && removedSteps.size > 0 && c.from.some((d) => removedSteps.has(d))) {
      skip = true; // rewired because a step it waited for was removed
    }
    if (!skip) {
      const p = phrase(c, s, look);
      if (p.kind === 'added' || p.kind === 'removed') later.push({ index: out.length, task: isTaskChange(c) ? taskIdOf(c) : ('' as TaskId) });
      out.push(p);
    }
    const r = applyChange(s, c);
    if (r.ok) s = r.value;
  }
  for (const { index, task } of later) {
    const p = out[index];
    if (p && (p.kind === 'added' || p.kind === 'removed')) out[index] = { ...p, steps: stepCount.get(task) ?? 0 };
  }
  return out;
}

export type UndoInfo = { readonly kind: 'do' | 'suggest' } | { readonly kind: 'no'; readonly refusal: Refusal };

export type TimelineItem =
  | {
      readonly type: 'version';
      readonly at: number;
      readonly version: Version;
      readonly phrases: readonly Phrase[];
      /** For an undo: what the undone version had done. */
      readonly undid: readonly Phrase[] | null;
      readonly undo: UndoInfo;
    }
  | {
      readonly type: 'declined';
      readonly at: number;
      readonly suggestion: Suggestion;
      readonly by: PersonId;
      readonly contributors: readonly PersonId[];
      readonly phrases: readonly Phrase[];
    };

/**
 * Everything that happened, newest first, with what this person could undo.
 * Only what they may see: someone who sees only their own part gets only the
 * changes to it (changeVisibleTo). Someone no longer on the list gets nothing.
 */
export function timeline(ws: Workspace, me: PersonId): TimelineItem[] {
  const actor = ws.replay.state.people.get(me);
  if (!actor) return [];
  const look = lookupsOf(ws.replay);
  const sees = changeVisibleTo(ws.replay.state, ws.replay.facts, ws.replay.stepFacts, actor);
  const byVersion = new Map<number, readonly Phrase[]>();
  const items: TimelineItem[] = [];

  let r = EMPTY_REPLAY;
  for (const v of ws.data.log) {
    const shown = v.changes.filter(sees);
    const ps = phrases(shown, r.state, look);
    byVersion.set(v.n, ps);
    r = step(r, v);
    if (shown.length === 0) continue;
    let undo: UndoInfo;
    if (shown.length < v.changes.length) undo = { kind: 'no', refusal: { code: 'not-allowed', missing: ['see'] } };
    else {
      const plan = planUndo(ws, actor, v.n);
      undo = plan.kind === 'refused' ? { kind: 'no', refusal: plan.refusal } : { kind: plan.kind };
    }
    const undid = v.cause.type === 'undo' ? (byVersion.get(v.cause.of) ?? null) : null;
    // The version as this person may see it: only the changes shown, never the hidden ones.
    const version = shown.length < v.changes.length ? { ...v, changes: shown } : v;
    items.push({ type: 'version', at: v.at, version, phrases: ps, undid, undo });
  }

  for (const s of ws.data.suggestions) {
    const declined = s.batches.filter((b) => b.status === 'declined');
    const last = declined.reduce<(typeof declined)[number] | undefined>(
      (acc, b) => (acc === undefined || (b.decidedAt ?? 0) > (acc.decidedAt ?? 0) ? b : acc),
      undefined,
    );
    if (!last || last.decidedBy === null) continue;
    const shown = declined.filter((b) => b.by === me || b.changes.every(sees));
    if (shown.length === 0) continue;
    items.push({
      type: 'declined',
      at: last.decidedAt ?? last.at,
      // Only the batches shown: someone who sees only their part never gets the rest through here.
      suggestion: { ...s, batches: shown },
      by: last.decidedBy,
      contributors: [...new Set(shown.map((b) => b.by))],
      phrases: shown.flatMap((b) => phrases(b.changes, ws.replay.state, look)),
    });
  }

  return items.sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at;
    const na = a.type === 'version' ? a.version.n : 0;
    const nb = b.type === 'version' ? b.version.n : 0;
    return nb - na;
  });
}

/** Task and step changes in a version, for showing details. */
export function taskChangesOf(v: Version): Change[] {
  return v.changes.filter((c) => !isPersonChange(c));
}

export { taskIdOf };
