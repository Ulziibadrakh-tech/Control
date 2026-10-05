import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ALL,
  NONE,
  PRESETS,
  atomFor,
  fromAtoms,
  has,
  join,
  leq,
  levelOf,
  meet,
  presetPerms,
  revoke,
  roleOf,
  smallestTeams,
  summarize,
  toAtoms,
  withFlag,
  withLevel,
  type Atom,
  type Perms,
} from '../permissions';
import { route } from '../policy';
import { PersonId, TaskId } from '../ids';
import { permsArb } from './gen';

const closed = (p: Perms) => ACTIONS.every((a) => !has(p, atomFor('do', a)) || has(p, atomFor('suggest', a)));

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

  it('every operation keeps sets closed under "do implies suggest"', () => {
    fc.assert(
      fc.property(permsArb, permsArb, fc.subarray([...toAtoms(ALL)]), (a, b, r) => {
        expect(closed(a)).toBe(true);
        expect(closed(join(a, b))).toBe(true);
        expect(closed(meet(a, b))).toBe(true);
        expect(closed(revoke(a, r))).toBe(true);
      }),
    );
  });

  it('revoke removes the atoms and everything implying them, and only shrinks', () => {
    fc.assert(
      fc.property(permsArb, fc.subarray([...toAtoms(ALL)]), (a, r) => {
        const out = revoke(a, r);
        expect(leq(out, a)).toBe(true);
        for (const atom of r) expect(has(out, atom)).toBe(false);
      }),
    );
    expect(has(revoke(presetPerms('editor'), ['suggest:add']), 'do:add')).toBe(false);
  });

  it('round-trips through readable atom names', () => {
    fc.assert(
      fc.property(permsArb, (a) => {
        expect(fromAtoms(toAtoms(a))).toBe(a);
      }),
    );
  });
});

describe('roles', () => {
  it('the preset ladder is a chain', () => {
    for (let i = 1; i < PRESETS.length; i++) {
      const lower = PRESETS[i - 1]!.perms;
      const upper = PRESETS[i]!.perms;
      expect(leq(lower, upper)).toBe(true);
      expect(lower).not.toBe(upper);
    }
  });

  it('names presets and recognises custom mixes', () => {
    for (const p of PRESETS) expect(roleOf(p.perms)).toBe(p.id);
    expect(roleOf(fromAtoms(['do:add', 'suggest:remove']))).toBe('custom');
  });

  it('sets a single action level without touching the others', () => {
    fc.assert(
      fc.property(permsArb, fc.constantFrom(...ACTIONS), fc.constantFrom('none', 'suggest', 'do') as fc.Arbitrary<'none' | 'suggest' | 'do'>, (p, action, level) => {
        const q = withLevel(p, action, level);
        expect(levelOf(q, action)).toBe(level);
        for (const other of ACTIONS) if (other !== action) expect(levelOf(q, other)).toBe(levelOf(p, other));
        expect(has(q, 'approve')).toBe(has(p, 'approve'));
      }),
    );
  });

  it('toggles flags', () => {
    expect(has(withFlag(NONE, 'approve', true), 'approve')).toBe(true);
    expect(has(withFlag(ALL, 'manage', false), 'manage')).toBe(false);
  });

  it('summarises for plain words', () => {
    const bat = fromAtoms(['do:add', 'do:check', 'suggest:edit', 'suggest:remove']);
    expect(summarize(bat)).toEqual({ can: ['add', 'check'], suggest: ['edit', 'remove'], approve: false, manage: false });
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
  const task = { id: TaskId('t'), text: 'x', done: false, createdAt: 0, createdBy: PersonId('p') };
  const add = [{ op: 'task.add' as const, task }];
  const remove = [{ op: 'task.remove' as const, task }];

  it('routes by what the action needs', () => {
    expect(route(NONE, add)).toEqual({ kind: 'deny', missing: ['suggest:add'] });
    expect(route(presetPerms('helper'), add)).toEqual({ kind: 'suggest' });
    expect(route(presetPerms('editor'), add)).toEqual({ kind: 'do' });
    const bat = fromAtoms(['do:add', 'suggest:remove']);
    expect(route(bat, add)).toEqual({ kind: 'do' });
    expect(route(bat, remove)).toEqual({ kind: 'suggest' });
    expect(route(bat, [...add, ...remove])).toEqual({ kind: 'suggest' });
  });

  it('granting more never makes an action less possible (routing is monotone)', () => {
    const rank = { deny: 0, suggest: 1, do: 2 } as const;
    const changes = [add, remove, [...add, ...remove]];
    fc.assert(
      fc.property(permsArb, permsArb, fc.constantFrom(...changes), (p, extra, cs) => {
        const more = join(p, extra);
        expect(rank[route(more, cs).kind]).toBeGreaterThanOrEqual(rank[route(p, cs).kind]);
      }),
    );
  });

  it('never lets people changes be suggested', () => {
    const person = { id: PersonId('q'), name: 'Q', hue: 'sage' as const, perms: NONE };
    expect(route(presetPerms('approver'), [{ op: 'person.add', person }])).toEqual({ kind: 'deny', missing: ['manage'] });
    expect(route(ALL, [{ op: 'person.add', person }])).toEqual({ kind: 'do' });
  });
});
