/**
 * Plans as partial orders.
 *
 * A plan is a set of steps with "waits for" links. As long as the links never
 * go round in a circle, they generate a strict partial order: a < b when b
 * waits for a, directly or through other steps. Everything the interface says
 * about a plan comes from a few classical facts about finite partial orders:
 *
 *   levels   level(s) = 0 if s waits for nothing, otherwise 1 + the highest
 *            level of what it waits for. Steps on the same level never wait
 *            for each other (each level is an antichain), so they can all be
 *            done at the same time. The levels are the plan's *rounds*.
 *   height   the number of rounds equals the length of the longest chain of
 *            waits (Mirsky's theorem). No schedule, with any number of people,
 *            finishes in fewer rounds: it is the shortest path through the plan.
 *   width    the most steps that can be in progress at the same time equals the
 *            fewest chains that cover the plan (Dilworth's theorem). Computed
 *            as n minus a maximum matching (König).
 *   ready    the undone steps whose waits are all done: the minimal elements
 *            of what is left. Always an antichain.
 *
 * In the language of traces: steps that are not ordered are independent and
 * commute. Every order of doing the steps that respects the waits is the same
 * trace, and the rounds are its Foata normal form (`foata`, used in tests).
 *
 * All functions are generic over the id type and ignore links to ids that are
 * not among the nodes, so they work on drafts and on partial views too.
 */

export interface Node<K> {
  readonly id: K;
  readonly after: readonly K[];
}

/** The links to known nodes only, keyed by id. */
function linksOf<K>(nodes: readonly Node<K>[]): Map<K, K[]> {
  const known = new Set(nodes.map((n) => n.id));
  return new Map(nodes.map((n) => [n.id, n.after.filter((a) => known.has(a) && a !== n.id)]));
}

/** A circle of waits, if there is one (ids in order), otherwise null. Self-links count as circles. */
export function findCycle<K>(nodes: readonly Node<K>[]): K[] | null {
  const known = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.after.includes(n.id)) return [n.id];
  const links = new Map(nodes.map((n) => [n.id, n.after.filter((a) => known.has(a))]));
  const state = new Map<K, 'open' | 'done'>();
  const path: K[] = [];
  const visit = (id: K): K[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'open') return path.slice(path.indexOf(id));
    state.set(id, 'open');
    path.push(id);
    for (const d of links.get(id) ?? []) {
      const found = visit(d);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const n of nodes) {
    const found = visit(n.id);
    if (found) return found;
  }
  return null;
}

export class CycleError extends Error {
  constructor() {
    super('the waits go round in a circle');
    this.name = 'CycleError';
  }
}

/** level(s): 0 for steps that wait for nothing, else 1 + the highest level they wait for. Throws on a circle. */
export function levels<K>(nodes: readonly Node<K>[]): Map<K, number> {
  const links = linksOf(nodes);
  const level = new Map<K, number>();
  const open = new Set<K>();
  const visit = (id: K): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) throw new CycleError();
    open.add(id);
    let l = 0;
    for (const d of links.get(id) ?? []) l = Math.max(l, visit(d) + 1);
    open.delete(id);
    level.set(id, l);
    return l;
  };
  for (const n of nodes) visit(n.id);
  return level;
}

/** The rounds: steps grouped by level, in their given order within each round. */
export function rounds<K>(nodes: readonly Node<K>[]): K[][] {
  const level = levels(nodes);
  const out: K[][] = [];
  for (const n of nodes) {
    const l = level.get(n.id) ?? 0;
    while (out.length <= l) out.push([]);
    out[l]!.push(n.id);
  }
  return out;
}

/** The number of rounds: the length of the longest chain of waits. */
export function height<K>(nodes: readonly Node<K>[]): number {
  let h = 0;
  for (const l of levels(nodes).values()) h = Math.max(h, l + 1);
  return h;
}

/** Everything each step waits for, directly or through other steps (the transitive closure). */
export function predecessors<K>(nodes: readonly Node<K>[]): Map<K, Set<K>> {
  const links = linksOf(nodes);
  const level = levels(nodes);
  const order = [...nodes].sort((a, b) => (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0));
  const pred = new Map<K, Set<K>>();
  for (const n of order) {
    const set = new Set<K>();
    for (const d of links.get(n.id) ?? []) {
      set.add(d);
      for (const x of pred.get(d) ?? []) set.add(x);
    }
    pred.set(n.id, set);
  }
  return pred;
}

/** a < b: b waits for a, directly or indirectly. */
export function before<K>(pred: ReadonlyMap<K, ReadonlySet<K>>, a: K, b: K): boolean {
  return pred.get(b)?.has(a) ?? false;
}

/** Would letting `id` wait for `after` make a circle? */
export function wouldCycle<K>(nodes: readonly Node<K>[], id: K, after: readonly K[]): boolean {
  if (after.includes(id)) return true;
  const pred = predecessors(nodes.map((n) => (n.id === id ? { id: n.id, after: [] } : n)));
  return after.some((d) => before(pred, id, d));
}

/**
 * A maximum matching in the comparability graph, split in two (left copy u,
 * right copy v, an edge when u < v). Kuhn's augmenting paths: plenty for plans.
 */
function matching<K>(ids: readonly K[], pred: ReadonlyMap<K, ReadonlySet<K>>): Map<K, K> {
  const rightOf = new Map<K, K>(); // right vertex v → its matched left vertex u
  const succ = new Map<K, K[]>(ids.map((u) => [u, ids.filter((v) => before(pred, u, v))]));
  const augment = (u: K, seen: Set<K>): boolean => {
    for (const v of succ.get(u) ?? []) {
      if (seen.has(v)) continue;
      seen.add(v);
      const w = rightOf.get(v);
      if (w === undefined || augment(w, seen)) {
        rightOf.set(v, u);
        return true;
      }
    }
    return false;
  };
  for (const u of ids) augment(u, new Set());
  return rightOf;
}

/** The most steps that can be in progress at the same time (the width). */
export function width<K>(nodes: readonly Node<K>[]): number {
  if (nodes.length === 0) return 0;
  const ids = nodes.map((n) => n.id);
  return ids.length - matching(ids, predecessors(nodes)).size;
}

/**
 * A largest set of steps that can be in progress together (a maximum antichain),
 * read off a minimum vertex cover of the matching graph (König's theorem).
 */
export function widestRound<K>(nodes: readonly Node<K>[]): K[] {
  const ids = nodes.map((n) => n.id);
  const pred = predecessors(nodes);
  const rightOf = matching(ids, pred);
  const leftOf = new Map<K, K>([...rightOf].map(([v, u]) => [u, v]));
  // Alternating search from unmatched left vertices: left → right on any edge, right → left on matched edges.
  const zLeft = new Set<K>(ids.filter((u) => !leftOf.has(u)));
  const zRight = new Set<K>();
  const queue = [...zLeft];
  while (queue.length > 0) {
    const u = queue.shift() as K;
    for (const v of ids) {
      if (!before(pred, u, v) || zRight.has(v)) continue;
      zRight.add(v);
      const w = rightOf.get(v);
      if (w !== undefined && !zLeft.has(w)) {
        zLeft.add(w);
        queue.push(w);
      }
    }
  }
  return ids.filter((x) => zLeft.has(x) && !zRight.has(x));
}

/** One longest chain of waits, first step first (the critical path). */
export function longestChain<K>(nodes: readonly Node<K>[]): K[] {
  if (nodes.length === 0) return [];
  const links = linksOf(nodes);
  const level = levels(nodes);
  let cur = nodes.reduce((best, n) => ((level.get(n.id) ?? 0) > (level.get(best.id) ?? 0) ? n : best)).id;
  const chain: K[] = [cur];
  while ((level.get(cur) ?? 0) > 0) {
    const l = level.get(cur) ?? 0;
    const prev = (links.get(cur) ?? []).find((d) => level.get(d) === l - 1);
    if (prev === undefined) break;
    chain.push(prev);
    cur = prev;
  }
  return chain.reverse();
}

/** The undone steps whose waits are all done. */
export function ready<K>(nodes: readonly Node<K>[], isDone: (id: K) => boolean): K[] {
  const links = linksOf(nodes);
  return nodes.filter((n) => !isDone(n.id) && (links.get(n.id) ?? []).every(isDone)).map((n) => n.id);
}

/** The plan that is left: undone steps, waiting only for undone steps. */
export function remaining<K>(nodes: readonly Node<K>[], isDone: (id: K) => boolean): Node<K>[] {
  return nodes.filter((n) => !isDone(n.id)).map((n) => ({ id: n.id, after: n.after.filter((a) => !isDone(a)) }));
}

/**
 * The Cartier–Foata normal form of a word: each letter goes into the block
 * right after the last block holding a letter it depends on. For a word that
 * does every step once in an order respecting the waits, with "depends" meaning
 * "ordered", the blocks are exactly the rounds.
 */
export function foata<K>(word: readonly K[], depends: (a: K, b: K) => boolean): K[][] {
  const blocks: K[][] = [];
  const blockOf = new Map<K, number>();
  word.forEach((x, i) => {
    let k = 0;
    for (let j = 0; j < i; j++) {
      const y = word[j] as K;
      if (depends(x, y)) k = Math.max(k, (blockOf.get(y) ?? 0) + 1);
    }
    blockOf.set(x, k);
    while (blocks.length <= k) blocks.push([]);
    blocks[k]!.push(x);
  });
  return blocks;
}

/**
 * Take one step out of a plan without letting anything start earlier than it
 * could before: whoever waited for the removed step now waits for what it
 * waited for. Only links that are not already implied are added, so the plan
 * stays minimal. The order among the remaining steps is exactly the old order
 * restricted to them (property-tested).
 */
export function withoutStep<K>(nodes: readonly Node<K>[], removed: K): Map<K, K[]> {
  const gone = nodes.find((n) => n.id === removed);
  const pred = predecessors(nodes);
  const out = new Map<K, K[]>();
  for (const n of nodes) {
    if (n.id === removed || !n.after.includes(removed)) continue;
    const kept = n.after.filter((a) => a !== removed);
    const candidates = [...kept, ...(gone?.after ?? [])];
    const inherited = (gone?.after ?? []).filter(
      (a, i, all) => all.indexOf(a) === i && !kept.includes(a) && !candidates.some((c) => c !== a && before(pred, a, c)),
    );
    out.set(n.id, [...kept, ...inherited]);
  }
  return out;
}
