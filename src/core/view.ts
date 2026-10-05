/**
 * The list as one person sees it: published tasks, plus everything waiting in
 * the open suggestion shown in place. Pure, so the interface stays thin.
 */
import { isTaskChange, taskIdOf, type TaskChange } from './changes';
import type { BatchId, PersonId, TaskId } from './ids';
import { startOfDay } from './time';
import { preview, published, type Workspace } from './workspace';

export interface PendingNote {
  readonly batch: BatchId;
  readonly by: PersonId;
  readonly change: TaskChange;
  readonly mine: boolean;
}

export interface Row {
  readonly id: TaskId;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: number;
  readonly doneAt: number | null;
  /** Set when the task does not exist yet: it is a suggested addition. */
  readonly pendingAdd: PendingNote | null;
  /** Suggested changes waiting on a task that does exist. */
  readonly notes: readonly PendingNote[];
}

export interface ListView {
  readonly open: readonly Row[];
  readonly doneToday: readonly Row[];
  /** Done before today: tidied away from the list, still in history. */
  readonly doneEarlier: number;
}

const newestFirst = (a: Row, b: Row) => b.createdAt - a.createdAt;

export function listView(ws: Workspace, me: PersonId, now: number): ListView {
  const pub = published(ws);
  const pre = preview(ws);
  const notes = new Map<TaskId, PendingNote[]>();
  const added = new Map<TaskId, PendingNote>();

  for (const e of ws.evaluation?.valid ?? []) {
    for (const c of e.changes) {
      if (!isTaskChange(c)) continue;
      const note: PendingNote = { batch: e.batch.id, by: e.batch.by, change: c, mine: e.batch.by === me };
      const id = taskIdOf(c);
      if (c.op === 'task.add' && !pub.tasks.has(id)) {
        added.set(id, note);
      } else if (!added.has(id)) {
        const list = notes.get(id);
        if (list) list.push(note);
        else notes.set(id, [note]);
      }
    }
  }

  const today = startOfDay(now);
  const open: Row[] = [];
  const doneToday: Row[] = [];
  let doneEarlier = 0;

  for (const t of pub.tasks.values()) {
    const doneAt = ws.replay.facts.get(t.id)?.doneAt ?? null;
    const row: Row = {
      id: t.id,
      text: t.text,
      done: t.done,
      createdAt: t.createdAt,
      doneAt,
      pendingAdd: null,
      notes: notes.get(t.id) ?? [],
    };
    if (!t.done) open.push(row);
    else if (doneAt !== null && doneAt >= today) doneToday.push(row);
    else doneEarlier++;
  }

  const suggestedRows: Row[] = [];
  for (const [id, note] of added) {
    const t = pre.tasks.get(id);
    if (!t) continue;
    suggestedRows.push({
      id,
      text: t.text,
      done: t.done,
      createdAt: t.createdAt,
      doneAt: null,
      pendingAdd: note,
      notes: [],
    });
  }

  suggestedRows.sort(newestFirst);
  open.sort(newestFirst);
  doneToday.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return { open: [...suggestedRows, ...open], doneToday, doneEarlier };
}
