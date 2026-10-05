import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyChange, changeEquals, entityOf, invert, type Change } from '../changes';
import { applySet, compose, invertSet, normalize, rebaseSet } from '../changeset';
import { PersonId, TaskId } from '../ids';
import { EMPTY_STATE, type State } from '../model';
import { scenarioArb, stateEquals } from './gen';

const runs = { numRuns: 400 };

function mustApply(s: State, cs: readonly Change[]): State {
  const r = applySet(s, cs);
  if (!r.ok) throw new Error(`expected to apply, got ${r.error.code} at ${r.error.index}`);
  return r.value;
}

const sameChanges = (a: readonly Change[], b: readonly Change[]) =>
  a.length === b.length && a.every((c, i) => changeEquals(c, b[i]!));

describe('changes form a groupoid', () => {
  it('every change has an exact inverse', () => {
    fc.assert(
      fc.property(scenarioArb, ({ start, changes, end }) => {
        expect(stateEquals(mustApply(end, invertSet(changes)), start)).toBe(true);
      }),
      runs,
    );
  });

  it('inverting twice gives the same change', () => {
    fc.assert(
      fc.property(scenarioArb, ({ changes }) => {
        for (const c of changes) expect(changeEquals(invert(invert(c)), c)).toBe(true);
      }),
      runs,
    );
  });

  it('composition is concatenation: applying A then B equals applying A·B', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ start, changes }, cut) => {
        const k = changes.length === 0 ? 0 : cut % (changes.length + 1);
        const a = changes.slice(0, k);
        const b = changes.slice(k);
        expect(stateEquals(mustApply(mustApply(start, a), b), mustApply(start, compose(a, b)))).toBe(true);
        expect(sameChanges(invertSet(compose(a, b)), compose(invertSet(b), invertSet(a)))).toBe(true);
      }),
      runs,
    );
  });

  it('the empty change set is the identity', () => {
    fc.assert(
      fc.property(scenarioArb, ({ end }) => {
        expect(stateEquals(mustApply(end, []), end)).toBe(true);
      }),
      runs,
    );
  });

  it('an old change can be undone whenever nothing later touched the same thing', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ start, changes, end }, pick) => {
        if (changes.length === 0) return;
        const i = pick % changes.length;
        const c = changes[i]!;
        const later = changes.slice(i + 1);
        if (later.some((x) => entityOf(x) === entityOf(c))) return;
        const undone = applyChange(end, invert(c));
        expect(undone.ok).toBe(true);
        if (undone.ok) {
          const without = mustApply(start, [...changes.slice(0, i), ...later]);
          expect(stateEquals(undone.value, without)).toBe(true);
        }
      }),
      runs,
    );
  });

  it('a change that does not fit is a conflict, never a silent overwrite', () => {
    const task = { id: TaskId('t1'), text: 'Tea', done: false, createdAt: 1, createdBy: PersonId('p') };
    const s = mustApply(EMPTY_STATE, [{ op: 'task.add', task }]);
    const r = applyChange(s, { op: 'task.edit', id: task.id, from: 'Coffee', to: 'Juice' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('differs');
    expect(s.tasks.get(task.id)?.text).toBe('Tea');
  });
});

describe('normal form', () => {
  it('does the same thing as the original', () => {
    fc.assert(
      fc.property(scenarioArb, ({ start, changes, end }) => {
        expect(stateEquals(mustApply(start, normalize(changes)), end)).toBe(true);
      }),
      runs,
    );
  });

  it('is idempotent and never longer', () => {
    fc.assert(
      fc.property(scenarioArb, ({ changes }) => {
        const n = normalize(changes);
        expect(sameChanges(normalize(n), n)).toBe(true);
        expect(n.length).toBeLessThanOrEqual(changes.length);
      }),
      runs,
    );
  });

  it('cancels a change set followed by its inverse completely', () => {
    fc.assert(
      fc.property(scenarioArb, ({ changes }) => {
        expect(normalize(compose(changes, invertSet(changes)))).toEqual([]);
      }),
      runs,
    );
  });

  it('collapses a task added, edited, ticked and removed to nothing', () => {
    const task = { id: TaskId('t'), text: 'a', done: false, createdAt: 0, createdBy: PersonId('p') };
    const cs: Change[] = [
      { op: 'task.add', task },
      { op: 'task.edit', id: task.id, from: 'a', to: 'b' },
      { op: 'task.check', id: task.id, from: false, to: true },
      { op: 'task.remove', task: { ...task, text: 'b', done: true } },
    ];
    expect(normalize(cs)).toEqual([]);
  });

  it('merges edits past a tick on the same task', () => {
    const id = TaskId('t');
    const cs: Change[] = [
      { op: 'task.edit', id, from: 'a', to: 'b' },
      { op: 'task.check', id, from: false, to: true },
      { op: 'task.edit', id, from: 'b', to: 'c' },
    ];
    expect(normalize(cs)).toEqual([
      { op: 'task.edit', id, from: 'a', to: 'c' },
      { op: 'task.check', id, from: false, to: true },
    ]);
  });
});

describe('rebase', () => {
  it('leaves a change set that already fits unchanged in effect', () => {
    fc.assert(
      fc.property(scenarioArb, ({ start, changes, end }) => {
        const r = rebaseSet(start, changes);
        expect(r.ok).toBe(true);
        if (r.ok) expect(stateEquals(r.value.state, end)).toBe(true);
      }),
      runs,
    );
  });

  it('removes a task as it is now, and drops intents that are already true', () => {
    const task = { id: TaskId('t'), text: 'Tea', done: false, createdAt: 0, createdBy: PersonId('p') };
    const s = mustApply(EMPTY_STATE, [
      { op: 'task.add', task },
      { op: 'task.check', id: task.id, from: false, to: true },
    ]);
    const r = rebaseSet(s, [
      { op: 'task.check', id: task.id, from: false, to: true },
      { op: 'task.remove', task },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.changes).toEqual([{ op: 'task.remove', task: { ...task, done: true } }]);
      expect(r.value.state.tasks.size).toBe(0);
    }
  });

  it('still refuses to overwrite words someone else changed', () => {
    const task = { id: TaskId('t'), text: 'Tea', done: false, createdAt: 0, createdBy: PersonId('p') };
    const s = mustApply(EMPTY_STATE, [{ op: 'task.add', task }]);
    const r = rebaseSet(s, [{ op: 'task.edit', id: task.id, from: 'Coffee', to: 'Juice' }]);
    expect(r.ok).toBe(false);
  });
});
