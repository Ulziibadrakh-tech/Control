/**
 * The workspace aggregate and its single entry point, `dispatch`.
 *
 * The interface never changes data directly. It sends a Command; dispatch
 * checks who is asking, decides through the policy whether the action is
 * published, suggested or refused, and returns a new immutable Workspace plus
 * an Outcome the interface can explain in plain words. Refusals carry a reason
 * code, never a string, so they can be translated.
 */
import { applySet, invertSet, normalize, rebaseSet, type ChangeSet, type SetConflict } from './changeset';
import { changeEquals, entityOf, isPersonChange, taskIdOf, type Change, type ConflictCode, type EntityKey } from './changes';
import type { EvaluatedBatch } from './suggestions';
import { advance, replay as replayLog, type Cause, type Replay, type Version } from './history';
import { BatchId, PersonId, StepId, SuggestionId, TaskId, type Env } from './ids';
import {
  canonicalIds,
  cleanText,
  findOpenTask,
  HUES,
  isTaskDone,
  MAX_NAME,
  MAX_STEPS,
  MAX_TEXT,
  sameIds,
  sameText,
  stepsOf,
  type Hue,
  type Person,
  type State,
  type Step,
  type Task,
} from './model';
import { ALL, atomFor, covers, has, type Action, type Atom, type Perms, type Scope, type StandardId } from './permissions';
import { canSeeTask, changeVisibleTo, nodesOf, planProblem, seesAll, touchedTasks, type PlanProblem } from './plan';
import { POLICY, requirement, route, routeAction } from './policy';
import { findCycle, withoutStep, wouldCycle } from './poset';
import {
  closeIfEmpty,
  contributors,
  decide,
  evaluate,
  pendingBatches,
  type Batch,
  type Evaluation,
  type Origin,
  type Suggestion,
} from './suggestions';

export interface WorkspaceData {
  readonly id: string;
  /** Which ready-made setup this workspace follows: its role ladder and its ready-made things. */
  readonly standard: StandardId;
  readonly log: readonly Version[];
  readonly suggestions: readonly Suggestion[];
}

export interface Workspace {
  readonly data: WorkspaceData;
  readonly replay: Replay;
  /** The one open suggestion, if any. */
  readonly open: Suggestion | null;
  readonly evaluation: Evaluation | null;
}

/** A step of a plan being written, before it exists. `after` names other draft steps by key. */
export interface DraftStep {
  readonly key: string;
  readonly text: string;
  readonly who: PersonId;
  readonly after: readonly string[];
}

export type Command =
  /** Add a task, optionally broken into steps from the start. */
  | { readonly type: 'add'; readonly text: string; readonly steps?: readonly DraftStep[] }
  | { readonly type: 'check'; readonly id: TaskId; readonly done: boolean }
  /** `from`: the words the person started editing. If someone changed them meanwhile, the edit is refused. */
  | { readonly type: 'edit'; readonly id: TaskId; readonly text: string; readonly from?: string }
  | { readonly type: 'remove'; readonly id: TaskId }
  | { readonly type: 'addStep'; readonly task: TaskId; readonly text: string; readonly who: PersonId; readonly after?: readonly StepId[] }
  | { readonly type: 'checkStep'; readonly id: StepId; readonly done: boolean }
  | { readonly type: 'editStep'; readonly id: StepId; readonly text: string; readonly from?: string }
  /** `from`: who the step was for on screen. Refused if someone changed it meanwhile. */
  | { readonly type: 'assignStep'; readonly id: StepId; readonly who: PersonId; readonly from?: PersonId }
  /** `from`: what the step waited for on screen. Refused if someone changed it meanwhile. */
  | { readonly type: 'setWaits'; readonly id: StepId; readonly after: readonly StepId[]; readonly from?: readonly StepId[] }
  | { readonly type: 'removeStep'; readonly id: StepId }
  | { readonly type: 'undo'; readonly version: number }
  | { readonly type: 'restore'; readonly to: number }
  | { readonly type: 'accept'; readonly suggestion: SuggestionId }
  | { readonly type: 'decline'; readonly suggestion: SuggestionId }
  | { readonly type: 'declineBatch'; readonly suggestion: SuggestionId; readonly batch: BatchId }
  | { readonly type: 'withdraw'; readonly batch: BatchId }
  | { readonly type: 'addPerson'; readonly name: string; readonly perms: Perms; readonly hue?: Hue }
  | { readonly type: 'removePerson'; readonly id: PersonId }
  /** `from`: the permissions shown when the person started choosing. Refused if they changed meanwhile. */
  | { readonly type: 'setPerms'; readonly id: PersonId; readonly perms: Perms; readonly from?: Perms };

export type Refusal =
  | { readonly code: 'not-a-member' }
  | { readonly code: 'empty-text' }
  | { readonly code: 'too-long'; readonly max: number }
  | { readonly code: 'too-many-steps'; readonly max: number }
  | { readonly code: 'duplicate'; readonly text: string }
  | { readonly code: 'not-found' }
  | { readonly code: 'pending' }
  | { readonly code: 'no-change' }
  | { readonly code: 'changed-meanwhile' }
  | { readonly code: 'not-allowed'; readonly missing: readonly Atom[] }
  | { readonly code: 'not-yours' }
  | {
      readonly code: 'conflict';
      readonly reason: ConflictCode;
      readonly entity: EntityKey;
      readonly text: string | null;
      readonly laterBy: PersonId | null;
      readonly laterAt: number | null;
    }
  | { readonly code: 'has-steps' }
  | { readonly code: 'waits-for'; readonly text: string; readonly who: PersonId }
  | { readonly code: 'later-done'; readonly text: string }
  | { readonly code: 'cycle' }
  | { readonly code: 'order'; readonly text: string; readonly waitsFor: string }
  | { readonly code: 'plan-changed' }
  | { readonly code: 'own-only' }
  | { readonly code: 'nothing-to-accept' }
  | { readonly code: 'suggestion-closed' }
  | { readonly code: 'last-owner' }
  | { readonly code: 'self-remove' }
  | { readonly code: 'empty-name' }
  | { readonly code: 'name-taken'; readonly name: string }
  | { readonly code: 'setup' }
  | { readonly code: 'nothing-to-restore' };

export type Outcome =
  | { readonly kind: 'published'; readonly ws: Workspace; readonly version: Version }
  | { readonly kind: 'suggested'; readonly ws: Workspace; readonly suggestion: SuggestionId; readonly batch: BatchId }
  | {
      readonly kind: 'updated';
      readonly ws: Workspace;
      readonly what: 'declined' | 'declined-batch' | 'withdrawn' | 'accepted-nothing-left';
    }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

/** What undo or restore would do for a person, computed without doing it. */
export type UndoPlan =
  | { readonly kind: 'do'; readonly changes: ChangeSet }
  | { readonly kind: 'suggest'; readonly changes: ChangeSet }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

/* ---------------------------------------------------------------- reading */

export function hydrate(data: WorkspaceData): Workspace {
  return assemble(data, replayLog(data.log));
}

function assemble(data: WorkspaceData, replay: Replay): Workspace {
  const open = data.suggestions.findLast((s) => s.resolution === null) ?? null;
  return { data, replay, open, evaluation: open ? evaluate(replay.state, open) : null };
}

export const published = (ws: Workspace): State => ws.replay.state;
export const preview = (ws: Workspace): State => ws.evaluation?.preview ?? ws.replay.state;
export const head = (ws: Workspace): number => ws.replay.head;
export const standardOf = (ws: Workspace): StandardId => ws.data.standard;
export const personOf = (ws: Workspace, id: PersonId | null | undefined): Person | undefined =>
  id ? ws.replay.state.people.get(id) : undefined;

export function people(ws: Workspace): Person[] {
  return [...ws.replay.state.people.values()];
}

export function approvers(ws: Workspace): Person[] {
  return people(ws).filter((p) => has(p.perms, 'approve'));
}

export function managers(ws: Workspace): Person[] {
  return people(ws).filter((p) => has(p.perms, 'manage'));
}

/* --------------------------------------------------------------- creating */

export function createWorkspace(
  env: Env,
  owner: { readonly name: string; readonly hue?: Hue },
  standard: StandardId = 'home',
): Workspace {
  const person: Person = {
    id: PersonId(env.newId()),
    name: cleanText(owner.name).slice(0, MAX_NAME) || 'Owner',
    hue: owner.hue ?? 'clay',
    perms: ALL,
  };
  const v: Version = {
    n: 1,
    at: env.now(),
    by: person.id,
    changes: [{ op: 'person.add', person }],
    cause: { type: 'setup' },
  };
  return hydrate({ id: env.newId(), standard, log: [v], suggestions: [] });
}

/* ---------------------------------------------------------------- writing */

const DIRECT: Cause = { type: 'direct' };
const ACTION: Origin = { type: 'action' };
const refuse = (refusal: Refusal): Outcome => ({ kind: 'refused', refusal });

export function dispatch(ws: Workspace, actorId: PersonId, cmd: Command, env: Env): Outcome {
  const actor = ws.replay.state.people.get(actorId);
  if (!actor) return refuse({ code: 'not-a-member' });

  switch (cmd.type) {
    case 'add':
      return addTask(ws, actor, cmd.text, cmd.steps ?? [], env);

    case 'check':
      return onTask(ws, actor, 'check', cmd.id, env, (t, base) => {
        if (stepsOf(base, t.id).length > 0) return { code: 'has-steps' };
        return t.done === cmd.done ? null : [{ op: 'task.check', id: t.id, from: t.done, to: cmd.done }];
      });

    case 'edit': {
      const text = cleanText(cmd.text);
      if (!text) return refuse({ code: 'empty-text' });
      if (text.length > MAX_TEXT) return refuse({ code: 'too-long', max: MAX_TEXT });
      return onTask(ws, actor, 'edit', cmd.id, env, (t) => {
        if (cmd.from !== undefined && t.text !== cmd.from) return { code: 'changed-meanwhile' };
        if (t.text === text) return null;
        const twin = findOpenTaskSeenBy(preview(ws), actor, text);
        if (twin && twin.id !== t.id) return { code: 'duplicate', text };
        return [{ op: 'task.edit', id: t.id, from: t.text, to: text }];
      });
    }

    case 'remove':
      // A plan goes with its steps.
      return onTask(ws, actor, 'remove', cmd.id, env, (t, base) => [
        ...stepsOf(base, t.id).map((step): Change => ({ op: 'step.remove', step })),
        { op: 'task.remove', task: t },
      ]);

    case 'addStep':
      return addStep(ws, actor, cmd, env);

    case 'checkStep':
      return onStep(ws, actor, 'check', cmd.id, env, (st, base) => {
        if (st.done === cmd.done) return null;
        if (cmd.done) {
          const first = st.after.map((d) => base.steps.get(d)).find((d) => d !== undefined && !d.done);
          if (first) return { code: 'waits-for', text: first.text, who: first.who };
        } else {
          const later = stepsOf(base, st.task).find((x) => x.done && x.after.includes(st.id));
          if (later) return { code: 'later-done', text: later.text };
        }
        return [{ op: 'step.check', id: st.id, from: st.done, to: cmd.done }];
      });

    case 'editStep': {
      const text = cleanText(cmd.text);
      if (!text) return refuse({ code: 'empty-text' });
      if (text.length > MAX_TEXT) return refuse({ code: 'too-long', max: MAX_TEXT });
      return onStep(ws, actor, 'edit', cmd.id, env, (st) => {
        if (cmd.from !== undefined && st.text !== cmd.from) return { code: 'changed-meanwhile' };
        return st.text === text ? null : [{ op: 'step.edit', id: st.id, from: st.text, to: text }];
      });
    }

    case 'assignStep':
      if (!ws.replay.state.people.has(cmd.who)) return refuse({ code: 'not-found' });
      return onStep(ws, actor, 'edit', cmd.id, env, (st) => {
        if (cmd.from !== undefined && st.who !== cmd.from) return { code: 'changed-meanwhile' };
        return st.who === cmd.who ? null : [{ op: 'step.assign', id: st.id, from: st.who, to: cmd.who }];
      });

    case 'setWaits':
      return onStep(ws, actor, 'edit', cmd.id, env, (st, base) => {
        if (cmd.from !== undefined && !sameIds(canonicalIds(cmd.from), st.after)) return { code: 'changed-meanwhile' };
        const siblings = stepsOf(base, st.task);
        const after = canonicalIds(cmd.after);
        if (after.some((d) => d === st.id || !siblings.some((x) => x.id === d))) return { code: 'not-found' };
        if (sameIds(after, st.after)) return null;
        if (wouldCycle(nodesOf(siblings), st.id, after)) return { code: 'cycle' };
        if (st.done) {
          const undone = after.map((d) => base.steps.get(d)).find((d) => d !== undefined && !d.done);
          if (undone) return { code: 'order', text: st.text, waitsFor: undone.text };
        }
        return [{ op: 'step.deps', id: st.id, from: st.after, to: after }];
      });

    case 'removeStep':
      return onStep(ws, actor, 'remove', cmd.id, env, (st, base) => {
        // Whoever waited for this step now waits for what it waited for, so nothing starts earlier than before.
        const siblings = stepsOf(base, st.task);
        const rewired = withoutStep(nodesOf(siblings), st.id);
        const changes: Change[] = [];
        for (const [id, after] of rewired) {
          const dep = base.steps.get(id);
          if (dep) changes.push({ op: 'step.deps', id, from: dep.after, to: canonicalIds(after) });
        }
        changes.push({ op: 'step.remove', step: st });
        return changes;
      });

    case 'undo':
      return carryOut(ws, actor, planUndo(ws, actor, cmd.version), { type: 'undo', of: cmd.version }, env);

    case 'restore':
      return carryOut(ws, actor, planRestore(ws, actor, cmd.to), { type: 'restore', to: cmd.to }, env);

    case 'accept':
      return accept(ws, actor, cmd.suggestion, env);

    case 'decline':
      return decline(ws, actor, cmd.suggestion, env);

    case 'declineBatch':
      return declineBatch(ws, actor, cmd.suggestion, cmd.batch, env);

    case 'withdraw':
      return withdraw(ws, actor, cmd.batch, env);

    case 'addPerson':
      return addPerson(ws, actor, cmd.name, cmd.perms, cmd.hue, env);

    case 'removePerson':
      return removePerson(ws, actor, cmd.id, env);

    case 'setPerms':
      return setPerms(ws, actor, cmd.id, cmd.perms, cmd.from, env);
  }
}

/* ------------------------------------------------------------------ tasks */

function addTask(ws: Workspace, actor: Person, raw: string, drafts: readonly DraftStep[], env: Env): Outcome {
  const text = cleanText(raw);
  if (!text) return refuse({ code: 'empty-text' });
  if (text.length > MAX_TEXT) return refuse({ code: 'too-long', max: MAX_TEXT });
  const kind = routeAction(actor.perms, 'add', 'own');
  if (kind === 'deny') return refuse({ code: 'not-allowed', missing: [atomFor('suggest', 'add', 'own')] });
  // Also catches double taps: the same words cannot be added twice while still open.
  if (findOpenTaskSeenBy(preview(ws), actor, text) || findOpenTaskSeenBy(published(ws), actor, text))
    return refuse({ code: 'duplicate', text });

  if (drafts.length > MAX_STEPS) return refuse({ code: 'too-many-steps', max: MAX_STEPS });
  const keys = new Set(drafts.map((d) => d.key));
  if (keys.size !== drafts.length) return refuse({ code: 'not-found' });
  for (const d of drafts) {
    const stepText = cleanText(d.text);
    if (!stepText) return refuse({ code: 'empty-text' });
    if (stepText.length > MAX_TEXT) return refuse({ code: 'too-long', max: MAX_TEXT });
    if (!ws.replay.state.people.has(d.who)) return refuse({ code: 'not-found' });
    if (d.after.some((k) => !keys.has(k))) return refuse({ code: 'not-found' });
  }
  if (findCycle(drafts.map((d) => ({ id: d.key, after: d.after })))) return refuse({ code: 'cycle' });

  const now = env.now();
  const task: Task = { id: TaskId(env.newId()), text, done: false, createdAt: now, createdBy: actor.id };
  const idOf = new Map(drafts.map((d) => [d.key, StepId(env.newId())]));
  const steps: Change[] = drafts.map((d, i) => ({
    op: 'step.add',
    step: {
      id: idOf.get(d.key) as StepId,
      task: task.id,
      n: i + 1,
      text: cleanText(d.text),
      who: d.who,
      after: canonicalIds(d.after.map((k) => idOf.get(k) as StepId)),
      done: false,
      createdAt: now,
      createdBy: actor.id,
    },
  }));
  const changes: Change[] = [{ op: 'task.add', task }, ...steps];
  return kind === 'do' ? publish(ws, actor.id, changes, DIRECT, env) : propose(ws, actor.id, changes, ACTION, env);
}

type Build<T> = (thing: T, base: State) => readonly Change[] | Refusal | null;

/**
 * Act on one thing. Doers act on what is published; people who may only
 * suggest act on the list as it would look after the open suggestion, so they
 * can build on their own waiting ideas.
 */
function act<T>(
  ws: Workspace,
  actor: Person,
  action: Action,
  scope: Scope,
  find: (s: State) => T | undefined,
  env: Env,
  build: Build<T>,
): Outcome {
  const kind = routeAction(actor.perms, action, scope);
  if (kind === 'deny') return refuse({ code: 'not-allowed', missing: [atomFor('suggest', action, scope)] });
  const base = kind === 'do' ? published(ws) : preview(ws);
  const thing = find(base);
  if (thing === undefined) {
    const elsewhere = find(published(ws)) !== undefined || find(preview(ws)) !== undefined;
    return refuse({ code: elsewhere ? 'pending' : 'not-found' });
  }
  const built = build(thing, base);
  if (built === null) return refuse({ code: 'no-change' });
  if ('code' in built) return refuse(built);
  // The whole change set decides, not just its first action (removing a plan also removes its steps).
  const r = route(actor.perms, built, base, actor.id);
  if (r.kind === 'deny') return refuse({ code: 'not-allowed', missing: r.missing });
  if (r.kind === 'do' && kind === 'do') return publish(ws, actor.id, built, DIRECT, env);
  return propose(ws, actor.id, built, ACTION, env);
}

function lookupTask(ws: Workspace, id: TaskId): Task | undefined {
  return published(ws).tasks.get(id) ?? preview(ws).tasks.get(id);
}

function lookupStep(ws: Workspace, id: StepId): Step | undefined {
  return published(ws).steps.get(id) ?? preview(ws).steps.get(id);
}

function onTask(ws: Workspace, actor: Person, action: Action, id: TaskId, env: Env, build: Build<Task>): Outcome {
  const scope: Scope = lookupTask(ws, id)?.createdBy === actor.id ? 'own' : 'all';
  return act(ws, actor, action, scope, (s) => s.tasks.get(id), env, build);
}

function onStep(ws: Workspace, actor: Person, action: Action, id: StepId, env: Env, build: Build<Step>): Outcome {
  const st = lookupStep(ws, id);
  const plan = st ? lookupTask(ws, st.task) : undefined;
  const mine = plan?.createdBy === actor.id || (action === 'check' && st?.who === actor.id);
  return act(ws, actor, action, mine ? 'own' : 'all', (s) => s.steps.get(id), env, build);
}

function addStep(
  ws: Workspace,
  actor: Person,
  cmd: Extract<Command, { type: 'addStep' }>,
  env: Env,
): Outcome {
  const text = cleanText(cmd.text);
  if (!text) return refuse({ code: 'empty-text' });
  if (text.length > MAX_TEXT) return refuse({ code: 'too-long', max: MAX_TEXT });
  if (!ws.replay.state.people.has(cmd.who)) return refuse({ code: 'not-found' });
  return onTask(ws, actor, 'add', cmd.task, env, (t, base) => {
    const siblings = stepsOf(base, t.id);
    if (siblings.length >= MAX_STEPS) return { code: 'too-many-steps', max: MAX_STEPS };
    const after = canonicalIds(cmd.after ?? []);
    if (after.some((d) => !siblings.some((x) => x.id === d))) return { code: 'not-found' };
    const step: Step = {
      id: StepId(env.newId()),
      task: t.id,
      n: nextStepNumber(ws, base, t.id),
      text,
      who: cmd.who,
      after,
      done: false,
      createdAt: env.now(),
      createdBy: actor.id,
    };
    return [{ op: 'step.add', step }];
  });
}

/** Step numbers are never reused, not even for steps that were removed. */
function nextStepNumber(ws: Workspace, base: State, task: TaskId): number {
  let max = 0;
  // Published, waiting in the suggestion, and removed: a number is never handed out twice.
  for (const st of [...stepsOf(base, task), ...stepsOf(published(ws), task), ...stepsOf(preview(ws), task)]) max = Math.max(max, st.n);
  for (const f of ws.replay.stepFacts.values()) if (f.task === task) max = Math.max(max, f.n);
  return max + 1;
}

/* ---------------------------------------------------- publish and propose */

function publish(
  ws: Workspace,
  by: PersonId,
  changes: ChangeSet,
  cause: Cause,
  env: Env,
  nextSuggestions?: (v: Version) => readonly Suggestion[],
): Outcome {
  const v: Version = { n: head(ws) + 1, at: env.now(), by, changes, cause };
  const next = advance(ws.replay, v);
  if (!next.ok) return refuse(next.error === 'out-of-order' ? { code: 'not-found' } : conflictRefusal(ws, next.error));
  const after = next.value.state;
  if (changes.some(isPersonChange)) {
    // Invariants only people changes can break, checked on the result so no path can bypass them.
    const everyone = [...after.people.values()];
    if (!everyone.some((p) => has(p.perms, 'manage'))) return refuse({ code: 'last-owner' });
    if (!after.people.has(by)) return refuse({ code: 'self-remove' });
    // Names stay unique on every path (an undo could otherwise bring back a second "Bat").
    const twin = everyone.find((p, i) => everyone.some((q, j) => j < i && sameText(p.name, q.name)));
    if (twin) return refuse({ code: 'name-taken', name: twin.name });
  }
  // Plan invariants, on the result as well: whatever the path (direct, undo, go back, accepting), plans stay sound.
  const problem = planProblem(after, touchedTasks(changes, ws.replay.state, after));
  if (problem) return refuse(planRefusal(problem));
  // Whoever is no longer on the list after this version (removed, or their joining undone) takes their
  // waiting suggestions with them: nobody counts as a second pair of eyes after leaving.
  const suggestions = withdrawDeparted(nextSuggestions ? nextSuggestions(v) : ws.data.suggestions, after, by, v.at);
  const data: WorkspaceData = { ...ws.data, log: [...ws.data.log, v], suggestions };
  return { kind: 'published', ws: assemble(data, next.value), version: v };
}

function withdrawDeparted(list: readonly Suggestion[], after: State, by: PersonId, at: number): readonly Suggestion[] {
  const open = list.findLast((x) => x.resolution === null);
  if (!open || !open.batches.some((b) => b.status === 'pending' && !after.people.has(b.by))) return list;
  const updated = closeIfEmpty(
    {
      ...open,
      batches: open.batches.map((b) => (b.status === 'pending' && !after.people.has(b.by) ? decide(b, 'withdrawn', by, at) : b)),
    },
    by,
    at,
  );
  return replace(list, updated);
}

function propose(ws: Workspace, by: PersonId, changes: ChangeSet, origin: Origin, env: Env): Outcome {
  const base = preview(ws);
  const fits = rebaseSet(base, changes);
  if (!fits.ok) return refuse(conflictRefusal(ws, fits.error));
  if (fits.value.changes.length === 0) return refuse({ code: 'no-change' });
  const problem = planProblem(fits.value.state, touchedTasks(fits.value.changes, base, fits.value.state));
  if (problem) return refuse(planRefusal(problem));
  const at = env.now();
  const batch: Batch = {
    id: BatchId(env.newId()),
    by,
    at,
    changes: fits.value.changes,
    origin,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
  };
  const open = ws.open;
  const suggestion: Suggestion = open
    ? { ...open, batches: [...open.batches, batch] }
    : { id: SuggestionId(env.newId()), openedAt: at, batches: [batch], resolution: null };
  const suggestions = open ? replace(ws.data.suggestions, suggestion) : [...ws.data.suggestions, suggestion];
  return {
    kind: 'suggested',
    ws: assemble({ ...ws.data, suggestions }, ws.replay),
    suggestion: suggestion.id,
    batch: batch.id,
  };
}

function carryOut(ws: Workspace, actor: Person, plan: UndoPlan, cause: Cause & Origin, env: Env): Outcome {
  switch (plan.kind) {
    case 'refused':
      return refuse(plan.refusal);
    case 'do':
      return publish(ws, actor.id, plan.changes, cause, env);
    case 'suggest':
      return propose(ws, actor.id, plan.changes, cause, env);
  }
}

function planRefusal(p: PlanProblem): Refusal {
  switch (p.code) {
    case 'cycle':
      return { code: 'cycle' };
    case 'order':
      return { code: 'order', text: p.step.text, waitsFor: p.waitsFor.text };
    default:
      return { code: 'plan-changed' };
  }
}

/* ---------------------------------------------------------- undo, restore */

/**
 * Undo version n: publish (or suggest) its inverse.
 *
 * People may take back their own action without the inverse permission
 * ("I added it, I can take it back"), but only when all of these hold:
 *  - they made it themselves (not by accepting someone else's suggestion),
 *  - it only touched tasks and steps (never people or roles),
 *  - they are still allowed to make that action today (a person whose rights
 *    were taken away can no longer change anything),
 *  - nobody has touched those things since (the exact inverse still applies).
 * Otherwise the inverse is routed like any other change.
 */
export function planUndo(ws: Workspace, actor: Person, n: number): UndoPlan {
  const v = ws.data.log[n - 1];
  if (!v) return { kind: 'refused', refusal: { code: 'not-found' } };
  if (v.cause.type === 'setup') return { kind: 'refused', refusal: { code: 'setup' } };
  // Before anything else: undoing what you cannot see is not yours to do, and the refusal says nothing about it.
  if (!v.changes.every(visibleFor(ws, actor))) return { kind: 'refused', refusal: { code: 'not-allowed', missing: ['see'] } };
  const inverse = normalize(invertSet(v.changes));
  if (inverse.length === 0) return { kind: 'refused', refusal: { code: 'no-change' } };

  const own =
    POLICY.ownUndo &&
    v.by === actor.id &&
    v.cause.type !== 'suggestion' &&
    !v.changes.some(isPersonChange) &&
    covers(actor.perms, requirement(v.changes, 'do', published(ws), actor.id));
  if (own && applySet(published(ws), inverse).ok) return { kind: 'do', changes: inverse };

  const rebased = rebaseSet(published(ws), inverse);
  if (!rebased.ok) return { kind: 'refused', refusal: conflictRefusal(ws, rebased.error, n) };
  if (rebased.value.changes.length === 0) return { kind: 'refused', refusal: { code: 'no-change' } };
  return routed(ws, actor, rebased.value.changes, n);
}

/** Bring tasks and plans back to how they were right after version `to`. People are left as they are. */
export function planRestore(ws: Workspace, actor: Person, to: number): UndoPlan {
  if (!Number.isInteger(to) || to < 1 || to > head(ws)) return { kind: 'refused', refusal: { code: 'not-found' } };
  const later = ws.data.log.slice(to).flatMap((v) => v.changes.filter((c) => !isPersonChange(c)));
  if (!later.every(visibleFor(ws, actor))) return { kind: 'refused', refusal: { code: 'not-allowed', missing: ['see'] } };
  const inverse = normalize(invertSet(later));
  if (inverse.length === 0) return { kind: 'refused', refusal: { code: 'nothing-to-restore' } };
  const fits = applySet(published(ws), inverse);
  if (!fits.ok) return { kind: 'refused', refusal: conflictRefusal(ws, fits.error, to) };
  return routed(ws, actor, inverse, to);
}

function routed(ws: Workspace, actor: Person, changes: ChangeSet, since: number): UndoPlan {
  const r = route(actor.perms, changes, published(ws), actor.id);
  if (r.kind === 'deny') return { kind: 'refused', refusal: { code: 'not-allowed', missing: r.missing } };
  if (r.kind === 'suggest') {
    const fits = rebaseSet(preview(ws), changes);
    if (!fits.ok) return { kind: 'refused', refusal: conflictRefusal(ws, fits.error, since) };
  }
  return { kind: r.kind, changes };
}

/* ------------------------------------------------------------ suggestions */

export type Acceptance =
  | {
      readonly ok: true;
      /** The changes accepting would publish; empty when everything suggested is already true. */
      readonly changes: ChangeSet;
      readonly effective: readonly EvaluatedBatch[];
    }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * Can this person accept the open suggestion, and what would it publish?
 * Used by dispatch and by the interface, so the screen never offers what the rules refuse.
 *
 * Four eyes is judged on the net effect: every thing that accepting would
 * actually change must have been touched by someone else who is still on the
 * list. Suggesting changes that cancel each other out, or keeping a removed
 * person's batch around, does not count as a second pair of eyes. And when
 * the approver has batches of their own in it, accepting must publish exactly
 * what the others suggested: someone else changing a step's words does not let
 * the approver slip their own change to who does it past review.
 */
export function acceptance(ws: Workspace, actor: Person): Acceptance {
  if (!has(actor.perms, 'approve')) return { ok: false, refusal: { code: 'not-allowed', missing: ['approve'] } };
  const ev = ws.evaluation;
  if (!ws.open || !ev) return { ok: false, refusal: { code: 'suggestion-closed' } };
  if (ev.valid.length === 0) return { ok: false, refusal: { code: 'nothing-to-accept' } };
  const effective = ev.valid.filter((e) => e.changes.length > 0);
  const changes = effective.flatMap((e) => e.changes);
  const net = normalize(changes);
  if (net.length === 0) return { ok: true, changes: [], effective };
  if (POLICY.fourEyes) {
    const members = ws.replay.state.people;
    const others = effective.filter((e) => e.batch.by !== actor.id && members.has(e.batch.by));
    // Every thing accepting would change must have been touched by someone else still on the list…
    const seenByOthers = new Set(others.flatMap((e) => e.changes.map(entityOf)));
    if (net.some((c) => !seenByOthers.has(entityOf(c)))) return { ok: false, refusal: { code: 'own-only' } };
    // …and the approver's own suggestions must not change the outcome at all: what they put in needs
    // someone else's OK, even on a thing another person also touched (a different field, or other words).
    const mine = effective.some((e) => e.batch.by === actor.id);
    if (mine && !sameEffect(net, normalize(others.flatMap((e) => e.changes)))) return { ok: false, refusal: { code: 'own-only' } };
  }
  return { ok: true, changes, effective };
}

function accept(ws: Workspace, actor: Person, id: SuggestionId, env: Env): Outcome {
  const open = ws.open;
  const ev = ws.evaluation;
  if (has(actor.perms, 'approve') && (!open || open.id !== id || !ev)) return refuse({ code: 'suggestion-closed' });
  const verdict = acceptance(ws, actor);
  if (!verdict.ok) return refuse(verdict.refusal);
  if (!open || !ev) return refuse({ code: 'suggestion-closed' });

  const at = env.now();
  const validIds = new Set(ev.valid.map((e) => e.batch.id));
  const staleIds = new Set(ev.stale.map((s) => s.batch.id));
  const settle = (version: number): Suggestion => ({
    ...open,
    batches: open.batches.map((b) =>
      validIds.has(b.id)
        ? decide(b, 'applied', actor.id, at)
        : staleIds.has(b.id)
          ? decide(b, 'skipped', actor.id, at)
          : b,
    ),
    resolution: { type: 'accepted', by: actor.id, at, version },
  });

  if (verdict.changes.length === 0) {
    // Everything suggested is already true (or cancels out). Close it without an empty version.
    const suggestions = replace(ws.data.suggestions, settle(head(ws)));
    return { kind: 'updated', ws: assemble({ ...ws.data, suggestions }, ws.replay), what: 'accepted-nothing-left' };
  }

  const cause: Cause = {
    type: 'suggestion',
    id: open.id,
    contributors: contributors(verdict.effective.map((e) => e.batch)),
  };
  return publish(ws, actor.id, verdict.changes, cause, env, (v) => replace(ws.data.suggestions, settle(v.n)));
}

function decline(ws: Workspace, actor: Person, id: SuggestionId, env: Env): Outcome {
  if (!has(actor.perms, 'approve')) return refuse({ code: 'not-allowed', missing: ['approve'] });
  const open = ws.open;
  if (!open || open.id !== id) return refuse({ code: 'suggestion-closed' });
  const at = env.now();
  const declined: Suggestion = {
    ...open,
    batches: open.batches.map((b) => (b.status === 'pending' ? decide(b, 'declined', actor.id, at) : b)),
    resolution: { type: 'declined', by: actor.id, at },
  };
  const suggestions = replace(ws.data.suggestions, declined);
  return { kind: 'updated', ws: assemble({ ...ws.data, suggestions }, ws.replay), what: 'declined' };
}

function declineBatch(ws: Workspace, actor: Person, id: SuggestionId, batchId: BatchId, env: Env): Outcome {
  if (!has(actor.perms, 'approve')) return refuse({ code: 'not-allowed', missing: ['approve'] });
  const open = ws.open;
  if (!open || open.id !== id) return refuse({ code: 'suggestion-closed' });
  const batch = open.batches.find((b) => b.id === batchId);
  if (!batch || batch.status !== 'pending') return refuse({ code: 'not-found' });
  const at = env.now();
  const updated = closeIfEmpty(
    { ...open, batches: open.batches.map((b) => (b.id === batchId ? decide(b, 'declined', actor.id, at) : b)) },
    actor.id,
    at,
  );
  const suggestions = replace(ws.data.suggestions, updated);
  return { kind: 'updated', ws: assemble({ ...ws.data, suggestions }, ws.replay), what: 'declined-batch' };
}

function withdraw(ws: Workspace, actor: Person, batchId: BatchId, env: Env): Outcome {
  const open = ws.open;
  const batch = open?.batches.find((b) => b.id === batchId);
  if (!open || !batch || batch.status !== 'pending') return refuse({ code: 'not-found' });
  if (batch.by !== actor.id) return refuse({ code: 'not-yours' });
  const at = env.now();
  const updated = closeIfEmpty(
    { ...open, batches: open.batches.map((b) => (b.id === batchId ? decide(b, 'withdrawn', actor.id, at) : b)) },
    actor.id,
    at,
  );
  const suggestions = replace(ws.data.suggestions, updated);
  return { kind: 'updated', ws: assemble({ ...ws.data, suggestions }, ws.replay), what: 'withdrawn' };
}

/* ----------------------------------------------------------------- people */

function addPerson(ws: Workspace, actor: Person, rawName: string, perms: Perms, hue: Hue | undefined, env: Env): Outcome {
  if (!has(actor.perms, 'manage')) return refuse({ code: 'not-allowed', missing: ['manage'] });
  const name = cleanText(rawName);
  if (!name) return refuse({ code: 'empty-name' });
  if (name.length > MAX_NAME) return refuse({ code: 'too-long', max: MAX_NAME });
  if (people(ws).some((p) => sameText(p.name, name))) return refuse({ code: 'name-taken', name });
  const person: Person = { id: PersonId(env.newId()), name, hue: hue ?? leastUsedHue(ws), perms };
  return publish(ws, actor.id, [{ op: 'person.add', person }], DIRECT, env);
}

function removePerson(ws: Workspace, actor: Person, id: PersonId, env: Env): Outcome {
  if (!has(actor.perms, 'manage')) return refuse({ code: 'not-allowed', missing: ['manage'] });
  if (id === actor.id) return refuse({ code: 'self-remove' });
  const person = personOf(ws, id);
  if (!person) return refuse({ code: 'not-found' });
  // Their waiting suggestions leave with them (publish withdraws them, on every path).
  return publish(ws, actor.id, [{ op: 'person.remove', person }], DIRECT, env);
}

function setPerms(
  ws: Workspace,
  actor: Person,
  id: PersonId,
  perms: Perms,
  expected: Perms | undefined,
  env: Env,
): Outcome {
  if (!has(actor.perms, 'manage')) return refuse({ code: 'not-allowed', missing: ['manage'] });
  const person = personOf(ws, id);
  if (!person) return refuse({ code: 'not-found' });
  if (expected !== undefined && person.perms !== expected) return refuse({ code: 'changed-meanwhile' });
  if (person.perms === perms) return refuse({ code: 'no-change' });
  return publish(ws, actor.id, [{ op: 'person.perms', id, from: person.perms, to: perms }], DIRECT, env);
}

function leastUsedHue(ws: Workspace): Hue {
  const used = new Map<Hue, number>(HUES.map((h) => [h, 0]));
  for (const p of people(ws)) used.set(p.hue, (used.get(p.hue) ?? 0) + 1);
  let best: Hue = HUES[0];
  for (const h of HUES) if ((used.get(h) ?? 0) < (used.get(best) ?? 0)) best = h;
  return best;
}

/* ---------------------------------------------------------------- helpers */

/** What a person may see of changes, judged against the published state and history. */
function visibleFor(ws: Workspace, who: Person): (c: Change) => boolean {
  return seesAll(who) ? () => true : changeVisibleTo(published(ws), ws.replay.facts, ws.replay.stepFacts, who);
}

/** Two normal forms that do the same thing (changes to different things may come in any order). */
function sameEffect(a: ChangeSet, b: ChangeSet): boolean {
  return a.length === b.length && a.every((x) => b.some((y) => changeEquals(x, y)));
}

/**
 * An open task with these words among the tasks this person can see. Used for
 * the double-tap guard: it never confirms that a task someone cannot see exists.
 */
function findOpenTaskSeenBy(s: State, who: Person, text: string): Task | undefined {
  const t = findOpenTask(s, text);
  if (!t || canSeeTask(s, who, t)) return t;
  return [...s.tasks.values()].find((x) => x.id !== t.id && canSeeTask(s, who, x) && sameText(x.text, text) && !isTaskDone(s, x));
}

function replace(list: readonly Suggestion[], s: Suggestion): Suggestion[] {
  return list.map((x) => (x.id === s.id ? s : x));
}

/**
 * Explain a conflict: what it was about and who changed it.
 * With `since`, the culprit is the first later version that touched it;
 * otherwise it is the most recent one.
 */
function conflictRefusal(ws: Workspace, c: SetConflict, since?: number): Refusal {
  let culprit: Version | undefined;
  if (since !== undefined) {
    culprit = ws.data.log.slice(since).find((v) => v.changes.some((x) => entityOf(x) === c.entity));
  } else {
    const n = ws.replay.lastTouch.get(c.entity);
    culprit = n ? ws.data.log[n - 1] : undefined;
  }
  return {
    code: 'conflict',
    reason: c.code,
    entity: c.entity,
    text: describeTarget(ws, c.change),
    laterBy: culprit?.by ?? null,
    laterAt: culprit?.at ?? null,
  };
}

function describeTarget(ws: Workspace, c: Change): string | null {
  switch (c.op) {
    case 'task.add':
    case 'task.remove':
      return c.task.text;
    case 'task.edit':
      return c.from;
    case 'task.check':
      return ws.replay.facts.get(taskIdOf(c))?.text ?? null;
    case 'step.add':
    case 'step.remove':
      return c.step.text;
    case 'step.edit':
      return c.from;
    case 'step.check':
    case 'step.assign':
    case 'step.deps':
      return ws.replay.stepFacts.get(c.id)?.text ?? null;
    case 'person.add':
    case 'person.remove':
      return c.person.name;
    case 'person.perms':
      return personOf(ws, c.id)?.name ?? null;
  }
}

/** Batches still waiting, for the people who can act on them. */
export function waiting(ws: Workspace): Batch[] {
  return ws.open ? pendingBatches(ws.open) : [];
}
