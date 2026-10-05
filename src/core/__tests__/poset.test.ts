/**
 * The classical facts the plan view relies on, checked on random plans.
 * Brute force is the referee: every claim is compared with an exhaustive search.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  before,
  findCycle,
  foata,
  height,
  levels,
  longestChain,
  predecessors,
  ready,
  remaining,
  rounds,
  widestRound,
  width,
  withoutStep,
  wouldCycle,
  type Node,
} from '../poset';
import { shapeOf, waitCost } from '../plan';

const runs = { numRuns: 300 };

/** A random plan: ids shuffled, links only from earlier to later in a hidden order, so never a circle. */
const dagArb: fc.Arbitrary<Node<string>[]> = fc
  .integer({ min: 1, max: 9 })
  .chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.array(fc.boolean(), { minLength: (n * (n - 1)) / 2, maxLength: (n * (n - 1)) / 2 }),
      fc.shuffledSubarray(
        Array.from({ length: n }, (_, i) => `s${i}`),
        { minLength: n, maxLength: n },
      ),
    ),
  )
  .map(([n, bits, order]) => {
    const after: string[][] = Array.from({ length: n }, () => []);
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < j; i++) if (bits[k++]) after[j]!.push(order[i]!);
    return order.map((id, j) => ({ id, after: after[j]! }));
  });

/** A random order of doing the steps that respects the waits (a linear extension). */
function linearExtension(nodes: readonly Node<string>[], seed: number): string[] {
  const done = new Set<string>();
  const out: string[] = [];
  let s = seed;
  while (out.length < nodes.length) {
    const avail = nodes.filter((n) => !done.has(n.id) && n.after.every((a) => done.has(a)));
    s = (s * 1103515245 + 12345) % 2147483648;
    const pick = avail[s % avail.length]!;
    done.add(pick.id);
    out.push(pick.id);
  }
  return out;
}

function subsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => (m >> i) & 1));
  return out;
}

function longestByBruteForce(nodes: readonly Node<string>[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const len = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const l = 1 + Math.max(0, ...(byId.get(id)?.after ?? []).map(len));
    memo.set(id, l);
    return l;
  };
  return Math.max(0, ...nodes.map((n) => len(n.id)));
}

describe('rounds are the levels of the partial order', () => {
  it('partition the steps into antichains, each step after everything it waits for', () => {
    fc.assert(
      fc.property(dagArb, (nodes) => {
        const rs = rounds(nodes);
        const pred = predecessors(nodes);
        expect(rs.flat().sort()).toEqual(nodes.map((n) => n.id).sort());
        for (const r of rs) for (const a of r) for (const b of r) expect(before(pred, a, b)).toBe(false);
        const level = levels(nodes);
        for (const n of nodes) for (const d of n.after) expect(level.get(n.id)!).toBeGreaterThan(level.get(d)!);
      }),
      runs,
    );
  });

  it('number exactly the longest chain of waits (Mirsky), so no schedule is shorter', () => {
    fc.assert(
      fc.property(dagArb, (nodes) => {
        const h = height(nodes);
        expect(h).toBe(longestByBruteForce(nodes));
        const chain = longestChain(nodes);
        expect(chain.length).toBe(h);
        for (let i = 1; i < chain.length; i++) expect(nodes.find((n) => n.id === chain[i])!.after).toContain(chain[i - 1]);
      }),
      runs,
    );
  });

  it('are the Foata normal form of every order that respects the waits', () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), (nodes, seed) => {
        const pred = predecessors(nodes);
        const word = linearExtension(nodes, seed);
        const related = (a: string, b: string) => before(pred, a, b) || before(pred, b, a);
        const blocks = foata(word, related).map((b) => [...b].sort());
        expect(blocks).toEqual(rounds(nodes).map((r) => [...r].sort()));
      }),
      runs,
    );
  });
});

describe('width: how many steps can be in progress at once', () => {
  it('equals the largest antichain (Dilworth), and the widest round found is one', () => {
    fc.assert(
      fc.property(dagArb, (nodes) => {
        const pred = predecessors(nodes);
        const isAntichain = (xs: readonly string[]) => xs.every((a) => xs.every((b) => !before(pred, a, b)));
        const best = Math.max(...subsets(nodes.map((n) => n.id)).filter(isAntichain).map((s) => s.length));
        expect(width(nodes)).toBe(best);
        const found = widestRound(nodes);
        expect(found.length).toBe(best);
        expect(isAntichain(found)).toBe(true);
      }),
      runs,
    );
  });
});

describe('ready steps and progress', () => {
  it('done steps taken in any respectful order always form a down-set, and what is ready is an antichain', () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), fc.nat(), (nodes, seed, cut) => {
        const word = linearExtension(nodes, seed);
        const done = new Set(word.slice(0, cut % (word.length + 1)));
        for (const n of nodes) if (done.has(n.id)) for (const d of n.after) expect(done.has(d)).toBe(true);
        const r = ready(nodes, (id) => done.has(id));
        const pred = predecessors(nodes);
        for (const a of r) for (const b of r) expect(before(pred, a, b)).toBe(false);
        // Ready = the minimal elements of what is left.
        const left = remaining(nodes, (id) => done.has(id));
        expect(r.sort()).toEqual(left.filter((n) => n.after.length === 0).map((n) => n.id).sort());
        // Something is always ready until everything is done.
        if (done.size < nodes.length) expect(r.length).toBeGreaterThan(0);
      }),
      runs,
    );
  });

  it('the rounds left never exceed the rounds of the whole plan', () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), fc.nat(), (nodes, seed, cut) => {
        const word = linearExtension(nodes, seed);
        const done = new Set(word.slice(0, cut % (word.length + 1)));
        expect(height(remaining(nodes, (id) => done.has(id)))).toBeLessThanOrEqual(height(nodes));
      }),
      runs,
    );
  });
});

describe('changing a plan', () => {
  it('knows when a new wait would make a circle', () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), fc.nat(), (nodes, i, j) => {
        const a = nodes[i % nodes.length]!;
        const b = nodes[j % nodes.length]!;
        const changed = nodes.map((n) => (n.id === a.id ? { ...n, after: [...n.after, b.id] } : n));
        expect(wouldCycle(nodes, a.id, [...a.after, b.id])).toBe(findCycle(changed) !== null);
      }),
      runs,
    );
  });

  it('taking a step out keeps the order among the rest exactly as it was', () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), (nodes, pick) => {
        const gone = nodes[pick % nodes.length]!.id;
        const rewired = withoutStep(nodes, gone);
        const rest = nodes.filter((n) => n.id !== gone).map((n) => ({ id: n.id, after: rewired.get(n.id) ?? n.after }));
        const was = predecessors(nodes);
        const now = predecessors(rest);
        for (const a of rest) for (const b of rest) expect(before(now, a.id, b.id)).toBe(before(was, a.id, b.id));
      }),
      runs,
    );
  });

  it('a wait costs rounds only when it lengthens the longest chain', () => {
    const plan = [
      { id: 'a', after: [] },
      { id: 'b', after: ['a'] },
      { id: 'c', after: [] },
    ];
    expect(shapeOf(plan)).toEqual({ steps: 3, rounds: 2, startNow: 2, width: 2 });
    expect(waitCost(plan, 'c', 'a')).toBe(0); // fits beside b
    expect(waitCost(plan, 'c', 'b')).toBe(1); // a → b → c
  });
});
