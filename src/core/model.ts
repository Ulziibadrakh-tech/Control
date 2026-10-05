import type { PersonId, StepId, TaskId } from './ids';
import type { Perms } from './permissions';

export interface Task {
  readonly id: TaskId;
  readonly text: string;
  /** Only meaningful for a task without steps; a task with steps is done when all its steps are. */
  readonly done: boolean;
  readonly createdAt: number;
  readonly createdBy: PersonId;
}

/**
 * One step of a task's plan. Steps that do not wait for each other can be
 * done at the same time; `after` lists the steps of the same task this one
 * waits for. Together they form a partial order (see poset.ts).
 */
export interface Step {
  readonly id: StepId;
  readonly task: TaskId;
  /** A stable label within the task ("step 3"). Never reused, never changed. */
  readonly n: number;
  readonly text: string;
  /** Who does it. */
  readonly who: PersonId;
  /** Steps of the same task this one waits for. Sorted, no repeats. */
  readonly after: readonly StepId[];
  readonly done: boolean;
  readonly createdAt: number;
  readonly createdBy: PersonId;
}

export const HUES = ['clay', 'sage', 'sky', 'plum', 'ochre'] as const;
export type Hue = (typeof HUES)[number];

export interface Person {
  readonly id: PersonId;
  readonly name: string;
  readonly hue: Hue;
  readonly perms: Perms;
}

/**
 * The published state. Tasks, steps and people are sets keyed by id: there is
 * no stored order, so changes never depend on positions and undo can always
 * put something back exactly where it belongs (order is derived).
 */
export interface State {
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly steps: ReadonlyMap<StepId, Step>;
  readonly people: ReadonlyMap<PersonId, Person>;
}

export const EMPTY_STATE: State = { tasks: new Map(), steps: new Map(), people: new Map() };

export const MAX_TEXT = 120;
export const MAX_NAME = 40;
/** Enough for a step for every student in a large class. */
export const MAX_STEPS = 60;

/** Trim, collapse runs of whitespace, drop control characters. */
export function cleanText(s: string): string {
  return s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Same words, ignoring case and spacing. Used to stop accidental duplicates (double taps). */
export function sameText(a: string, b: string): boolean {
  return cleanText(a).toLocaleLowerCase() === cleanText(b).toLocaleLowerCase();
}

/** Step ids in their canonical stored form: sorted, without repeats. */
export function canonicalIds(ids: Iterable<StepId>): StepId[] {
  return [...new Set(ids)].sort();
}

export function sameIds(a: readonly StepId[], b: readonly StepId[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function taskEquals(a: Task, b: Task): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.done === b.done &&
    a.createdAt === b.createdAt &&
    a.createdBy === b.createdBy
  );
}

export function stepEquals(a: Step, b: Step): boolean {
  return (
    a.id === b.id &&
    a.task === b.task &&
    a.n === b.n &&
    a.text === b.text &&
    a.who === b.who &&
    sameIds(a.after, b.after) &&
    a.done === b.done &&
    a.createdAt === b.createdAt &&
    a.createdBy === b.createdBy
  );
}

export function personEquals(a: Person, b: Person): boolean {
  return a.id === b.id && a.name === b.name && a.hue === b.hue && a.perms === b.perms;
}

/* ------------------------------------------------------- steps of a task */

const byTaskCache = new WeakMap<ReadonlyMap<StepId, Step>, Map<TaskId, Step[]>>();

/** A task's steps in their stable order (by n). Memoised per state, which never changes in place. */
export function stepsOf(s: State, task: TaskId): readonly Step[] {
  let index = byTaskCache.get(s.steps);
  if (!index) {
    index = new Map();
    for (const st of s.steps.values()) {
      const list = index.get(st.task);
      if (list) list.push(st);
      else index.set(st.task, [st]);
    }
    for (const list of index.values()) list.sort((a, b) => a.n - b.n || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    byTaskCache.set(s.steps, index);
  }
  return index.get(task) ?? [];
}

/** A task with steps is done when every step is; a task without steps carries its own tick. */
export function isTaskDone(s: State, t: Task): boolean {
  const steps = stepsOf(s, t.id);
  return steps.length > 0 ? steps.every((st) => st.done) : t.done;
}

export function findOpenTask(s: State, text: string): Task | undefined {
  for (const t of s.tasks.values()) if (!isTaskDone(s, t) && sameText(t.text, text)) return t;
  return undefined;
}
