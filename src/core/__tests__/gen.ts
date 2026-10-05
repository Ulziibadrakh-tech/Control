/** Generators for property tests: random but always-valid histories. */
import fc from 'fast-check';
import { applyChange, type Change } from '../changes';
import { PersonId, StepId, TaskId } from '../ids';
import { canonicalIds, EMPTY_STATE, personEquals, stepEquals, taskEquals, type Person, type State, type Step, type Task } from '../model';
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
  kind: fc.integer({ min: 0, max: 16 }),
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
  readonly steps: Step[];
  readonly people: Person[];
}

/** Turn an intent into a change that is valid for `s` (or nothing, if none fits). */
function toChange(s: State, it: Intent, nextId: () => string, gone: Graveyard): Change | null {
  const tasks = [...s.tasks.values()];
  const people = [...s.people.values()];
  const steps = [...s.steps.values()];
  const task = tasks.length > 0 ? tasks[it.pick % tasks.length] : undefined;
  const st = steps.length > 0 ? steps[it.pick % steps.length] : undefined;
  const person = people.length > 0 ? people[it.pick % people.length] : undefined;
  // A few existing step ids to wait for; invariants are not the business of single changes.
  const someSteps = canonicalIds(steps.filter((_, i) => (it.pick + i) % 3 === 0).map((x) => x.id));
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
    case 10:
      return task
        ? {
            op: 'step.add',
            step: {
              id: StepId(nextId()),
              task: task.id,
              n: it.pick,
              text,
              who: person?.id ?? PersonId('p0'),
              after: someSteps,
              done: it.flag,
              createdAt: it.pick,
              createdBy: PersonId('p0'),
            },
          }
        : null;
    case 11:
      return st ? { op: 'step.remove', step: st } : null;
    case 12:
      return st ? { op: 'step.edit', id: st.id, from: st.text, to: text } : null;
    case 13:
      return st ? { op: 'step.check', id: st.id, from: st.done, to: it.flag } : null;
    case 14:
      return st ? { op: 'step.assign', id: st.id, from: st.who, to: person?.id ?? PersonId(`p${it.text}`) } : null;
    case 15:
      return st ? { op: 'step.deps', id: st.id, from: st.after, to: someSteps.filter((d) => d !== st.id) } : null;
    case 16: {
      const old = gone.steps.length > 0 ? gone.steps[it.pick % gone.steps.length] : undefined;
      if (!old || s.steps.has(old.id)) return null;
      return { op: 'step.add', step: it.flag ? old : { ...old, text, done: !old.done, after: someSteps } };
    }
    default:
      return { op: 'person.add', person: { id: PersonId(nextId()), name: text, hue: 'sky', perms: it.perms } };
  }
}

export function realize(
  s: State,
  intents: readonly Intent[],
  nextId: () => string,
  gone: Graveyard = { tasks: [], steps: [], people: [] },
): { changes: Change[]; end: State } {
  let cur = s;
  const changes: Change[] = [];
  for (const it of intents) {
    const c = toChange(cur, it, nextId, gone);
    if (!c) continue;
    if (c.op === 'task.remove') gone.tasks.push(c.task);
    if (c.op === 'step.remove') gone.steps.push(c.step);
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
  .tuple(fc.array(intentArb, { maxLength: 14 }), fc.array(intentArb, { maxLength: 20 }))
  .map(([setup, more]) => {
    const nextId = counter();
    const gone: Graveyard = { tasks: [], steps: [], people: [] };
    const start = realize(EMPTY_STATE, setup, nextId, gone).end;
    const { changes, end } = realize(start, more, nextId, gone);
    return { start, changes, end };
  });

export function stateEquals(a: State, b: State): boolean {
  if (a.tasks.size !== b.tasks.size || a.steps.size !== b.steps.size || a.people.size !== b.people.size) return false;
  for (const [id, t] of a.tasks) {
    const u = b.tasks.get(id);
    if (!u || !taskEquals(t, u)) return false;
  }
  for (const [id, t] of a.steps) {
    const u = b.steps.get(id);
    if (!u || !stepEquals(t, u)) return false;
  }
  for (const [id, p] of a.people) {
    const q = b.people.get(id);
    if (!q || !personEquals(p, q)) return false;
  }
  return true;
}
