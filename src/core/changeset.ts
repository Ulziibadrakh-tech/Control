/**
 * Change sets: ordered sequences of changes, applied all-or-nothing.
 *
 *   compose      concatenation; associative, with the empty set as identity
 *   invertSet    reverse the order and invert each change, so
 *                apply(apply(s, A), invertSet(A)) = s, and
 *                invertSet(compose(A, B)) = compose(invertSet(B), invertSet(A))
 *   normalize    the shortest equivalent change set (see below)
 */
import {
  applyChange,
  changeEquals,
  entityOf,
  fromCurrent,
  invert,
  isNoop,
  sameStepIdentity,
  stepDiff,
  stepHolds,
  stepWith,
  type Change,
  type Conflict,
  type EntityKey,
  type StepFieldChange,
} from './changes';
import type { State } from './model';
import { personEquals, sameIds, stepEquals, taskEquals } from './model';
import { err, ok, type Result } from './result';

export type ChangeSet = readonly Change[];

export const IDENTITY: ChangeSet = Object.freeze([]);

export function compose(...sets: readonly ChangeSet[]): ChangeSet {
  return sets.flat();
}

export function invertSet(cs: ChangeSet): ChangeSet {
  return cs.map(invert).reverse();
}

export interface SetConflict extends Conflict {
  /** Position in the change set of the change that did not fit. */
  readonly index: number;
}

export function applySet(s: State, cs: ChangeSet): Result<State, SetConflict> {
  let cur = s;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === undefined) continue;
    const r = applyChange(cur, c);
    if (!r.ok) return err({ ...r.error, index: i });
    cur = r.value;
  }
  return ok(cur);
}

export function entities(cs: ChangeSet): Set<EntityKey> {
  return new Set(cs.map(entityOf));
}

export type Rebased =
  | { readonly kind: 'ok'; readonly change: Change }
  | { readonly kind: 'satisfied' }
  | { readonly kind: 'conflict'; readonly conflict: Conflict };

/**
 * Adapt one change to a newer state without guessing what anyone meant.
 *
 *  - remove: removes the thing as it is now (its words or tick do not matter)
 *  - edit / check / assign / waits-for / perms: if the state already says what
 *    the change wants, the change is satisfied and dropped ("make it so" is
 *    idempotent); a tick is a "make it so" intent, so it also applies over a
 *    different starting value
 *  - anything else that no longer fits is a conflict, never an overwrite
 *
 * This is the only place a change is ever adapted. It is used when a
 * suggestion is evaluated later than it was made, and when undoing.
 */
export function rebaseChange(s: State, c: Change): Rebased {
  const conflict = (code: Conflict['code']): Rebased => ({
    kind: 'conflict',
    conflict: { code, entity: entityOf(c), change: c },
  });
  const okc = (change: Change): Rebased => ({ kind: 'ok', change });
  const satisfied: Rebased = { kind: 'satisfied' };
  switch (c.op) {
    case 'task.add':
      return s.tasks.has(c.task.id) ? conflict('exists') : okc(c);
    case 'task.remove': {
      const t = s.tasks.get(c.task.id);
      return t ? okc({ op: 'task.remove', task: t }) : satisfied;
    }
    case 'task.edit': {
      const t = s.tasks.get(c.id);
      if (!t) return conflict('missing');
      if (t.text === c.to) return satisfied;
      return t.text === c.from ? okc(c) : conflict('differs');
    }
    case 'task.check': {
      const t = s.tasks.get(c.id);
      if (!t) return conflict('missing');
      return t.done === c.to ? satisfied : okc({ op: 'task.check', id: c.id, from: t.done, to: c.to });
    }
    case 'step.add':
      return s.steps.has(c.step.id) ? conflict('exists') : okc(c);
    case 'step.remove': {
      const st = s.steps.get(c.step.id);
      return st ? okc({ op: 'step.remove', step: st }) : satisfied;
    }
    case 'step.edit':
    case 'step.check':
    case 'step.assign':
    case 'step.deps': {
      const st = s.steps.get(c.id);
      if (!st) return conflict('missing');
      if (stepHolds(st, c, 'to')) return satisfied;
      if (stepHolds(st, c, 'from')) return okc(c);
      return c.op === 'step.check' ? okc(fromCurrent(st, c)) : conflict('differs');
    }
    case 'person.add':
      return s.people.has(c.person.id) ? conflict('exists') : okc(c);
    case 'person.remove': {
      const p = s.people.get(c.person.id);
      return p ? okc({ op: 'person.remove', person: p }) : satisfied;
    }
    case 'person.perms': {
      const p = s.people.get(c.id);
      if (!p) return conflict('missing');
      if (p.perms === c.to) return satisfied;
      return p.perms === c.from ? okc(c) : conflict('differs');
    }
  }
}

/** Rebase a whole change set, all-or-nothing. Returns the adapted changes and the resulting state. */
export function rebaseSet(
  s: State,
  cs: ChangeSet,
): Result<{ readonly state: State; readonly changes: ChangeSet }, SetConflict> {
  let cur = s;
  const out: Change[] = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === undefined) continue;
    const r = rebaseChange(cur, c);
    if (r.kind === 'conflict') return err({ ...r.conflict, index: i });
    if (r.kind === 'satisfied') continue;
    const applied = applyChange(cur, r.change);
    if (!applied.ok) return err({ ...applied.error, index: i });
    cur = applied.value;
    out.push(r.change);
  }
  return ok({ state: cur, changes: out });
}

/**
 * Normal form.
 *
 * Changes to different entities commute (they touch disjoint parts of the
 * state), so a change set can be regrouped by entity without changing what it
 * does. Inside each group, adjacent changes are combined the way words are
 * reduced in a free group: a change followed by its inverse cancels, two edits
 * of the same field merge into one, an add followed by an edit becomes an add
 * of the edited task, and so on. Edits of the text and of the done flag touch
 * different fields, so they commute too and may merge past each other.
 *
 * For any change set that applies to a state, the normal form applies to it as
 * well and gives the same result (property-tested). normalize(A · A⁻¹) = ∅.
 */
export function normalize(cs: ChangeSet): ChangeSet {
  const groups = new Map<EntityKey, Change[]>();
  for (const c of cs) {
    const k = entityOf(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const out: Change[] = [];
  for (const g of groups.values()) out.push(...reduceGroup(g));
  return out;
}

/**
 * Reduce one entity's changes to a fixed point. Each step finds a later change
 * that can slide back (past changes it commutes with) to sit right after an
 * earlier one it merges with, and replaces the pair by their combination.
 * Every step shortens the list, so this terminates; groups are tiny in practice.
 */
function reduceGroup(group: readonly Change[]): Change[] {
  let list = group.filter((c) => !isNoop(c));
  let changed = true;
  while (changed) {
    changed = false;
    search: for (let j = 1; j < list.length; j++) {
      const later = list[j];
      if (later === undefined) continue;
      for (let i = j - 1; i >= 0; i--) {
        const earlier = list[i];
        if (earlier === undefined) break;
        const m = merge(earlier, later);
        if (m !== undefined) {
          const keep = m.filter((c) => !isNoop(c));
          list = [...list.slice(0, i), ...keep, ...list.slice(i + 1, j), ...list.slice(j + 1)];
          changed = true;
          break search;
        }
        if (!commutes(earlier, later)) break;
      }
    }
  }
  return list;
}

const STEP_FIELDS = new Set<Change['op']>(['step.edit', 'step.check', 'step.assign', 'step.deps']);
const isStepField = (c: Change): c is StepFieldChange => STEP_FIELDS.has(c.op);

/** (x → y) then (y → z) on the same field of the same step, as one change (x → z). */
function chain(a: StepFieldChange, b: Change): StepFieldChange | undefined {
  switch (a.op) {
    case 'step.edit':
      return b.op === 'step.edit' && b.from === a.to ? { ...a, to: b.to } : undefined;
    case 'step.check':
      return b.op === 'step.check' && b.from === a.to ? { ...a, to: b.to } : undefined;
    case 'step.assign':
      return b.op === 'step.assign' && b.from === a.to ? { ...a, to: b.to } : undefined;
    case 'step.deps':
      return b.op === 'step.deps' && sameIds(b.from, a.to) ? { ...a, to: b.to } : undefined;
  }
}

/** Two changes on the same task or step that touch different fields commute. */
function commutes(a: Change, b: Change): boolean {
  if ((a.op === 'task.edit' && b.op === 'task.check') || (a.op === 'task.check' && b.op === 'task.edit')) return true;
  return isStepField(a) && isStepField(b) && a.op !== b.op;
}

/**
 * Combine `a` followed by `b` (same entity).
 * Returns the replacement (empty when they cancel), or undefined if they do not combine.
 * Only combines when b's precondition matches a's result, so invalid sequences
 * are never made valid by accident. Every rule either shortens the sequence or
 * turns a remove-and-add pair into plain edits, so reduction terminates.
 */
function merge(a: Change, b: Change): Change[] | undefined {
  if (changeEquals(invert(a), b)) return [];
  switch (a.op) {
    case 'task.add':
      if (b.op === 'task.edit' && b.from === a.task.text) return [{ op: 'task.add', task: { ...a.task, text: b.to } }];
      if (b.op === 'task.check' && b.from === a.task.done) return [{ op: 'task.add', task: { ...a.task, done: b.to } }];
      return undefined;
    case 'task.edit':
      if (b.op === 'task.edit' && b.from === a.to) return [{ op: 'task.edit', id: a.id, from: a.from, to: b.to }];
      if (b.op === 'task.remove' && b.task.text === a.to) return [{ op: 'task.remove', task: { ...b.task, text: a.from } }];
      return undefined;
    case 'task.check':
      if (b.op === 'task.check' && b.from === a.to) return [{ op: 'task.check', id: a.id, from: a.from, to: b.to }];
      if (b.op === 'task.remove' && b.task.done === a.to) return [{ op: 'task.remove', task: { ...b.task, done: a.from } }];
      return undefined;
    case 'task.remove': {
      if (b.op !== 'task.add') return undefined;
      if (taskEquals(a.task, b.task)) return [];
      // The same task taken away and put back differently is really an edit (and/or a tick).
      // Keeping it as remove + add would let a later rebase overwrite someone else's words.
      if (a.task.createdAt !== b.task.createdAt || a.task.createdBy !== b.task.createdBy) return undefined;
      const out: Change[] = [];
      if (a.task.text !== b.task.text) out.push({ op: 'task.edit', id: a.task.id, from: a.task.text, to: b.task.text });
      if (a.task.done !== b.task.done) out.push({ op: 'task.check', id: a.task.id, from: a.task.done, to: b.task.done });
      return out;
    }
    case 'step.add':
      if (isStepField(b) && stepHolds(a.step, b, 'from')) return [{ op: 'step.add', step: stepWith(a.step, b, 'to') }];
      return undefined;
    case 'step.edit':
    case 'step.check':
    case 'step.assign':
    case 'step.deps': {
      // Two changes of the same field in a row become one: (x → y) · (y → z) = (x → z).
      const chained = chain(a, b);
      if (chained) return [chained];
      if (b.op === 'step.remove' && stepHolds(b.step, a, 'to')) return [{ op: 'step.remove', step: stepWith(b.step, a, 'from') }];
      return undefined;
    }
    case 'step.remove': {
      if (b.op !== 'step.add') return undefined;
      if (stepEquals(a.step, b.step)) return [];
      // The same step taken away and put back differently is really a set of field changes.
      if (!sameStepIdentity(a.step, b.step)) return undefined;
      return stepDiff(a.step, b.step);
    }
    case 'person.add':
      if (b.op === 'person.perms' && b.from === a.person.perms)
        return [{ op: 'person.add', person: { ...a.person, perms: b.to } }];
      return undefined;
    case 'person.perms':
      if (b.op === 'person.perms' && b.from === a.to) return [{ op: 'person.perms', id: a.id, from: a.from, to: b.to }];
      if (b.op === 'person.remove' && b.person.perms === a.to)
        return [{ op: 'person.remove', person: { ...b.person, perms: a.from } }];
      return undefined;
    case 'person.remove': {
      if (b.op !== 'person.add') return undefined;
      if (personEquals(a.person, b.person)) return [];
      if (a.person.name !== b.person.name || a.person.hue !== b.person.hue) return undefined;
      return [{ op: 'person.perms', id: a.person.id, from: a.person.perms, to: b.person.perms }];
    }
  }
}
