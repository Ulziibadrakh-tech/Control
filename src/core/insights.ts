/**
 * Embedded analytics. Small, pure questions asked of the history, each one
 * answered where a decision is being made:
 *
 *   progress          the list header        "2 done today, 6 to go"
 *   week              What changed           done per day, vs last week
 *   story             a task                 who added it, how old, changes
 *   review            a suggestion           what accepting will do, and why
 *   promotionHint     People                 "her last 7 suggestions were all accepted"
 */
import { findOpenTask } from './model';
import { isTaskChange, taskIdOf } from './changes';
import type { TaskFacts } from './history';
import type { BatchId, PersonId, TaskId } from './ids';
import { ACTIONS, levelOf, type Action } from './permissions';
import { actionOf } from './changes';
import { addDays, daysBetween, startOfDay } from './time';
import { published, type Workspace } from './workspace';

export interface Progress {
  readonly done: number;
  readonly open: number;
}

export function progress(ws: Workspace, now: number): Progress {
  const today = startOfDay(now);
  let done = 0;
  let open = 0;
  for (const t of published(ws).tasks.values()) {
    if (!t.done) open++;
    else if ((ws.replay.facts.get(t.id)?.doneAt ?? -1) >= today) done++;
  }
  return { done, open };
}

export interface DayCount {
  readonly start: number;
  readonly count: number;
}

export interface Week {
  /** The last seven days, oldest first, ending today. */
  readonly days: readonly DayCount[];
  readonly total: number;
  /** The seven days before those. */
  readonly previous: number;
}

export function week(ws: Workspace, now: number): Week {
  const today = startOfDay(now);
  const starts = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const first = starts[0] ?? today;
  const prevStart = addDays(today, -13);
  const counts = new Map<number, number>();
  let previous = 0;
  for (const f of ws.replay.facts.values()) {
    if (!f.done || f.doneAt === null) continue;
    const d = startOfDay(f.doneAt);
    if (d > today) continue;
    if (d >= first) counts.set(d, (counts.get(d) ?? 0) + 1);
    else if (d >= prevStart) previous++;
  }
  const days = starts.map((start) => ({ start, count: counts.get(start) ?? 0 }));
  return { days, total: days.reduce((s, d) => s + d.count, 0), previous };
}

export type StoryKind = 'added' | 'restored' | 'edited' | 'ticked' | 'unticked' | 'removed';

export interface StoryEvent {
  readonly at: number;
  readonly by: PersonId;
  readonly kind: StoryKind;
  readonly version: number;
}

export interface Story {
  readonly facts: TaskFacts;
  readonly events: readonly StoryEvent[];
  readonly ageDays: number;
}

export function story(ws: Workspace, id: TaskId, now: number): Story | null {
  const facts = ws.replay.facts.get(id);
  if (!facts) return null;
  const events: StoryEvent[] = [];
  for (const n of facts.versions) {
    const v = ws.data.log[n - 1];
    if (!v) continue;
    for (const c of v.changes) {
      if (!isTaskChange(c) || taskIdOf(c) !== id) continue;
      const kind: StoryKind =
        c.op === 'task.add'
          ? events.length > 0
            ? 'restored'
            : 'added'
          : c.op === 'task.remove'
            ? 'removed'
            : c.op === 'task.edit'
              ? 'edited'
              : c.to
                ? 'ticked'
                : 'unticked';
      events.push({ at: v.at, by: v.by, kind, version: v.n });
    }
  }
  return { facts, events, ageDays: daysBetween(facts.createdAt, now) };
}

export type BatchNote =
  | { readonly kind: 'already' }
  | { readonly kind: 'duplicate'; readonly text: string }
  | { readonly kind: 'age'; readonly days: number };

export interface Review {
  readonly added: number;
  readonly removed: number;
  readonly edited: number;
  readonly checked: number;
  readonly openNow: number;
  readonly openAfter: number;
  readonly notes: ReadonlyMap<BatchId, readonly BatchNote[]>;
}

/** What accepting the open suggestion would do, and context for each part of it. */
export function review(ws: Workspace, now: number): Review | null {
  const ev = ws.evaluation;
  if (!ev) return null;
  const pub = published(ws);
  let added = 0;
  let removed = 0;
  let edited = 0;
  let checked = 0;
  const notes = new Map<BatchId, BatchNote[]>();
  for (const e of ev.valid) {
    const list: BatchNote[] = [];
    if (e.changes.length === 0) list.push({ kind: 'already' });
    for (const c of e.changes) {
      if (c.op === 'task.add') {
        added++;
        if (findOpenTask(pub, c.task.text)) list.push({ kind: 'duplicate', text: c.task.text });
      } else if (c.op === 'task.remove') {
        removed++;
        const days = daysBetween(c.task.createdAt, now);
        if (days >= 2) list.push({ kind: 'age', days });
      } else if (c.op === 'task.edit') edited++;
      else if (c.op === 'task.check') checked++;
    }
    notes.set(e.batch.id, list);
  }
  const countOpen = (tasks: Iterable<{ done: boolean }>) => [...tasks].filter((t) => !t.done).length;
  return {
    added,
    removed,
    edited,
    checked,
    openNow: countOpen(pub.tasks.values()),
    openAfter: countOpen(ev.preview.tasks.values()),
    notes,
  };
}

/** How many things a person did or suggested in the last `days` days. */
export function activity(ws: Workspace, person: PersonId, now: number, days = 7): number {
  const since = addDays(startOfDay(now), -(days - 1));
  let n = 0;
  for (const v of ws.data.log) if (v.by === person && v.at >= since && v.cause.type !== 'setup') n++;
  for (const s of ws.data.suggestions) for (const b of s.batches) if (b.by === person && b.at >= since) n++;
  return n;
}

/**
 * Consecutive most recent suggestions by a person that were accepted,
 * stopping at the first one that was declined.
 */
export function acceptedStreak(ws: Workspace, person: PersonId): { count: number; actions: Action[] } {
  const decided = ws.data.suggestions
    .flatMap((s) => s.batches)
    .filter((b) => b.by === person && (b.status === 'applied' || b.status === 'declined'))
    .sort((a, b) => (b.decidedAt ?? b.at) - (a.decidedAt ?? a.at));
  let count = 0;
  const actions = new Set<Action>();
  for (const b of decided) {
    if (b.status === 'declined') break;
    count++;
    for (const c of b.changes) {
      const a = actionOf(c);
      if (a !== 'manage') actions.add(a);
    }
  }
  return { count, actions: ACTIONS.filter((a) => actions.has(a)) };
}

export const PROMOTION_STREAK = 5;

/** Data-driven role advice: someone whose suggestions are always accepted could be trusted to act directly. */
export function promotionHint(ws: Workspace, person: PersonId): { count: number; actions: Action[] } | null {
  const p = ws.replay.state.people.get(person);
  if (!p) return null;
  const s = acceptedStreak(ws, person);
  if (s.count < PROMOTION_STREAK) return null;
  const lacking = s.actions.filter((a) => levelOf(p.perms, a) !== 'do');
  return lacking.length > 0 ? { count: s.count, actions: lacking } : null;
}
