/**
 * Policy: the one place that decides what an action turns into.
 *
 * Every task action is routed by comparing what it needs with what the person
 * has, as lattice elements:
 *
 *   needs ⊆ perms at the "do" level       → published directly
 *   needs ⊆ perms at the "suggest" level  → added to the shared suggestion
 *   otherwise                             → refused, naming what is missing
 *
 * Undo is not a special power. Undoing a version is just its inverse change
 * set, routed by the same rule. The one exception: people may always take back
 * their own task changes, as long as nobody has touched those tasks since.
 */
import type { ChangeSet } from './changeset';
import { actionOf } from './changes';
import { atomFor, covers, fromAtoms, has, missing, type Action, type Atom, type Level, type Perms } from './permissions';

export const POLICY = {
  /** An approver may not accept a suggestion made up only of their own batches. */
  fourEyes: true,
  /** People may undo their own task changes without the inverse permission. */
  ownUndo: true,
} as const;

export type RouteKind = 'do' | 'suggest' | 'deny';

export type Route =
  | { readonly kind: 'do' }
  | { readonly kind: 'suggest' }
  | { readonly kind: 'deny'; readonly missing: readonly Atom[] };

/** The join of the atoms each change needs, at the given level. */
export function requirement(cs: ChangeSet, level: Level): Perms {
  const atoms: Atom[] = cs.map((c) => {
    const a = actionOf(c);
    return a === 'manage' ? 'manage' : atomFor(level, a);
  });
  return fromAtoms(atoms);
}

export function route(perms: Perms, cs: ChangeSet): Route {
  const needDo = requirement(cs, 'do');
  if (covers(perms, needDo)) return { kind: 'do' };
  // People changes cannot be suggested; they need "manage" outright.
  if (cs.some((c) => actionOf(c) === 'manage')) return { kind: 'deny', missing: missing(perms, needDo) };
  const needSuggest = requirement(cs, 'suggest');
  if (covers(perms, needSuggest)) return { kind: 'suggest' };
  return { kind: 'deny', missing: missing(perms, needSuggest) };
}

/** What a single kind of action would do for this person. Used to label buttons honestly. */
export function routeAction(perms: Perms, action: Action): RouteKind {
  if (has(perms, atomFor('do', action))) return 'do';
  if (has(perms, atomFor('suggest', action))) return 'suggest';
  return 'deny';
}
