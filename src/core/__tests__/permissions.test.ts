import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ALL,
  ATOMS,
  LADDERS,
  NONE,
  STANDARDS,
  atomFor,
  fromAtoms,
  has,
  isDownSet,
  join,
  leq,
  levelOf,
  meet,
  missing,
  presetPerms,
  rankOf,
  revoke,
  roleOf,
  smallestTeams,
  summarize,
  toAtoms,
  withFlag,
  withLevel,
  type Atom,
  type LevelChoice,
  type Scope,
} from '../permissions';
import { route } from '../policy';
import { PersonId, StepId, TaskId } from '../ids';
import { EMPTY_STATE, type State, type Step, type Task } from '../model';
import { permsArb } from './gen';

const levelArb = fc.constantFrom<LevelChoice>('none', 'suggest', 'do');
const scopeArb = fc.constantFrom<Scope>('own', 'all');

describe('permission lattice laws', () => {
  it('join is associative, commutative and idempotent, with NONE as identity', () => {
    fc.assert(
      fc.property(permsArb, permsArb, permsArb, (a, b, c) => {
        expect(join(a, join(b, c))).toBe(join(join(a, b), c));
        expect(join(a, b)).toBe(join(b, a));
        expect(join(a, a)).toBe(a);
        expect(join(a, NONE)).toBe(a);
      }),
    );
  });

  it('meet is the dual, with ALL as identity', () => {
    fc.assert(
      fc.property(permsArb, permsArb, permsArb, (a, b, c) => {
        expect(meet(a, meet(b, c))).toBe(meet(meet(a, b), c));
        expect(meet(a, b)).toBe(meet(b, a));
        expect(meet(a, a)).toBe(a);
        expect(meet(a, ALL)).toBe(a);
      }),
    );
  });

  it('absorbs and distributes (a distributive lattice)', () => {
    fc.assert(
      fc.property(permsArb, permsArb, permsArb, (a, b, c) => {
        expect(join(a, meet(a, b))).toBe(a);
        expect(meet(a, join(a, b))).toBe(a);
        expect(meet(a, join(b, c))).toBe(join(meet(a, b), meet(a, c)));
      }),
    );
  });

  it('has no inverses: nothing but NONE can be cancelled by a join', () => {
    fc.assert(
      fc.property(permsArb, permsArb, (a, b) => {
        if (join(a, b) === NONE) expect(a).toBe(NONE);
      }),
    );
  });

  it('every operation keeps sets closed downwards', () => {
    fc.assert(
      fc.property(permsArb, permsArb, fc.subarray([...ATOMS]), (a, b, r) => {
        expect(isDownSet(a)).toBe(true);
        expect(isDownSet(join(a, b))).toBe(true);
        expect(isDownSet(meet(a, b))).toBe(true);
        expect(isDownSet(revoke(a, r))).toBe(true);
      }),
    );
  });

  it('follows the order of the atoms: do implies suggest, all implies own, acting on all implies seeing', () => {
    for (const action of ACTIONS) {
      const doAll = fromAtoms([atomFor('do', action, 'all')]);
      expect(toAtoms(doAll).sort()).toEqual(
        [atomFor('do', action, 'all'), atomFor('do', action, 'own'), atomFor('suggest', action, 'all'), atomFor('suggest', action, 'own'), 'see'].sort(),
      );
      // Own-scope rights never imply seeing everything.
      expect(has(fromAtoms([atomFor('do', action, 'own')]), 'see')).toBe(false);
    }
    expect(has(fromAtoms(['approve']), 'see')).toBe(true);
    expect(has(fromAtoms(['manage']), 'see')).toBe(false);
  });

  it('revoke removes the atoms and everything implying them, and only shrinks', () => {
    fc.assert(
      fc.property(permsArb, fc.subarray([...ATOMS]), (a, r) => {
        const out = revoke(a, r);
        expect(leq(out, a)).toBe(true);
        for (const atom of r) expect(has(out, atom)).toBe(false);
      }),
    );
    expect(has(revoke(presetPerms('editor'), ['suggest:add']), 'do:add')).toBe(false);
    // Taking away "see" takes away every right over other people's things, and approving.
    const t = revoke(presetPerms('teacher'), ['see']);
    expect(has(t, 'approve')).toBe(false);
    expect(levelOf(t, 'add', 'all')).toBe('none');
    expect(levelOf(t, 'add', 'own')).toBe('do');
  });

  it('round-trips through readable atom names', () => {
    fc.assert(
      fc.property(permsArb, (a) => {
        expect(fromAtoms(toAtoms(a))).toBe(a);
      }),
    );
  });

  it('names only the atoms worth naming when something is missing', () => {
    expect(missing(NONE, fromAtoms(['do:add']))).toEqual(['do:add']);
    expect(missing(fromAtoms(['suggest:add']), fromAtoms(['do:add']))).toEqual(['do:add']);
  });
});

describe('roles', () => {
  it('each ladder is a chain', () => {
    for (const standard of STANDARDS) {
      const ladder = LADDERS[standard];
      for (let i = 1; i < ladder.length; i++) {
        const lower = ladder[i - 1]!.perms;
        const upper = ladder[i]!.perms;
        expect(leq(lower, upper)).toBe(true);
        expect(lower).not.toBe(upper);
      }
    }
  });

  it('names presets and recognises custom mixes', () => {
    for (const standard of STANDARDS) for (const p of LADDERS[standard]) expect(roleOf(p.perms, standard)).toBe(p.id);
    expect(roleOf(fromAtoms(['do:add', 'suggest:remove']), 'home')).toBe('custom');
  });

  it('finds the highest rung someone holds, even with extra rights', () => {
    const teacherPlus = join(presetPerms('teacher'), fromAtoms(['manage']));
    expect(roleOf(teacherPlus, 'school')).toBe('custom');
    expect(rankOf(teacherPlus, 'school')).toBe('teacher');
    expect(rankOf(NONE, 'school')).toBeNull();
    expect(rankOf(presetPerms('student'), 'school')).toBe('student');
  });

  it('school roles: students and parents act on their own part only', () => {
    const student = presetPerms('student');
    expect(levelOf(student, 'check', 'own')).toBe('do');
    expect(levelOf(student, 'check', 'all')).toBe('none');
    expect(levelOf(student, 'add', 'own')).toBe('suggest');
    expect(has(student, 'see')).toBe(false);
    const teacher = presetPerms('teacher');
    expect(levelOf(teacher, 'remove', 'own')).toBe('do');
    expect(levelOf(teacher, 'remove', 'all')).toBe('suggest');
    expect(has(teacher, 'approve')).toBe(true);
  });

  it('sets one action level for one scope without touching the others, and stays a down-set', () => {
    fc.assert(
      fc.property(permsArb, fc.constantFrom(...ACTIONS), levelArb, scopeArb, (p, action, level, scope) => {
        const q = withLevel(p, action, level, scope);
        expect(isDownSet(q)).toBe(true);
        expect(levelOf(q, action, scope)).toBe(level);
        for (const other of ACTIONS) {
          if (other === action) continue;
          expect(levelOf(q, other, 'own')).toBe(levelOf(p, other, 'own'));
          expect(levelOf(q, other, 'all')).toBe(levelOf(p, other, 'all'));
        }
        expect(has(q, 'approve')).toBe(has(p, 'approve'));
        expect(has(q, 'manage')).toBe(has(p, 'manage'));
      }),
    );
  });

  it('raising "anyone’s" raises "own", lowering "own" lowers "anyone’s"', () => {
    expect(levelOf(withLevel(NONE, 'add', 'do', 'all'), 'add', 'own')).toBe('do');
    const both = withLevel(NONE, 'add', 'do', 'all');
    expect(levelOf(withLevel(both, 'add', 'suggest', 'own'), 'add', 'all')).toBe('suggest');
    // A teacher's mix survives: do their own, suggest for others.
    const t = withLevel(withLevel(NONE, 'edit', 'do', 'own'), 'edit', 'suggest', 'all');
    expect([levelOf(t, 'edit', 'own'), levelOf(t, 'edit', 'all')]).toEqual(['do', 'suggest']);
  });

  it('toggles flags', () => {
    expect(has(withFlag(NONE, 'approve', true), 'approve')).toBe(true);
    expect(has(withFlag(ALL, 'manage', false), 'manage')).toBe(false);
  });

  it('summarises for plain words', () => {
    const bat = fromAtoms(['do:add', 'do:check', 'suggest:edit', 'suggest:remove']);
    const s = summarize(bat);
    expect(s.all).toEqual({ add: 'do', check: 'do', edit: 'suggest', remove: 'suggest' });
    expect(s.see).toBe(true);
    expect(summarize(presetPerms('student')).own).toEqual({ add: 'suggest', check: 'do', edit: 'none', remove: 'none' });
  });
});

describe('teams: what people can do together', () => {
  const saraa = { name: 'Saraa', perms: fromAtoms(['suggest:add']) };
  const bat = { name: 'Bat', perms: fromAtoms(['suggest:remove', 'do:check']) };
  const anu = { name: 'Anu', perms: presetPerms('approver') };

  it('finds the smallest groups whose joint permissions cover a need', () => {
    const need = fromAtoms(['suggest:add', 'suggest:remove']);
    const teams = smallestTeams([saraa, bat, anu], (p) => p.perms, need);
    expect(teams.map((t) => t.map((p) => p.name))).toEqual([['Anu']]);
    const withoutAnu = smallestTeams([saraa, bat], (p) => p.perms, need);
    expect(withoutAnu.map((t) => t.map((p) => p.name))).toEqual([['Saraa', 'Bat']]);
  });

  it('returns nothing when no group can cover it', () => {
    expect(smallestTeams([saraa, bat], (p) => p.perms, fromAtoms(['approve' as Atom]))).toEqual([]);
  });
});

describe('routing', () => {
  const me = PersonId('me');
  const other = PersonId('other');
  const mine: Task = { id: TaskId('t'), text: 'x', done: false, createdAt: 0, createdBy: me };
  const theirs: Task = { ...mine, id: TaskId('u'), createdBy: other };
  const st: Step = {
    id: StepId('s'),
    task: theirs.id,
    n: 1,
    text: 'y',
    who: me,
    after: [],
    done: false,
    createdAt: 0,
    createdBy: other,
  };
  const s: State = {
    ...EMPTY_STATE,
    tasks: new Map([
      [mine.id, mine],
      [theirs.id, theirs],
    ]),
    steps: new Map([[st.id, st]]),
  };
  const add = [{ op: 'task.add' as const, task: { ...mine, id: TaskId('new') } }];
  const removeMine = [{ op: 'task.remove' as const, task: mine }];
  const removeTheirs = [{ op: 'task.remove' as const, task: theirs }];
  const tickMyStep = [{ op: 'step.check' as const, id: st.id, from: false, to: true }];

  it('routes by what the action needs, and whose thing it is', () => {
    expect(route(NONE, add, s, me)).toEqual({ kind: 'deny', missing: ['suggest:add@own'] });
    expect(route(presetPerms('helper'), add, s, me)).toEqual({ kind: 'suggest' });
    expect(route(presetPerms('editor'), add, s, me)).toEqual({ kind: 'do' });
    const teacher = presetPerms('teacher');
    expect(route(teacher, removeMine, s, me)).toEqual({ kind: 'do' });
    expect(route(teacher, removeTheirs, s, me)).toEqual({ kind: 'suggest' });
    const student = presetPerms('student');
    expect(route(student, tickMyStep, s, me)).toEqual({ kind: 'do' });
    expect(route(student, tickMyStep, s, other).kind).toBe('do'); // the plan's owner ticks it too
    expect(route(student, removeTheirs, s, me)).toEqual({ kind: 'deny', missing: ['suggest:remove'] });
  });

  it('counts a new plan’s steps as the owner’s own', () => {
    const task: Task = { ...mine, id: TaskId('plan') };
    const plan = [
      { op: 'task.add' as const, task },
      { op: 'step.add' as const, step: { ...st, id: StepId('p1'), task: task.id, who: other } },
    ];
    expect(route(presetPerms('teacher'), plan, s, me)).toEqual({ kind: 'do' });
    expect(route(presetPerms('student'), plan, s, me)).toEqual({ kind: 'suggest' });
  });

  it('granting more never makes an action less possible (routing is monotone)', () => {
    const rank = { deny: 0, suggest: 1, do: 2 } as const;
    const changes = [add, removeMine, removeTheirs, tickMyStep, [...add, ...removeTheirs]];
    fc.assert(
      fc.property(permsArb, permsArb, fc.constantFrom(...changes), fc.constantFrom(me, other), (p, extra, cs, who) => {
        const more = join(p, extra);
        expect(rank[route(more, cs, s, who).kind]).toBeGreaterThanOrEqual(rank[route(p, cs, s, who).kind]);
      }),
    );
  });

  it('never lets people changes be suggested', () => {
    const person = { id: PersonId('q'), name: 'Q', hue: 'sage' as const, perms: NONE };
    expect(route(presetPerms('approver'), [{ op: 'person.add', person }], s, me)).toEqual({ kind: 'deny', missing: ['manage'] });
    expect(route(ALL, [{ op: 'person.add', person }], s, me)).toEqual({ kind: 'do' });
  });
});
