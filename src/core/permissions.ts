/**
 * Permissions as a lattice.
 *
 * An *atom* is one capability, e.g. "suggest:add" (may propose adding a task)
 * or "do:add" (may add a task directly). Atoms are ordered by implication:
 * "do:X" implies "suggest:X" — whoever may do something may also propose it.
 *
 * A permission state is a set of atoms that is *closed* under implication
 * (a down-set of the implication order). Closed sets form a bounded
 * distributive lattice:
 *
 *   join (∨)  = union          — combining roles, or a team's joint ability
 *   meet (∧)  = intersection   — what two roles have in common
 *   NONE      = ∅              — identity of join: grants nothing ("can look")
 *   ALL       = every atom     — top
 *   revoke    = remove atoms and everything that implies them; stays closed
 *
 * Join is associative, commutative and idempotent, with NONE as identity, so
 * (Perms, ∨, NONE) is a commutative idempotent monoid. It is deliberately NOT a
 * group: idempotence (a ∨ a = a) rules out inverses. Taking a permission away
 * is `revoke`, a separate operation, not an inverse element. See docs/ALGEBRA.md.
 *
 * Representation: a bitmask (one bit per atom). The algebra is then just
 * bitwise OR / AND, which makes the laws easy to see and cheap to compute.
 * Storage uses readable atom names, never bit positions.
 */

export const ACTIONS = ['add', 'check', 'edit', 'remove'] as const;
export type Action = (typeof ACTIONS)[number];
export type Level = 'suggest' | 'do';
export type Flag = 'approve' | 'manage';
export type Atom = `${Level}:${Action}` | Flag;

/** Bit order. Changing it would only change in-memory masks, never stored data. */
export const ATOMS: readonly Atom[] = [
  'suggest:add',
  'suggest:check',
  'suggest:edit',
  'suggest:remove',
  'do:add',
  'do:check',
  'do:edit',
  'do:remove',
  'approve',
  'manage',
];

declare const permsBrand: unique symbol;
/** A closed set of atoms. Only produced by functions in this module. */
export type Perms = number & { readonly [permsBrand]: true };

const bitOf = new Map<Atom, number>(ATOMS.map((a, i) => [a, 1 << i]));
const bit = (a: Atom): number => bitOf.get(a) ?? 0;

const SUGGEST_MASK = 0b1111; // suggest:add..suggest:remove
const DO_SHIFT = 4; // do:X sits 4 bits above suggest:X
const DO_MASK = SUGGEST_MASK << DO_SHIFT;
const EVERY = (1 << ATOMS.length) - 1;

/** Downward closure: add suggest:X for every do:X. */
function close(bits: number): Perms {
  const b = bits & EVERY;
  return (b | ((b & DO_MASK) >> DO_SHIFT)) as Perms;
}

/** Upward closure: add do:X for every suggest:X. Used so revocation stays closed. */
function up(bits: number): number {
  return bits | ((bits & SUGGEST_MASK) << DO_SHIFT);
}

export const NONE = 0 as Perms;
export const ALL = close(EVERY);

export function fromAtoms(atoms: Iterable<Atom>): Perms {
  let b = 0;
  for (const a of atoms) b |= bit(a);
  return close(b);
}

export function toAtoms(p: Perms): Atom[] {
  return ATOMS.filter((a) => (p & bit(a)) !== 0);
}

export function isAtom(x: unknown): x is Atom {
  return typeof x === 'string' && bitOf.has(x as Atom);
}

export const join = (a: Perms, b: Perms): Perms => (a | b) as Perms;
export const meet = (a: Perms, b: Perms): Perms => (a & b) as Perms;

export function joinAll(ps: Iterable<Perms>): Perms {
  let acc = NONE;
  for (const p of ps) acc = join(acc, p);
  return acc;
}

/** Remove `r` and everything that implies it. revoke(p, suggest:add) also removes do:add. */
export function revoke(p: Perms, r: Perms | Iterable<Atom>): Perms {
  const rb = typeof r === 'number' ? r : fromAtomsRaw(r);
  return (p & ~up(rb)) as Perms;
}

function fromAtomsRaw(atoms: Iterable<Atom>): number {
  let b = 0;
  for (const a of atoms) b |= bit(a);
  return b;
}

export const has = (p: Perms, a: Atom): boolean => (p & bit(a)) !== 0;
/** need ⊆ p */
export const covers = (p: Perms, need: Perms): boolean => (p & need) === need;
/** a ≤ b in the lattice */
export const leq = (a: Perms, b: Perms): boolean => covers(b, a);
/** Atoms in `need` that `p` lacks. */
export const missing = (p: Perms, need: Perms): Atom[] => toAtoms((need & ~p) as Perms);

export const atomFor = (level: Level, action: Action): Atom => `${level}:${action}`;
export const single = (a: Atom): Perms => close(bit(a));

/* ---------- Per-action view: the "No / Suggest / Yes" control ---------- */

export type LevelChoice = 'none' | 'suggest' | 'do';

export function levelOf(p: Perms, action: Action): LevelChoice {
  if (has(p, atomFor('do', action))) return 'do';
  if (has(p, atomFor('suggest', action))) return 'suggest';
  return 'none';
}

export function withLevel(p: Perms, action: Action, level: LevelChoice): Perms {
  const cleared = revoke(p, [atomFor('suggest', action)]);
  if (level === 'none') return cleared;
  return join(cleared, single(atomFor(level, action)));
}

export function withFlag(p: Perms, flag: Flag, on: boolean): Perms {
  return on ? join(p, single(flag)) : revoke(p, [flag]);
}

/* ---------- Named roles: a simple ladder over the lattice ---------- */

export type PresetId = 'viewer' | 'helper' | 'editor' | 'approver' | 'owner';
export type RoleName = PresetId | 'custom';

const allAt = (level: Level): Perms => fromAtoms(ACTIONS.map((a) => atomFor(level, a)));

/**
 * The ladder is a chain in the lattice: each step is the previous one joined
 * with more atoms, so viewer < helper < editor < approver < owner.
 */
export const PRESETS: ReadonlyArray<{ readonly id: PresetId; readonly perms: Perms }> = [
  { id: 'viewer', perms: NONE },
  { id: 'helper', perms: allAt('suggest') },
  { id: 'editor', perms: allAt('do') },
  { id: 'approver', perms: join(allAt('do'), single('approve')) },
  { id: 'owner', perms: ALL },
];

export function presetPerms(id: PresetId): Perms {
  return PRESETS.find((p) => p.id === id)?.perms ?? NONE;
}

export function roleOf(p: Perms): RoleName {
  return PRESETS.find((x) => x.perms === p)?.id ?? 'custom';
}

/** Structured summary for plain-language rendering. */
export interface PermsSummary {
  /** Actions this person may do directly. */
  readonly can: readonly Action[];
  /** Actions this person may only propose. */
  readonly suggest: readonly Action[];
  readonly approve: boolean;
  readonly manage: boolean;
}

export function summarize(p: Perms): PermsSummary {
  return {
    can: ACTIONS.filter((a) => levelOf(p, a) === 'do'),
    suggest: ACTIONS.filter((a) => levelOf(p, a) === 'suggest'),
    approve: has(p, 'approve'),
    manage: has(p, 'manage'),
  };
}

/* ---------- Teams: "what can these people accomplish together?" ---------- */

/** A team's joint ability is the join of its members. */
export const teamPerms = joinAll;

/**
 * The smallest groups whose joint permissions cover `need`.
 * Exhaustive over subsets, smallest size first — fine for household-sized teams.
 */
export function smallestTeams<T>(
  people: readonly T[],
  permsOf: (t: T) => Perms,
  need: Perms,
  maxSize = 4,
): T[][] {
  const n = people.length;
  for (let size = 1; size <= Math.min(maxSize, n); size++) {
    const found: T[][] = [];
    const pick = (start: number, chosen: T[]): void => {
      if (chosen.length === size) {
        if (covers(teamPerms(chosen.map(permsOf)), need)) found.push([...chosen]);
        return;
      }
      for (let i = start; i < n; i++) {
        const person = people[i];
        if (person === undefined) continue;
        chosen.push(person);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
    if (found.length > 0) return found;
  }
  return [];
}
