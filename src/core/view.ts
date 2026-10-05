/**
 * The list as one person sees it: published tasks they may see, plus
 * everything waiting in the open suggestion shown in place, plus their own
 * next steps. Pure, so the interface stays thin.
 */
import { isPersonChange, isStepChange, isTaskChange, taskIdOf, type Change } from './changes';
import type { BatchId, PersonId, TaskId } from './ids';
import { isTaskDone, stepsOf, type State, type Step, type Task } from './model';
import { canSeeTask, changeVisibleTo, planFor, type ViewedPlan } from './plan';
import { startOfDay } from './time';
import { preview, published, type Workspace } from './workspace';

export interface PendingNote {
  readonly batch: BatchId;
  readonly by: PersonId;
  readonly change: Change;
  readonly mine: boolean;
}

export interface Row {
  readonly id: TaskId;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: number;
  readonly createdBy: PersonId;
  readonly doneAt: number | null;
  /** Set when the task does not exist yet: it is a suggested addition. */
  readonly pendingAdd: PendingNote | null;
  /** Suggested changes waiting on a task (or its steps) that does exist. */
  readonly notes: readonly PendingNote[];
  /** Its plan, when it is broken into steps: all of it, or only this person's part. */
  readonly plan: ViewedPlan | null;
}

export interface ListView {
  readonly open: readonly Row[];
  readonly doneToday: readonly Row[];
  /** Done before today: tidied away from the list, still in history. */
  readonly doneEarlier: number;
}

const newestFirst = (a: Row, b: Row) => b.createdAt - a.createdAt;

/** When a task was finished: its own tick, or the last of its steps. */
export function doneAtOf(ws: Workspace, s: State, t: Task): number | null {
  if (!isTaskDone(s, t)) return null;
  const steps = stepsOf(s, t.id);
  if (steps.length === 0) return ws.replay.facts.get(t.id)?.doneAt ?? null;
  let last: number | null = null;
  for (const st of steps) {
    const at = ws.replay.stepFacts.get(st.id)?.doneAt ?? null;
    if (at !== null && (last === null || at > last)) last = at;
  }
  return last;
}

/** Which task a pending change belongs to, looking steps up in the preview and the published state. */
function taskOfChange(c: Change, pre: State, pub: State): TaskId | null {
  if (isTaskChange(c)) return taskIdOf(c);
  if (isStepChange(c)) {
    if (c.op === 'step.add' || c.op === 'step.remove') return c.step.task;
    return (pre.steps.get(c.id) ?? pub.steps.get(c.id))?.task ?? null;
  }
  return null;
}

export function listView(ws: Workspace, me: PersonId, now: number): ListView {
  const pub = published(ws);
  const pre = preview(ws);
  const person = pub.people.get(me);
  // Someone no longer on the list sees nothing.
  if (!person) return { open: [], doneToday: [], doneEarlier: 0 };
  const sees = changeVisibleTo(pre, ws.replay.facts, ws.replay.stepFacts, person);
  const notes = new Map<TaskId, PendingNote[]>();
  const added = new Map<TaskId, PendingNote>();

  for (const e of ws.evaluation?.valid ?? []) {
    for (const c of e.changes) {
      if (isPersonChange(c)) continue;
      const note: PendingNote = { batch: e.batch.id, by: e.batch.by, change: c, mine: e.batch.by === me };
      // Suggestions about things this person may not see stay out of their list, unless they are theirs.
      if (!note.mine && !sees(c)) continue;
      const id = taskOfChange(c, pre, pub);
      if (id === null) continue;
      if (c.op === 'task.add' && !pub.tasks.has(id)) {
        added.set(id, note);
      } else if (!added.has(id) && !(isStepChange(c) && !pub.tasks.has(id))) {
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
    if (!canSeeTask(pub, person, t)) continue;
    const done = isTaskDone(pub, t);
    const doneAt = doneAtOf(ws, pub, t);
    const row: Row = {
      id: t.id,
      text: t.text,
      done,
      createdAt: t.createdAt,
      createdBy: t.createdBy,
      doneAt,
      pendingAdd: null,
      notes: notes.get(t.id) ?? [],
      plan: stepsOf(pub, t.id).length > 0 ? planFor(pub, person, t) : null,
    };
    if (!done) open.push(row);
    else if (doneAt !== null && doneAt >= today) doneToday.push(row);
    else doneEarlier++;
  }

  const suggestedRows: Row[] = [];
  for (const [id, note] of added) {
    const t = pre.tasks.get(id);
    if (!t || !(note.mine || canSeeTask(pre, person, t))) continue;
    suggestedRows.push({
      id,
      text: t.text,
      done: isTaskDone(pre, t),
      createdAt: t.createdAt,
      createdBy: t.createdBy,
      doneAt: null,
      pendingAdd: note,
      notes: [],
      plan: stepsOf(pre, t.id).length > 0 ? planFor(pre, person, t) : null,
    });
  }

  suggestedRows.sort(newestFirst);
  open.sort(newestFirst);
  doneToday.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return { open: [...suggestedRows, ...open], doneToday, doneEarlier };
}

/* ------------------------------------------------------------ next steps */

export interface MyStep {
  readonly step: Step;
  readonly task: Task;
  /** Undone steps it is still waiting for (empty when it can be done now). */
  readonly waitingFor: readonly Step[];
}

export interface NextSteps {
  /** Given to me, not done, and nothing to wait for: what I can do right now. */
  readonly now: readonly MyStep[];
  /** Given to me, not done, but waiting for someone else first. */
  readonly later: readonly MyStep[];
}

/** The steps given to this person in published plans, split into "now" and "after others". */
export function nextSteps(ws: Workspace, me: PersonId): NextSteps {
  const pub = published(ws);
  const now: MyStep[] = [];
  const later: MyStep[] = [];
  for (const st of pub.steps.values()) {
    if (st.who !== me || st.done) continue;
    const task = pub.tasks.get(st.task);
    if (!task) continue;
    const waitingFor = st.after.map((d) => pub.steps.get(d)).filter((d): d is Step => d !== undefined && !d.done);
    (waitingFor.length === 0 ? now : later).push({ step: st, task, waitingFor });
  }
  const order = (a: MyStep, b: MyStep) => a.task.createdAt - b.task.createdAt || a.step.n - b.step.n;
  return { now: now.sort(order), later: later.sort(order) };
}
