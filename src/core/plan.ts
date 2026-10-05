/**
 * Plans: a task's steps seen as a partial order (poset.ts), the rules every
 * published state keeps, and who sees which part.
 *
 * Invariants, checked on the result of every version and every suggestion:
 *   1. every step belongs to a task that exists
 *   2. a step only waits for other steps of the same task
 *   3. the waits never go round in a circle (so they form a partial order)
 *   4. a done step never waits for an undone one: the done steps of a task
 *      always form a down-set of its plan (you cannot finish a step before
 *      what it waits for)
 *
 * Single changes never check these (each change touches one entity, which is
 * what makes changes to different things commute); versions do.
 */
import type { Change } from './changes';
import type { ChangeSet } from './changeset';
import type { StepFacts, TaskFacts } from './history';
import type { PersonId, StepId, TaskId } from './ids';
import { stepsOf, type Person, type State, type Step, type Task } from './model';
import { has } from './permissions';
import { findCycle, height, levels, longestChain, remaining, width, type Node } from './poset';

export const nodesOf = (steps: readonly Step[]): Node<StepId>[] => steps.map((s) => ({ id: s.id, after: s.after }));

/* ------------------------------------------------------------ invariants */

export type PlanProblem =
  | { readonly code: 'orphan'; readonly step: Step }
  | { readonly code: 'missing-dep'; readonly step: Step }
  | { readonly code: 'cycle'; readonly task: TaskId }
  | { readonly code: 'order'; readonly step: Step; readonly waitsFor: Step };

/** The tasks whose plans a change set touches, looking steps up in the states before and after it. */
export function touchedTasks(cs: ChangeSet, before: State, after: State): Set<TaskId> {
  const out = new Set<TaskId>();
  for (const c of cs) {
    switch (c.op) {
      case 'task.add':
      case 'task.remove':
        out.add(c.task.id);
        break;
      case 'task.edit':
      case 'task.check':
        out.add(c.id);
        break;
      case 'step.add':
      case 'step.remove':
        out.add(c.step.task);
        break;
      case 'step.edit':
      case 'step.check':
      case 'step.assign':
      case 'step.deps': {
        const st = after.steps.get(c.id) ?? before.steps.get(c.id);
        if (st) out.add(st.task);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** The first broken rule among these tasks' plans, or null when all hold. */
export function planProblem(s: State, tasks: Iterable<TaskId>): PlanProblem | null {
  for (const id of new Set(tasks)) {
    const steps = stepsOf(s, id);
    if (steps.length === 0) continue;
    if (!s.tasks.has(id)) return { code: 'orphan', step: steps[0]! };
    for (const st of steps) {
      for (const d of st.after) {
        const dep = s.steps.get(d);
        if (!dep || dep.task !== id || dep.id === st.id) return { code: 'missing-dep', step: st };
      }
    }
    if (findCycle(nodesOf(steps))) return { code: 'cycle', task: id };
    for (const st of steps) {
      if (!st.done) continue;
      for (const d of st.after) {
        const dep = s.steps.get(d);
        if (dep && !dep.done) return { code: 'order', step: st, waitsFor: dep };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------- the plan */

export interface PlanStep {
  readonly step: Step;
  /** 0-based round: everything in a round can be done at the same time. */
  readonly round: number;
  /** Undone, and everything it waits for is done. */
  readonly ready: boolean;
  /** The undone steps it waits for directly (only the ones the viewer may see, in a partial view). */
  readonly waitingFor: readonly Step[];
  /** In a partial view: how many more undone steps it waits for that the viewer does not see. */
  readonly hiddenWaits: number;
}

export interface Plan {
  readonly task: Task;
  /** In their stable order (by step number). */
  readonly steps: readonly PlanStep[];
  readonly rounds: readonly (readonly PlanStep[])[];
  readonly total: number;
  readonly done: number;
  /** How many rounds the whole plan takes: the longest chain of waits. */
  readonly height: number;
  /** The most steps that can be in progress at the same time. */
  readonly width: number;
  /** Rounds still to go: the height of what is left. */
  readonly left: number;
  /** The first round that still has something undone, or null when all is done. */
  readonly current: number | null;
  /** One longest chain of waits, first step first. */
  readonly critical: readonly StepId[];
}

export function planOf(s: State, task: Task): Plan {
  const steps = stepsOf(s, task.id);
  const nodes = nodesOf(steps);
  const level = levels(nodes);
  const isDone = (id: StepId) => s.steps.get(id)?.done ?? true;
  const items: PlanStep[] = steps.map((st) => {
    const waitingFor = st.after.map((d) => s.steps.get(d)).filter((d): d is Step => d !== undefined && !d.done);
    return { step: st, round: level.get(st.id) ?? 0, ready: !st.done && waitingFor.length === 0, waitingFor, hiddenWaits: 0 };
  });
  const roundsList: PlanStep[][] = [];
  for (const it of items) {
    while (roundsList.length <= it.round) roundsList.push([]);
    roundsList[it.round]!.push(it);
  }
  const current = roundsList.findIndex((r) => r.some((it) => !it.step.done));
  return {
    task,
    steps: items,
    rounds: roundsList,
    total: steps.length,
    done: steps.filter((st) => st.done).length,
    height: roundsList.length,
    width: width(nodes),
    left: height(remaining(nodes, isDone)),
    current: current === -1 ? null : current,
    critical: longestChain(nodes),
  };
}

/** A plan as one person may see it: everything, or only their part (with the shape of the rest withheld). */
export interface ViewedPlan extends Plan {
  readonly partial: boolean;
}

export function planFor(s: State, me: Person, task: Task): ViewedPlan {
  const full = planOf(s, task);
  if (seesAll(me) || ownsTask(task, me.id)) return { ...full, partial: false };
  const shown = new Set(visibleSteps(s, me, task).map((st) => st.id));
  const only = (ps: PlanStep): PlanStep => ({
    ...ps,
    waitingFor: ps.waitingFor.filter((d) => shown.has(d.id)),
    hiddenWaits: ps.waitingFor.filter((d) => !shown.has(d.id)).length,
  });
  const steps = full.steps.filter((ps) => shown.has(ps.step.id)).map(only);
  return {
    ...full,
    steps,
    rounds: full.rounds.map((r) => r.filter((ps) => shown.has(ps.step.id)).map(only)),
    total: steps.length,
    done: steps.filter((ps) => ps.step.done).length,
    width: 0,
    critical: [],
    partial: true,
  };
}

/** How many rounds a draft plan takes, how many steps can start at once, and how many can run together. */
export interface Shape {
  readonly steps: number;
  readonly rounds: number;
  readonly startNow: number;
  readonly width: number;
}

export function shapeOf<K>(nodes: readonly Node<K>[]): Shape {
  if (nodes.length === 0) return { steps: 0, rounds: 0, startNow: 0, width: 0 };
  const level = levels(nodes);
  return {
    steps: nodes.length,
    rounds: height(nodes),
    startNow: [...level.values()].filter((l) => l === 0).length,
    width: width(nodes),
  };
}

/** How many rounds a wait adds to the whole plan (0 when it fits in the slack). */
export function waitCost<K>(nodes: readonly Node<K>[], id: K, dep: K): number {
  const without = nodes.map((n) => (n.id === id ? { id, after: n.after.filter((a) => a !== dep) } : n));
  const withIt = nodes.map((n) => (n.id === id ? { id, after: [...n.after.filter((a) => a !== dep), dep] } : n));
  return height(withIt) - height(without);
}

/* ------------------------------------------------------------ who sees what */

/** People with "see" see everything; others see their own part. */
export const seesAll = (p: Person): boolean => has(p.perms, 'see');

/** Is the task this person's own plan? */
export const ownsTask = (t: Task, who: PersonId): boolean => t.createdBy === who;

export function hasStepFor(s: State, t: Task, who: PersonId): boolean {
  return stepsOf(s, t.id).some((st) => st.who === who);
}

export function canSeeTask(s: State, me: Person, t: Task): boolean {
  return seesAll(me) || ownsTask(t, me.id) || hasStepFor(s, t, me.id);
}

/**
 * The steps of a task this person sees: all of them for people who see
 * everything and for the plan's owner; otherwise their own steps and the steps
 * right next to theirs (what they wait for, and who waits for them).
 */
export function visibleSteps(s: State, me: Person, t: Task): readonly Step[] {
  const steps = stepsOf(s, t.id);
  if (seesAll(me) || ownsTask(t, me.id)) return steps;
  const mine = new Set(steps.filter((st) => st.who === me.id).map((st) => st.id));
  const near = new Set(mine);
  for (const st of steps) {
    if (mine.has(st.id)) for (const d of st.after) near.add(d);
    if (st.after.some((d) => mine.has(d))) near.add(st.id);
  }
  return steps.filter((st) => near.has(st.id));
}

/**
 * Can this person see what a change was about? People who see everything see
 * all of it; so does a plan's owner. Others see people changes, tasks they can
 * see, and only the steps of those tasks that `visibleSteps` shows them. A
 * thing that has since been removed is judged from history: a removed task by
 * who made it, a removed step by who it was given to.
 */
export function changeVisibleTo(
  s: State,
  facts: ReadonlyMap<TaskId, TaskFacts>,
  stepFacts: ReadonlyMap<StepId, StepFacts>,
  me: Person,
): (c: Change) => boolean {
  if (seesAll(me)) return () => true;
  const shownSteps = new Map<TaskId, Set<StepId>>();
  const taskVisible = (id: TaskId): boolean => {
    const t = s.tasks.get(id);
    return t ? canSeeTask(s, me, t) : facts.get(id)?.createdBy === me.id;
  };
  const stepVisible = (id: StepId, task: TaskId | undefined): boolean => {
    if (task === undefined) return false;
    const t = s.tasks.get(task);
    if (!t) return facts.get(task)?.createdBy === me.id;
    if (ownsTask(t, me.id)) return true;
    if (!canSeeTask(s, me, t)) return stepFacts.get(id)?.who === me.id;
    let shown = shownSteps.get(task);
    if (!shown) {
      shown = new Set(visibleSteps(s, me, t).map((st) => st.id));
      shownSteps.set(task, shown);
    }
    return s.steps.has(id) ? shown.has(id) : stepFacts.get(id)?.who === me.id;
  };
  return (c) => {
    switch (c.op) {
      case 'person.add':
      case 'person.remove':
      case 'person.perms':
        return true;
      case 'task.add':
      case 'task.remove':
        return taskVisible(c.task.id);
      case 'task.edit':
      case 'task.check':
        return taskVisible(c.id);
      case 'step.add':
      case 'step.remove':
        return stepVisible(c.step.id, c.step.task);
      default:
        return stepVisible(c.id, s.steps.get(c.id)?.task ?? stepFacts.get(c.id)?.task);
    }
  };
}
