import type { PersonId, TaskId } from './ids';
import type { Perms } from './permissions';

export interface Task {
  readonly id: TaskId;
  readonly text: string;
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
 * The published state of a list. Tasks are a set keyed by id: there is no
 * stored order, so changes never depend on positions and undo can always put a
 * task back exactly where it belongs (order is derived from createdAt).
 */
export interface State {
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly people: ReadonlyMap<PersonId, Person>;
}

export const EMPTY_STATE: State = { tasks: new Map(), people: new Map() };

export const MAX_TEXT = 120;
export const MAX_NAME = 40;

/** Trim, collapse runs of whitespace, drop control characters. */
export function cleanText(s: string): string {
  return s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Same words, ignoring case and spacing. Used to stop accidental duplicates (double taps). */
export function sameText(a: string, b: string): boolean {
  return cleanText(a).toLocaleLowerCase() === cleanText(b).toLocaleLowerCase();
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

export function personEquals(a: Person, b: Person): boolean {
  return a.id === b.id && a.name === b.name && a.hue === b.hue && a.perms === b.perms;
}

export function findOpenTask(s: State, text: string): Task | undefined {
  for (const t of s.tasks.values()) if (!t.done && sameText(t.text, text)) return t;
  return undefined;
}
