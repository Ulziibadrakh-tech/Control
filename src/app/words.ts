/**
 * Turns the core's structured results (phrases, refusals, roles, outcomes)
 * into plain sentences in the person's language. The only place that knows
 * both the core's vocabulary and the interface's words.
 */
import {
  ACTIONS,
  approvers,
  has,
  managers,
  roleOf,
  summarize,
  type Action,
  type Change,
  type Command,
  type Outcome,
  type PendingNote,
  type Perms,
  type Person,
  type PersonId,
  type Phrase,
  type Refusal,
  type RoleName,
  type StepId,
  type Workspace,
} from '../core';
import type { I18n } from '../i18n/i18n';
import type { ToastSpec } from './context';

/** Everyone who was ever on the list, so history can still name people who left. */
const everyoneCache = new WeakMap<Workspace, Map<PersonId, Person>>();

function everyone(ws: Workspace): Map<PersonId, Person> {
  const cached = everyoneCache.get(ws);
  if (cached) return cached;
  const all = new Map<PersonId, Person>();
  for (const v of ws.data.log)
    for (const c of v.changes) if (c.op === 'person.add' || c.op === 'person.remove') all.set(c.person.id, c.person);
  for (const p of ws.replay.state.people.values()) all.set(p.id, p);
  everyoneCache.set(ws, all);
  return all;
}

export type Words = ReturnType<typeof makeWords>;

export function makeWords(i18n: I18n, ws: Workspace, me: PersonId | null) {
  const { t } = i18n;
  const standard = ws.data.standard;

  const person = (id: PersonId | null | undefined): Person | undefined => (id ? everyone(ws).get(id) : undefined);
  const name = (id: PersonId | null | undefined): string => person(id)?.name ?? '…';
  /** "You" for the current person, otherwise the name. For the subject of a sentence. */
  const who = (id: PersonId | null | undefined): string => (id && id === me ? t('you') : name(id));
  /** A name, marked when the person has left (their steps keep their name). */
  const nameOrLeft = (id: PersonId): string =>
    ws.replay.state.people.has(id) ? name(id) : t('plan.left', { name: name(id) });

  const role = (r: RoleName): string => t(`role.${r}` as const);
  const roleName = (p: Perms): string => role(roleOf(p, standard));
  const actions = (list: readonly Action[]): string => i18n.list(list.map((a) => t(`act.${a}` as const)));

  /** Plain sentences describing what someone may do. */
  const permsLines = (p: Perms): string[] => {
    const r = roleOf(p, standard);
    if (r !== 'custom') return [t(`roleDesc.${r}` as const)];
    const s = summarize(p);
    const can = ACTIONS.filter((a) => s.all[a] === 'do');
    const canOwn = ACTIONS.filter((a) => s.all[a] !== 'do' && s.own[a] === 'do');
    const suggest = ACTIONS.filter((a) => s.all[a] === 'suggest');
    const suggestOwn = ACTIONS.filter((a) => s.own[a] === 'suggest' && s.all[a] === 'none');
    const lines: string[] = [];
    if (can.length > 0) lines.push(t('sum.can', { actions: actions(can) }));
    if (canOwn.length > 0) lines.push(t('sum.canOwn', { actions: actions(canOwn) }));
    if (suggest.length > 0) lines.push(t('sum.suggest', { actions: actions(suggest) }));
    if (suggestOwn.length > 0) lines.push(t('sum.suggestOwn', { actions: actions(suggestOwn) }));
    if (s.approve) lines.push(t('sum.approve'));
    if (s.manage) lines.push(t('sum.manage'));
    if (!s.see && lines.length > 0) lines.push(t('sum.ownPart'));
    if (lines.length === 0) lines.push(s.see ? t('sum.nothing') : t('sum.ownPart'));
    return lines;
  };

  const othersNames = (people: readonly Person[]): string[] =>
    people.filter((p) => p.id !== me).map((p) => p.name);

  /** "Dulmaa or Anu": the people who can say OK, other than me. */
  const approverNames = (): string => i18n.either(othersNames(approvers(ws)));
  const managerNames = (): string => i18n.either(othersNames(managers(ws)));

  const phraseSentence = (p: Phrase, by: PersonId): string => {
    const w = who(by);
    switch (p.kind) {
      case 'added':
        return p.steps > 0 ? t('ph.addedPlan', { who: w, text: p.text, n: p.steps }) : t('ph.added', { who: w, text: p.text });
      case 'removed':
        return p.steps > 0 ? t('ph.removedPlan', { who: w, text: p.text, n: p.steps }) : t('ph.removed', { who: w, text: p.text });
      case 'edited':
        return t('ph.edited', { who: w, from: p.from, to: p.to });
      case 'ticked':
        return t('ph.ticked', { who: w, text: p.text });
      case 'unticked':
        return t('ph.unticked', { who: w, text: p.text });
      case 'step-added':
        return t('ph.stepAdded', { who: w, task: p.task, text: p.text });
      case 'step-removed':
        return t('ph.stepRemoved', { who: w, task: p.task, text: p.text });
      case 'step-edited':
        return t('ph.stepEdited', { who: w, from: p.from, to: p.to });
      case 'step-ticked':
        return t('ph.stepTicked', { who: w, text: p.text, task: p.task });
      case 'step-unticked':
        return t('ph.stepUnticked', { who: w, text: p.text });
      case 'step-assigned':
        return t('ph.stepAssigned', { who: w, text: p.text, name: name(p.to) });
      case 'step-waits':
        return t('ph.stepWaits', { who: w, text: p.text });
      case 'joined':
        return t('ph.joined', { who: w, name: p.name, role: roleName(p.perms) });
      case 'left':
        return t('ph.left', { who: w, name: p.name });
      case 'role':
        return t('ph.role', { who: w, name: p.name, from: roleName(p.from), to: roleName(p.to) });
    }
  };

  /** The same, without a subject: for lists under a heading. */
  const itemText = (p: Phrase): string => {
    switch (p.kind) {
      case 'added':
        return p.steps > 0 ? t('item.addedPlan', { text: p.text, n: p.steps }) : t('item.added', { text: p.text });
      case 'removed':
        return p.steps > 0 ? t('item.removedPlan', { text: p.text, n: p.steps }) : t('item.removed', { text: p.text });
      case 'edited':
        return t('item.edited', { from: p.from, to: p.to });
      case 'ticked':
        return t('item.ticked', { text: p.text });
      case 'unticked':
        return t('item.unticked', { text: p.text });
      case 'step-added':
        return t('item.stepAdded', { task: p.task, text: p.text });
      case 'step-removed':
        return t('item.stepRemoved', { task: p.task, text: p.text });
      case 'step-edited':
        return t('item.stepEdited', { from: p.from, to: p.to });
      case 'step-ticked':
        return t('item.stepTicked', { text: p.text });
      case 'step-unticked':
        return t('item.stepUnticked', { text: p.text });
      case 'step-assigned':
        return t('item.stepAssigned', { text: p.text, name: name(p.to) });
      case 'step-waits':
        return t('item.stepWaits', { text: p.text });
      case 'joined':
        return t('item.joined', { name: p.name, role: roleName(p.perms) });
      case 'left':
        return t('item.left', { name: p.name });
      case 'role':
        return t('item.role', { name: p.name, from: roleName(p.from), to: roleName(p.to) });
    }
  };

  const refusal = (r: Refusal): string => {
    switch (r.code) {
      case 'too-long':
        return t('refuse.too-long', { max: r.max });
      case 'too-many-steps':
        return t('refuse.too-many-steps', { max: r.max });
      case 'duplicate':
        return t('refuse.duplicate', { text: r.text });
      case 'name-taken':
        return t('refuse.name-taken', { name: r.name });
      case 'waits-for':
        return t('refuse.waits-for', { text: r.text, who: who(r.who) });
      case 'later-done':
        return t('refuse.later-done', { text: r.text });
      case 'order':
        return t('refuse.order', { text: r.text, waitsFor: r.waitsFor });
      case 'not-allowed': {
        const names = r.missing.includes('approve') ? approverNames() : managerNames();
        return t('refuse.not-allowed', { names: names || name(managers(ws)[0]?.id) });
      }
      case 'conflict':
        return t('refuse.conflict', { who: r.laterBy ? who(r.laterBy) : '' });
      default:
        return t(`refuse.${r.code}` as const);
    }
  };

  /** The words of a step, wherever it is (published, suggested, or removed since). */
  const stepText = (id: StepId): string =>
    ws.replay.state.steps.get(id)?.text ??
    ws.evaluation?.preview.steps.get(id)?.text ??
    ws.replay.stepFacts.get(id)?.text ??
    '…';

  const noteText = (n: PendingNote): string => {
    const c: Change = n.change;
    if (n.mine) {
      switch (c.op) {
        case 'task.remove':
          return t('list.mineRemove');
        case 'task.edit':
          return t('list.mineEdit', { to: c.to });
        case 'task.check':
          return t(c.to ? 'list.mineDone' : 'list.mineNotDone');
        case 'step.add':
          return t('list.mineStepAdd', { text: c.step.text });
        case 'step.remove':
          return t('list.mineStepRemove', { text: c.step.text });
        case 'step.check':
          return c.to ? t('list.mineStepDone', { text: stepText(c.id) }) : t('list.mineStepChange');
        case 'step.edit':
        case 'step.assign':
        case 'step.deps':
          return t('list.mineStepChange');
        default:
          return t('list.waiting');
      }
    }
    const w = name(n.by);
    switch (c.op) {
      case 'task.remove':
        return t('list.noteRemove', { who: w });
      case 'task.edit':
        return t('list.noteEdit', { who: w, to: c.to });
      case 'task.check':
        return t(c.to ? 'list.noteDone' : 'list.noteNotDone', { who: w });
      case 'step.add':
        return t('list.noteStepAdd', { who: w, text: c.step.text });
      case 'step.remove':
        return t('list.noteStepRemove', { who: w, text: c.step.text });
      case 'step.check':
        return c.to ? t('list.noteStepDone', { who: w, text: stepText(c.id) }) : t('list.noteStepChange', { who: w });
      case 'step.edit':
      case 'step.assign':
      case 'step.deps':
        return t('list.noteStepChange', { who: w });
      default:
        return t('list.suggestedBy', { name: w });
    }
  };

  const isApprover = (id: PersonId | null): boolean => {
    const p = id ? ws.replay.state.people.get(id) : undefined;
    return p ? has(p.perms, 'approve') : false;
  };

  return {
    i18n,
    t,
    standard,
    person,
    name,
    who,
    nameOrLeft,
    role,
    roleName,
    actions,
    permsLines,
    approverNames,
    managerNames,
    phraseSentence,
    itemText,
    refusal,
    stepText,
    noteText,
    isApprover,
  };
}

/** How many undos deep a version is: 0 for an ordinary change, 1 for an undo, 2 for a redo… */
function undoDepth(ws: Workspace, n: number): number {
  let depth = 0;
  let v = ws.data.log[n - 1];
  while (v && v.cause.type === 'undo' && depth < 1000) {
    depth++;
    v = ws.data.log[v.cause.of - 1];
  }
  return depth;
}

/** What to tell the person after a command, and what they can do about it. */
export function toastFor(
  o: Outcome,
  cmd: Command,
  before: Workspace,
  w: Words,
  run: (cmd: Command) => void,
): ToastSpec | null {
  const { t } = w;
  switch (o.kind) {
    case 'refused':
      return { tone: 'warn', message: w.refusal(o.refusal) };
    case 'suggested':
      return {
        tone: 'info',
        message: t('toast.suggested', { names: w.approverNames() }),
        action: { label: t('toast.takeBack'), kind: 'takeBack', run: () => run({ type: 'withdraw', batch: o.batch }) },
      };
    case 'updated': {
      const message =
        o.what === 'declined'
          ? t('toast.declined')
          : o.what === 'declined-batch'
            ? t('toast.leftOut')
            : o.what === 'withdrawn'
              ? t('toast.withdrawn')
              : t('toast.acceptedNothing');
      return { tone: 'info', message };
    }
    case 'published': {
      const v = o.version;
      const undo = { label: t('toast.undo'), kind: 'undo' as const, run: () => run({ type: 'undo', version: v.n }) };
      const before_ = before.replay.state;
      const textOf = (id: string) => before_.tasks.get(id as never)?.text ?? '';
      const stepTextOf = (id: string) => before_.steps.get(id as never)?.text ?? '';
      switch (cmd.type) {
        case 'add': {
          const c = v.changes[0];
          const text = c?.op === 'task.add' ? c.task.text : '';
          const steps = v.changes.filter((x) => x.op === 'step.add').length;
          return {
            tone: 'info',
            message: steps > 0 ? t('toast.planAdded', { text, n: steps }) : t('toast.added', { text }),
            action: undo,
          };
        }
        case 'check':
          return {
            tone: 'info',
            message: t(cmd.done ? 'toast.done' : 'toast.notDone', { text: textOf(cmd.id) }),
            action: undo,
          };
        case 'checkStep':
          return {
            tone: 'info',
            message: t(cmd.done ? 'toast.done' : 'toast.notDone', { text: stepTextOf(cmd.id) }),
            action: undo,
          };
        case 'edit': {
          const c = v.changes[0];
          return { tone: 'info', message: t('toast.edited', { text: c?.op === 'task.edit' ? c.to : '' }), action: undo };
        }
        case 'editStep': {
          const c = v.changes[0];
          return { tone: 'info', message: t('toast.edited', { text: c?.op === 'step.edit' ? c.to : '' }), action: undo };
        }
        case 'remove':
          return { tone: 'info', message: t('toast.removed', { text: textOf(cmd.id) }), action: undo };
        case 'addStep': {
          const c = v.changes[0];
          return { tone: 'info', message: t('toast.stepAdded', { text: c?.op === 'step.add' ? c.step.text : '' }), action: undo };
        }
        case 'removeStep':
          return { tone: 'info', message: t('toast.stepRemoved', { text: stepTextOf(cmd.id) }), action: undo };
        case 'assignStep':
          return { tone: 'info', message: t('toast.assigned', { text: stepTextOf(cmd.id), name: w.name(cmd.who) }), action: undo };
        case 'setWaits':
          return { tone: 'info', message: t('toast.waits', { text: stepTextOf(cmd.id) }), action: undo };
        case 'undo': {
          // Undoing an undo is a redo; undoing a redo is an undo again. Count the chain.
          const redo = undoDepth(before, cmd.version) % 2 === 1;
          return redo
            ? { tone: 'info', message: t('toast.redone'), action: undo }
            : {
                tone: 'info',
                message: t('toast.undone'),
                action: { label: t('toast.redo'), kind: 'redo', run: () => run({ type: 'undo', version: v.n }) },
              };
        }
        case 'restore': {
          const at = before.data.log[cmd.to - 1]?.at ?? v.at;
          return { tone: 'info', message: t('toast.restored', { when: w.i18n.when(at, v.at) }), action: undo };
        }
        case 'accept':
          return { tone: 'info', message: t('toast.accepted', { n: v.changes.length }), action: undo };
        case 'setPerms': {
          const c = v.changes[0];
          return c?.op === 'person.perms'
            ? { tone: 'info', message: t('toast.role', { name: w.name(c.id), role: w.roleName(c.to) }), action: undo }
            : null;
        }
        case 'addPerson': {
          const c = v.changes[0];
          return c?.op === 'person.add'
            ? { tone: 'info', message: t('toast.personAdded', { name: c.person.name }), action: undo }
            : null;
        }
        case 'removePerson': {
          const c = v.changes[0];
          return c?.op === 'person.remove'
            ? { tone: 'info', message: t('toast.personRemoved', { name: c.person.name }), action: undo }
            : null;
        }
        default:
          return { tone: 'info', message: t('toast.changes', { n: v.changes.length }), action: undo };
      }
    }
  }
}
