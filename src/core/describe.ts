/**
 * Plain-language descriptions of history, as structured data.
 *
 * The core never produces sentences: it produces Phrases, and the interface
 * turns them into words in the person's language. That keeps translation in
 * one place and keeps the core testable.
 */
import { applyChange, isTaskChange, taskIdOf, type Change } from './changes';
import type { ChangeSet } from './changeset';
import { EMPTY_REPLAY, step, type Version } from './history';
import type { PersonId, TaskId } from './ids';
import type { State } from './model';
import { roleOf, type RoleName } from './permissions';
import type { Suggestion } from './suggestions';
import { planUndo, type Refusal, type Workspace } from './workspace';

export type Phrase =
  | { readonly kind: 'added'; readonly text: string }
  | { readonly kind: 'removed'; readonly text: string }
  | { readonly kind: 'edited'; readonly from: string; readonly to: string }
  | { readonly kind: 'ticked'; readonly text: string }
  | { readonly kind: 'unticked'; readonly text: string }
  | { readonly kind: 'joined'; readonly name: string; readonly role: RoleName }
  | { readonly kind: 'left'; readonly name: string }
  | { readonly kind: 'role'; readonly name: string; readonly from: RoleName; readonly to: RoleName };

type TextLookup = (id: TaskId) => string | undefined;

export function phrase(c: Change, before: State, fallback?: TextLookup): Phrase {
  switch (c.op) {
    case 'task.add':
      return { kind: 'added', text: c.task.text };
    case 'task.remove':
      return { kind: 'removed', text: c.task.text };
    case 'task.edit':
      return { kind: 'edited', from: c.from, to: c.to };
    case 'task.check': {
      const text = before.tasks.get(c.id)?.text ?? fallback?.(c.id) ?? '…';
      return { kind: c.to ? 'ticked' : 'unticked', text };
    }
    case 'person.add':
      return { kind: 'joined', name: c.person.name, role: roleOf(c.person.perms) };
    case 'person.remove':
      return { kind: 'left', name: c.person.name };
    case 'person.perms':
      return {
        kind: 'role',
        name: before.people.get(c.id)?.name ?? '…',
        from: roleOf(c.from),
        to: roleOf(c.to),
      };
  }
}

/** Describe a change set, walking the state forward so later changes see earlier ones. */
export function phrases(cs: ChangeSet, before: State, fallback?: TextLookup): Phrase[] {
  let s = before;
  const out: Phrase[] = [];
  for (const c of cs) {
    out.push(phrase(c, s, fallback));
    const r = applyChange(s, c);
    if (r.ok) s = r.value;
  }
  return out;
}

export type UndoInfo = { readonly kind: 'do' | 'suggest' } | { readonly kind: 'no'; readonly refusal: Refusal };

export type TimelineItem =
  | {
      readonly type: 'version';
      readonly at: number;
      readonly version: Version;
      readonly phrases: readonly Phrase[];
      /** For an undo: what the undone version had done. */
      readonly undid: readonly Phrase[] | null;
      readonly undo: UndoInfo;
    }
  | {
      readonly type: 'declined';
      readonly at: number;
      readonly suggestion: Suggestion;
      readonly by: PersonId;
      readonly contributors: readonly PersonId[];
      readonly phrases: readonly Phrase[];
    };

/** Everything that happened, newest first, with what this person could undo. */
export function timeline(ws: Workspace, me: PersonId): TimelineItem[] {
  const actor = ws.replay.state.people.get(me);
  const fallback: TextLookup = (id) => ws.replay.facts.get(id)?.text;
  const byVersion = new Map<number, readonly Phrase[]>();
  const items: TimelineItem[] = [];

  let r = EMPTY_REPLAY;
  for (const v of ws.data.log) {
    const ps = phrases(v.changes, r.state, fallback);
    byVersion.set(v.n, ps);
    r = step(r, v);
    let undo: UndoInfo;
    if (!actor) undo = { kind: 'no', refusal: { code: 'not-a-member' } };
    else {
      const plan = planUndo(ws, actor, v.n);
      undo = plan.kind === 'refused' ? { kind: 'no', refusal: plan.refusal } : { kind: plan.kind };
    }
    const undid = v.cause.type === 'undo' ? (byVersion.get(v.cause.of) ?? null) : null;
    items.push({ type: 'version', at: v.at, version: v, phrases: ps, undid, undo });
  }

  for (const s of ws.data.suggestions) {
    const declined = s.batches.filter((b) => b.status === 'declined');
    const last = declined.reduce<(typeof declined)[number] | undefined>(
      (acc, b) => (acc === undefined || (b.decidedAt ?? 0) > (acc.decidedAt ?? 0) ? b : acc),
      undefined,
    );
    if (!last || last.decidedBy === null) continue;
    items.push({
      type: 'declined',
      at: last.decidedAt ?? last.at,
      suggestion: s,
      by: last.decidedBy,
      contributors: [...new Set(declined.map((b) => b.by))],
      phrases: declined.flatMap((b) => phrases(b.changes, ws.replay.state, fallback)),
    });
  }

  return items.sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at;
    const na = a.type === 'version' ? a.version.n : 0;
    const nb = b.type === 'version' ? b.version.n : 0;
    return nb - na;
  });
}

/** Task changes in a version, for showing details. */
export function taskChangesOf(v: Version): Change[] {
  return v.changes.filter(isTaskChange);
}

export { taskIdOf };
