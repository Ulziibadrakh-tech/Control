/**
 * Turns the core's structured results (phrases, refusals, roles, outcomes)
 * into plain sentences in the person's language. The only place that knows
 * both the core's vocabulary and the interface's words.
 */
import {
  approvers,
  has,
  managers,
  roleOf,
  summarize,
  type Action,
  type Command,
  type Outcome,
  type PendingNote,
  type Perms,
  type Person,
  type PersonId,
  type Phrase,
  type Refusal,
  type RoleName,
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

  const person = (id: PersonId | null | undefined): Person | undefined => (id ? everyone(ws).get(id) : undefined);
  const name = (id: PersonId | null | undefined): string => person(id)?.name ?? '…';
  /** "You" for the current person, otherwise the name. For the subject of a sentence. */
  const who = (id: PersonId | null | undefined): string => (id && id === me ? t('you') : name(id));

  const role = (r: RoleName): string => t(`role.${r}` as const);
  const actions = (list: readonly Action[]): string => i18n.list(list.map((a) => t(`act.${a}` as const)));

  /** Plain sentences describing what someone may do. */
  const permsLines = (p: Perms): string[] => {
    const r = roleOf(p);
    if (r !== 'custom') return [t(`roleDesc.${r}` as const)];
    const s = summarize(p);
    const lines: string[] = [];
    if (s.can.length > 0) lines.push(t('sum.can', { actions: actions(s.can) }));
    if (s.suggest.length > 0) lines.push(t('sum.suggest', { actions: actions(s.suggest) }));
    if (s.approve) lines.push(t('sum.approve'));
    if (s.manage) lines.push(t('sum.manage'));
    if (lines.length === 0) lines.push(t('sum.nothing'));
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
        return t('ph.added', { who: w, text: p.text });
      case 'removed':
        return t('ph.removed', { who: w, text: p.text });
      case 'edited':
        return t('ph.edited', { who: w, from: p.from, to: p.to });
      case 'ticked':
        return t('ph.ticked', { who: w, text: p.text });
      case 'unticked':
        return t('ph.unticked', { who: w, text: p.text });
      case 'joined':
        return t('ph.joined', { who: w, name: p.name, role: role(p.role) });
      case 'left':
        return t('ph.left', { who: w, name: p.name });
      case 'role':
        return t('ph.role', { who: w, name: p.name, from: role(p.from), to: role(p.to) });
    }
  };

  /** The same, without a subject: for lists under a heading. */
  const itemText = (p: Phrase): string => {
    switch (p.kind) {
      case 'added':
        return t('item.added', { text: p.text });
      case 'removed':
        return t('item.removed', { text: p.text });
      case 'edited':
        return t('item.edited', { from: p.from, to: p.to });
      case 'ticked':
        return t('item.ticked', { text: p.text });
      case 'unticked':
        return t('item.unticked', { text: p.text });
      case 'joined':
        return t('item.joined', { name: p.name, role: role(p.role) });
      case 'left':
        return t('item.left', { name: p.name });
      case 'role':
        return t('item.role', { name: p.name, from: role(p.from), to: role(p.to) });
    }
  };

  const refusal = (r: Refusal): string => {
    switch (r.code) {
      case 'too-long':
        return t('refuse.too-long', { max: r.max });
      case 'duplicate':
        return t('refuse.duplicate', { text: r.text });
      case 'name-taken':
        return t('refuse.name-taken', { name: r.name });
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

  const noteText = (n: PendingNote): string => {
    const c = n.change;
    if (n.mine) {
      if (c.op === 'task.remove') return t('list.mineRemove');
      if (c.op === 'task.edit') return t('list.mineEdit', { to: c.to });
      if (c.op === 'task.check') return t(c.to ? 'list.mineDone' : 'list.mineNotDone');
      return t('list.waiting');
    }
    const w = name(n.by);
    if (c.op === 'task.remove') return t('list.noteRemove', { who: w });
    if (c.op === 'task.edit') return t('list.noteEdit', { who: w, to: c.to });
    if (c.op === 'task.check') return t(c.to ? 'list.noteDone' : 'list.noteNotDone', { who: w });
    return t('list.suggestedBy', { name: w });
  };

  const isApprover = (id: PersonId | null): boolean => {
    const p = id ? ws.replay.state.people.get(id) : undefined;
    return p ? has(p.perms, 'approve') : false;
  };

  return {
    i18n,
    t,
    person,
    name,
    who,
    role,
    actions,
    permsLines,
    approverNames,
    managerNames,
    phraseSentence,
    itemText,
    refusal,
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
      const textOf = (id: string) => before.replay.state.tasks.get(id as never)?.text ?? '';
      switch (cmd.type) {
        case 'add': {
          const c = v.changes[0];
          return { tone: 'info', message: t('toast.added', { text: c?.op === 'task.add' ? c.task.text : '' }), action: undo };
        }
        case 'check':
          return {
            tone: 'info',
            message: t(cmd.done ? 'toast.done' : 'toast.notDone', { text: textOf(cmd.id) }),
            action: undo,
          };
        case 'edit': {
          const c = v.changes[0];
          return { tone: 'info', message: t('toast.edited', { text: c?.op === 'task.edit' ? c.to : '' }), action: undo };
        }
        case 'remove':
          return { tone: 'info', message: t('toast.removed', { text: textOf(cmd.id) }), action: undo };
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
            ? { tone: 'info', message: t('toast.role', { name: w.name(c.id), role: w.role(roleOf(c.to)) }), action: undo }
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
