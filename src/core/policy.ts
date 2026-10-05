/**
 * Policy: the one place that decides what an action turns into.
 *
 * Every action is routed by comparing what it needs with what the person
 * has, as lattice elements:
 *
 *   needs ⊆ perms at the "do" level       → published directly
 *   needs ⊆ perms at the "suggest" level  → added to the shared suggestion
 *   otherwise                             → refused, naming what is missing
 *
 * What a change needs depends on whose thing it touches. A change to your own
 * task or plan, or a tick on a step given to you, needs the "own" atom; a
 * change to anyone else's needs the "all" atom. Ownership is read from the
 * state as the change set walks forward, so a new plan's steps count as your
 * own even though the task appears in the same change set.
 *
 * Undo is not a special power. Undoing a version is just its inverse change
 * set, routed by the same rule. The one exception: people may take back their
 * own task changes, as long as nobody has touched those things since.
 */
import type { ChangeSet } from './changeset';
import { actionOf, applyChange, type Change } from './changes';
import type { PersonId, TaskId } from './ids';
import type { State } from './model';
import { atomFor, covers, fromAtoms, has, missing, type Action, type Atom, type Level, type Perms, type Scope } from './permissions';

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

/** Whose thing a change touches, from this person's point of view, in this state. */
export function scopeOf(c: Change, s: State, actor: PersonId): Scope {
  const ownsTask = (id: TaskId | undefined) => id !== undefined && s.tasks.get(id)?.createdBy === actor;
  switch (c.op) {
    case 'task.add':
    case 'task.remove':
      return c.task.createdBy === actor ? 'own' : 'all';
    case 'task.edit':
    case 'task.check':
      return ownsTask(c.id) ? 'own' : 'all';
    case 'step.add':
    case 'step.remove':
      return ownsTask(c.step.task) ? 'own' : 'all';
    case 'step.check': {
      const st = s.steps.get(c.id);
      return st && (st.who === actor || ownsTask(st.task)) ? 'own' : 'all';
    }
    case 'step.edit':
    case 'step.assign':
    case 'step.deps':
      return ownsTask(s.steps.get(c.id)?.task) ? 'own' : 'all';
    default:
      return 'all';
  }
}

/**
 * The join of the atoms a change set needs, at the given level. Walks the
 * state forward so later changes see earlier ones (a new task's steps are
 * its owner's own).
 */
export function requirement(cs: ChangeSet, level: Level, s: State, actor: PersonId): Perms {
  const atoms: Atom[] = [];
  let cur = s;
  for (const c of cs) {
    const a = actionOf(c);
    atoms.push(a === 'manage' ? 'manage' : atomFor(level, a, scopeOf(c, cur, actor)));
    const next = applyChange(cur, c);
    if (next.ok) cur = next.value;
  }
  return fromAtoms(atoms);
}

export function route(perms: Perms, cs: ChangeSet, s: State, actor: PersonId): Route {
  const needDo = requirement(cs, 'do', s, actor);
  if (covers(perms, needDo)) return { kind: 'do' };
  // People changes cannot be suggested; they need "manage" outright.
  if (cs.some((c) => actionOf(c) === 'manage')) return { kind: 'deny', missing: missing(perms, needDo) };
  const needSuggest = requirement(cs, 'suggest', s, actor);
  if (covers(perms, needSuggest)) return { kind: 'suggest' };
  return { kind: 'deny', missing: missing(perms, needSuggest) };
}

/** What a single kind of action would do for this person. Used to label buttons honestly. */
export function routeAction(perms: Perms, action: Action, scope: Scope = 'all'): RouteKind {
  if (has(perms, atomFor('do', action, scope))) return 'do';
  if (has(perms, atomFor('suggest', action, scope))) return 'suggest';
  return 'deny';
}
