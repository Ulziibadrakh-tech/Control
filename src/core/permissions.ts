/**
 * Permissions as a lattice.
 *
 * An *atom* is one capability. For each action (add, check, edit, remove)
 * there are four, along two independent axes:
 *
 *   level   suggest  <  do        (whoever may do something may also propose it)
 *   scope   own      <  all       (whoever may do it to anything may do it to their own)
 *
 *   suggest:X@own  ≤  do:X@own  ≤  do:X
 *   suggest:X@own  ≤  suggest:X ≤  do:X
 *
 * "Own" means a task you created, or a step in your plan or given to you.
 * All-scope atoms keep their original names ("do:add"), so data saved before
 * scopes existed still reads the same.
 *
 * Three more atoms: `see` (see every task, not only your own part), `approve`
 * (say OK to suggestions) and `manage` (decide who can do what). Acting on
 * anyone's things, or approving, implies seeing them: see ≤ suggest:X and
 * see ≤ approve.
 *
 * A permission state is a set of atoms closed downwards under this order (a
 * down-set). The down-sets of a finite order form a bounded distributive
 * lattice (Birkhoff):
 *
 *   join (∨)  = union          combining roles; a team's joint ability
 *   meet (∧)  = intersection   what two roles have in common
 *   NONE      = ∅              identity of join: grants nothing
 *   ALL       = every atom     top
 *   revoke    = remove atoms and everything above them; stays a down-set
 *
 * (Perms, ∨, NONE) is a commutative idempotent monoid, deliberately NOT a
 * group: idempotence (a ∨ a = a) rules out inverses. Taking a right away is
 * `revoke`, a separate operation. See docs/ALGEBRA.md.
 *
 * Representation: one bit per atom. Closure and revocation use precomputed
 * masks of each atom's down-set and up-set, so the algebra is bitwise OR/AND.
 * Storage uses readable atom names, never bit positions.
 */

export const ACTIONS = ['add', 'check', 'edit', 'remove'] as const;
export type Action = (typeof ACTIONS)[number];
export type Level = 'suggest' | 'do';
export type Scope = 'own' | 'all';
export type Flag = 'see' | 'approve' | 'manage';
export type Atom = `${Level}:${Action}` | `${Level}:${Action}@own` | Flag;

/** Bit order. Changing it would only change in-memory masks, never stored data. */
export const ATOMS: readonly Atom[] = [
  'suggest:add@own',
  'suggest:check@own',
  'suggest:edit@own',
  'suggest:remove@own',
  'do:add@own',
  'do:check@own',
  'do:edit@own',
  'do:remove@own',
  'suggest:add',
  'suggest:check',
  'suggest:edit',
  'suggest:remove',
  'do:add',
  'do:check',
  'do:edit',
  'do:remove',
  'see',
  'approve',
  'manage',
];

export const atomFor = (level: Level, action: Action, scope: Scope = 'all'): Atom =>
  scope === 'all' ? `${level}:${action}` : `${level}:${action}@own`;

/** The covering relation of the atom order: each atom and the atoms directly below it. */
function below(a: Atom): Atom[] {
  if (a === 'approve') return ['see'];
  if (a === 'see' || a === 'manage') return [];
  const [level, rest] = a.split(':') as [Level, string];
  const [action, own] = rest.split('@') as [Action, string | undefined];
  if (own) return level === 'do' ? [atomFor('suggest', action, 'own')] : [];
  return level === 'do'
    ? [atomFor('suggest', action, 'all'), atomFor('do', action, 'own')]
    : [atomFor('suggest', action, 'own'), 'see'];
}

declare const permsBrand: unique symbol;
/** A down-set of atoms. Only produced by functions in this module. */
export type Perms = number & { readonly [permsBrand]: true };

const index = new Map<Atom, number>(ATOMS.map((a, i) => [a, i]));
const bit = (a: Atom): number => {
  const i = index.get(a);
  return i === undefined ? 0 : 1 << i;
};
const EVERY = (1 << ATOMS.length) - 1;

/** DOWN[i]: the atom and everything it implies. UP[i]: the atom and everything that implies it. */
const DOWN: number[] = ATOMS.map(() => 0);
const UP: number[] = ATOMS.map(() => 0);
{
  const downOf = (a: Atom, seen = new Set<Atom>()): number => {
    if (seen.has(a)) return 0;
    seen.add(a);
    let m = bit(a);
    for (const b of below(a)) m |= downOf(b, seen);
    return m;
  };
  ATOMS.forEach((a, i) => {
    DOWN[i] = downOf(a);
  });
  ATOMS.forEach((_, i) => {
    for (let j = 0; j < ATOMS.length; j++) if ((DOWN[j]! >> i) & 1) UP[i]! |= 1 << j;
  });
}

function spread(bits: number, masks: readonly number[]): number {
  let out = 0;
  for (let i = 0; i < masks.length; i++) if ((bits >> i) & 1) out |= masks[i]!;
  return out;
}

/** Downward closure: add everything each atom implies. */
const close = (bits: number): Perms => spread(bits & EVERY, DOWN) as Perms;

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
  return typeof x === 'string' && index.has(x as Atom);
}

/** True when `bits` is closed downwards. Every Perms value is; exported for tests. */
export const isDownSet = (bits: number): boolean => close(bits) === bits;

export const join = (a: Perms, b: Perms): Perms => (a | b) as Perms;
export const meet = (a: Perms, b: Perms): Perms => (a & b) as Perms;

export function joinAll(ps: Iterable<Perms>): Perms {
  let acc = NONE;
  for (const p of ps) acc = join(acc, p);
  return acc;
}

/** Remove `r` and everything that implies it. revoke(p, suggest:add) also removes do:add. */
export function revoke(p: Perms, r: Perms | Iterable<Atom>): Perms {
  let rb = 0;
  if (typeof r === 'number') rb = r;
  else for (const a of r) rb |= bit(a);
  return (p & ~spread(rb, UP)) as Perms;
}

export const has = (p: Perms, a: Atom): boolean => (p & bit(a)) !== 0;
/** need ⊆ p */
export const covers = (p: Perms, need: Perms): boolean => (p & need) === need;
/** a ≤ b in the lattice */
export const leq = (a: Perms, b: Perms): boolean => covers(b, a);
/** Atoms in `need` that `p` lacks, without the ones implied by others (the ones worth naming). */
export function missing(p: Perms, need: Perms): Atom[] {
  const lacking = toAtoms((need & ~p) as Perms);
  const impliedByAnother = (a: Atom) => lacking.some((b) => b !== a && (DOWN[index.get(b) ?? 0]! & bit(a)) !== 0);
  return lacking.filter((a) => !impliedByAnother(a));
}

export const single = (a: Atom): Perms => close(bit(a));

/* ---------- Per-action view: the "No / Suggest / Yes" controls ---------- */

export type LevelChoice = 'none' | 'suggest' | 'do';
const RANK: Record<LevelChoice, number> = { none: 0, suggest: 1, do: 2 };
const higher = (a: LevelChoice, b: LevelChoice): LevelChoice => (RANK[a] >= RANK[b] ? a : b);
const lower = (a: LevelChoice, b: LevelChoice): LevelChoice => (RANK[a] <= RANK[b] ? a : b);

export function levelOf(p: Perms, action: Action, scope: Scope = 'all'): LevelChoice {
  if (has(p, atomFor('do', action, scope))) return 'do';
  if (has(p, atomFor('suggest', action, scope))) return 'suggest';
  return 'none';
}

/**
 * Set one action's level for one scope, keeping the set a down-set:
 * raising "anyone's" raises "own" with it, and lowering "own" lowers "anyone's".
 */
export function withLevel(p: Perms, action: Action, level: LevelChoice, scope: Scope = 'all'): Perms {
  const own = levelOf(p, action, 'own');
  const all = levelOf(p, action, 'all');
  const nextAll = scope === 'all' ? level : lower(all, level);
  const nextOwn = scope === 'all' ? higher(own, level) : level;
  let out = revoke(p, [atomFor('suggest', action, 'own')]);
  if (nextOwn !== 'none') out = join(out, single(atomFor(nextOwn, action, 'own')));
  if (nextAll !== 'none') out = join(out, single(atomFor(nextAll, action, 'all')));
  return out;
}

export function withFlag(p: Perms, flag: Flag, on: boolean): Perms {
  return on ? join(p, single(flag)) : revoke(p, [flag]);
}

/* ---------- Named roles: a ladder per standard ---------- */

export type StandardId = 'home' | 'school';
export const STANDARDS: readonly StandardId[] = ['school', 'home'];

export type PresetId =
  | 'viewer'
  | 'helper'
  | 'editor'
  | 'approver'
  | 'owner'
  | 'parent'
  | 'student'
  | 'teacher'
  | 'manager'
  | 'director';
export type RoleName = PresetId | 'custom';

const at = (level: Level, scope: Scope): Atom[] => ACTIONS.map((a) => atomFor(level, a, scope));

/**
 * Each ladder is a chain in the lattice: every rung is the previous one joined
 * with more atoms. Home: one household where everyone sees everything. School:
 * people below "teacher" only see and act on their own part.
 */
export const LADDERS: Readonly<Record<StandardId, ReadonlyArray<{ readonly id: PresetId; readonly perms: Perms }>>> = {
  home: [
    { id: 'viewer', perms: fromAtoms(['see']) },
    { id: 'helper', perms: fromAtoms(at('suggest', 'all')) },
    { id: 'editor', perms: fromAtoms(at('do', 'all')) },
    { id: 'approver', perms: fromAtoms([...at('do', 'all'), 'approve']) },
    { id: 'owner', perms: ALL },
  ],
  school: [
    { id: 'parent', perms: fromAtoms(['do:check@own']) },
    { id: 'student', perms: fromAtoms(['do:check@own', 'suggest:add@own']) },
    { id: 'teacher', perms: fromAtoms([...at('do', 'own'), ...at('suggest', 'all'), 'approve']) },
    { id: 'manager', perms: fromAtoms([...at('do', 'all'), 'approve']) },
    { id: 'director', perms: ALL },
  ],
};

export function presetPerms(id: PresetId): Perms {
  for (const ladder of Object.values(LADDERS)) {
    const found = ladder.find((p) => p.id === id);
    if (found) return found.perms;
  }
  return NONE;
}

export function roleOf(p: Perms, standard: StandardId): RoleName {
  return LADDERS[standard].find((x) => x.perms === p)?.id ?? 'custom';
}

/**
 * The highest rung of the ladder that `p` contains (its floor in the chain),
 * or null if it contains none. A teacher given one extra right is still a
 * teacher when a ready-made plan asks for "a teacher".
 */
export function rankOf(p: Perms, standard: StandardId): PresetId | null {
  let best: PresetId | null = null;
  for (const rung of LADDERS[standard]) if (leq(rung.perms, p)) best = rung.id;
  return best;
}

/** Structured summary for plain-language rendering: each action's level for own and anyone's things. */
export interface PermsSummary {
  readonly own: Readonly<Record<Action, LevelChoice>>;
  readonly all: Readonly<Record<Action, LevelChoice>>;
  readonly see: boolean;
  readonly approve: boolean;
  readonly manage: boolean;
}

export function summarize(p: Perms): PermsSummary {
  const by = (scope: Scope) =>
    Object.fromEntries(ACTIONS.map((a) => [a, levelOf(p, a, scope)])) as Record<Action, LevelChoice>;
  return { own: by('own'), all: by('all'), see: has(p, 'see'), approve: has(p, 'approve'), manage: has(p, 'manage') };
}

/* ---------- Teams: "what can these people accomplish together?" ---------- */

/** A team's joint ability is the join of its members. */
export const teamPerms = joinAll;

/**
 * The smallest groups whose joint permissions cover `need`.
 * Exhaustive over subsets, smallest size first — fine for team-sized groups.
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
