/** Generators for property tests: random but always-valid histories. */
import fc from 'fast-check';
import { applyChange, type Change } from '../changes';
import { PersonId, TaskId } from '../ids';
import { EMPTY_STATE, personEquals, taskEquals, type Person, type State, type Task } from '../model';
import { ATOMS, fromAtoms, type Perms } from '../permissions';

export const TEXTS = ['Buy bread', 'Call Anu', 'Walk', 'Pills', 'Water', 'Tea'] as const;

export const permsArb: fc.Arbitrary<Perms> = fc.subarray([...ATOMS]).map(fromAtoms);

export interface Intent {
  readonly kind: number;
  readonly pick: number;
  readonly text: number;
  readonly flag: boolean;
  readonly perms: Perms;
}

export const intentArb: fc.Arbitrary<Intent> = fc.record({
  kind: fc.integer({ min: 0, max: 9 }),
  pick: fc.nat(20),
  text: fc.nat(TEXTS.length - 1),
  flag: fc.boolean(),
  perms: permsArb,
});

export function counter(prefix = 'x'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Things removed earlier, so they can come back under the same id (as undo and "go back" do). */
export interface Graveyard {
  readonly tasks: Task[];
  readonly people: Person[];
}

/** Turn an intent into a change that is valid for `s` (or nothing, if none fits). */
function toChange(s: State, it: Intent, nextId: () => string, gone: Graveyard): Change | null {
  const tasks = [...s.tasks.values()];
  const people = [...s.people.values()];
  const task = tasks.length > 0 ? tasks[it.pick % tasks.length] : undefined;
  const person = people.length > 0 ? people[it.pick % people.length] : undefined;
  const text = TEXTS[it.text] ?? 'Tea';
  switch (it.kind) {
    case 0:
    case 1:
      return {
        op: 'task.add',
        task: { id: TaskId(nextId()), text, done: it.flag, createdAt: it.pick, createdBy: PersonId('p0') },
      };
    case 2:
      return task ? { op: 'task.remove', task } : null;
    case 3:
      return task ? { op: 'task.edit', id: task.id, from: task.text, to: text } : null;
    case 4:
      return task ? { op: 'task.check', id: task.id, from: task.done, to: it.flag } : null;
    case 5:
      return person
        ? { op: 'person.perms', id: person.id, from: person.perms, to: it.perms }
        : { op: 'person.add', person: { id: PersonId(nextId()), name: text, hue: 'sage', perms: it.perms } };
    case 6:
      return person ? { op: 'person.remove', person } : null;
    case 8: {
      // A removed task comes back under its old id, possibly with other words or tick.
      const old = gone.tasks.length > 0 ? gone.tasks[it.pick % gone.tasks.length] : undefined;
      if (!old || s.tasks.has(old.id)) return null;
      return { op: 'task.add', task: it.flag ? old : { ...old, text, done: !old.done } };
    }
    case 9: {
      const old = gone.people.length > 0 ? gone.people[it.pick % gone.people.length] : undefined;
      if (!old || s.people.has(old.id)) return null;
      return { op: 'person.add', person: it.flag ? old : { ...old, perms: it.perms } };
    }
    default:
      return { op: 'person.add', person: { id: PersonId(nextId()), name: text, hue: 'sky', perms: it.perms } };
  }
}

export function realize(
  s: State,
  intents: readonly Intent[],
  nextId: () => string,
  gone: Graveyard = { tasks: [], people: [] },
): { changes: Change[]; end: State } {
  let cur = s;
  const changes: Change[] = [];
  for (const it of intents) {
    const c = toChange(cur, it, nextId, gone);
    if (!c) continue;
    if (c.op === 'task.remove') gone.tasks.push(c.task);
    if (c.op === 'person.remove') gone.people.push(c.person);
    const r = applyChange(cur, c);
    if (!r.ok) throw new Error(`generator produced an invalid change: ${JSON.stringify(c)}`);
    cur = r.value;
    changes.push(c);
  }
  return { changes, end: cur };
}

export interface Scenario {
  readonly start: State;
  readonly changes: Change[];
  readonly end: State;
}

export const scenarioArb: fc.Arbitrary<Scenario> = fc
  .tuple(fc.array(intentArb, { maxLength: 10 }), fc.array(intentArb, { maxLength: 16 }))
  .map(([setup, more]) => {
    const nextId = counter();
    const gone: Graveyard = { tasks: [], people: [] };
    const start = realize(EMPTY_STATE, setup, nextId, gone).end;
    const { changes, end } = realize(start, more, nextId, gone);
    return { start, changes, end };
  });

export function stateEquals(a: State, b: State): boolean {
  if (a.tasks.size !== b.tasks.size || a.people.size !== b.people.size) return false;
  for (const [id, t] of a.tasks) {
    const u = b.tasks.get(id);
    if (!u || !taskEquals(t, u)) return false;
  }
  for (const [id, p] of a.people) {
    const q = b.people.get(id);
    if (!q || !personEquals(p, q)) return false;
  }
  return true;
}
