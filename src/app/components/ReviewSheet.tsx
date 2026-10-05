/**
 * Reviewing the open suggestion: what each person proposed, what accepting it
 * would do (embedded insight), and two clear answers.
 */
import { Check, Minus, Pencil, Plus, RotateCcw } from 'lucide-react';
import {
  acceptance,
  contributors,
  has,
  review,
  type BatchNote,
  type Change,
  type EvaluatedBatch,
  type StaleBatch,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import type { Words } from '../words';
import { Sheet } from './Sheet';

function OpIcon({ change }: { readonly change: Change }) {
  const props = { 'aria-hidden': true, size: 22, strokeWidth: 2.75 } as const;
  switch (change.op) {
    case 'task.add':
    case 'step.add':
      return <Plus {...props} />;
    case 'task.remove':
    case 'step.remove':
      return <Minus {...props} />;
    case 'task.check':
    case 'step.check':
      return change.to ? <Check {...props} /> : <RotateCcw {...props} />;
    default:
      return <Pencil {...props} />;
  }
}

/** One line per change; a new task's steps fold into the task's line ("Add, with 3 steps"). */
function describe(change: Change, w: Words, textOf: (id: string) => string, steps: number): { label: string; detail: string } {
  const { t } = w;
  switch (change.op) {
    case 'task.add':
      return { label: steps > 0 ? t('review.addPlan', { n: steps }) : t('review.add'), detail: `“${change.task.text}”` };
    case 'task.remove':
      return { label: t('review.remove'), detail: `“${change.task.text}”` };
    case 'task.edit':
      return { label: t('review.edit'), detail: `“${change.from}” → “${change.to}”` };
    case 'task.check':
      return { label: t(change.to ? 'review.done' : 'review.notDone'), detail: `“${textOf(change.id)}”` };
    case 'step.add':
      return { label: t('review.addStep'), detail: `“${change.step.text}” (${w.nameOrLeft(change.step.who)})` };
    case 'step.remove':
      return { label: t('review.removeStep'), detail: `“${change.step.text}”` };
    case 'step.edit':
      return { label: t('review.editStep'), detail: `“${change.from}” → “${change.to}”` };
    case 'step.check':
      return { label: t(change.to ? 'review.stepDone' : 'review.stepNotDone'), detail: `“${w.stepText(change.id)}”` };
    case 'step.assign':
      return { label: t('review.assign', { name: w.nameOrLeft(change.to) }), detail: `“${w.stepText(change.id)}”` };
    case 'step.deps':
      return { label: t('review.waits'), detail: `“${w.stepText(change.id)}”` };
    default:
      return { label: '', detail: '' };
  }
}

/** Fold a new task's own steps into it, and drop the waits rewired by a removed step. */
function lines(changes: readonly Change[]): Array<{ change: Change; steps: number }> {
  const added = new Set(changes.flatMap((c) => (c.op === 'task.add' ? [c.task.id] : [])));
  const removedTasks = new Set(changes.flatMap((c) => (c.op === 'task.remove' ? [c.task.id] : [])));
  const removedSteps = new Set(changes.flatMap((c) => (c.op === 'step.remove' ? [c.step.id] : [])));
  const out: Array<{ change: Change; steps: number }> = [];
  for (const c of changes) {
    if (c.op === 'step.add' && added.has(c.step.task)) continue;
    if (c.op === 'step.remove' && removedTasks.has(c.step.task)) continue;
    if (c.op === 'step.deps' && c.from.some((d) => removedSteps.has(d))) continue;
    const steps = c.op === 'task.add' ? changes.filter((x) => x.op === 'step.add' && x.step.task === c.task.id).length : 0;
    out.push({ change: c, steps });
  }
  return out;
}

function noteText(n: BatchNote, w: Words): string {
  if (n.kind === 'already') return w.t('review.already');
  if (n.kind === 'duplicate') return w.t('review.duplicate');
  return w.t('review.age', { days: n.days });
}

export function ReviewSheet({ onClose }: { readonly onClose: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const now = useNow();
  const w = useWords();
  const { t, ago, people } = useI18n();
  const ev = ws.evaluation;
  const open = ws.open;
  const insight = review(ws, now);

  if (!me || !open || !ev) {
    return (
      <Sheet title={t('review.title')} onClose={onClose}>
        <p className="note">{t('review.nothing')}</p>
      </Sheet>
    );
  }

  const canApprove = has(me.perms, 'approve');
  const verdict = acceptance(ws, me);
  const ownOnly = !verdict.ok && verdict.refusal.code === 'own-only';
  // People who do not see everything see only their own suggestions.
  const sees = has(me.perms, 'see');
  const valid = sees ? ev.valid : ev.valid.filter((e) => e.batch.by === me.id);
  const stale = sees ? ev.stale : ev.stale.filter((x) => x.batch.by === me.id);
  const names = people(contributors([...valid.map((e) => e.batch), ...stale.map((x) => x.batch)]).map(w.who));
  const textOf = (id: string) => ws.replay.facts.get(id as never)?.text ?? ev.preview.tasks.get(id as never)?.text ?? '…';

  const item = (entry: EvaluatedBatch | StaleBatch, stale: boolean) => {
    const b = entry.batch;
    const changes = stale ? b.changes : (entry as EvaluatedBatch).changes.length > 0 ? (entry as EvaluatedBatch).changes : b.changes;
    const notes = stale ? [] : (insight?.notes.get(b.id) ?? []);
    return (
      <li key={b.id} className="review__item" data-stale={stale || undefined}>
        <div className="review__changes">
          {lines(changes).map(({ change: c, steps }, i) => {
            const d = describe(c, w, textOf, steps);
            return (
              <p key={i} className="review__what">
                <span className="review__op" data-op={c.op}>
                  <OpIcon change={c} />
                </span>
                <span>
                  <span className="review__label">{d.label}: </span>
                  <strong>{d.detail}</strong>
                </span>
              </p>
            );
          })}
        </div>
        <p className="review__meta">{t('review.byWhen', { name: w.who(b.by), when: ago(b.at, now) })}</p>
        {b.origin.type !== 'action' ? (
          <p className="review__meta">{t(b.origin.type === 'undo' ? 'review.fromUndo' : 'review.fromRestore')}</p>
        ) : null}
        {stale ? <p className="review__note">{t('review.stale')}</p> : null}
        {notes.map((n, i) => (
          <p key={i} className="review__note">
            {noteText(n, w)}
          </p>
        ))}
        {canApprove ? (
          <button
            type="button"
            className="btn btn--small btn--quiet review__out"
            onClick={() => run({ type: 'declineBatch', suggestion: open.id, batch: b.id })}
          >
            {t('review.leaveOut')}
          </button>
        ) : b.by === me.id ? (
          <button type="button" className="btn btn--small btn--quiet review__out" onClick={() => run({ type: 'withdraw', batch: b.id })}>
            {t('review.takeBack')}
          </button>
        ) : null}
      </li>
    );
  };

  const footer = canApprove ? (
    ownOnly ? (
      <p className="note">{t('review.ownOnly')}</p>
    ) : (
      <>
        {ev.valid.length > 0 ? (
          <button
            type="button"
            className="btn btn--primary btn--big btn--block"
            onClick={() => {
              const o = run({ type: 'accept', suggestion: open.id });
              if (o.kind !== 'refused') onClose();
            }}
          >
            <Check aria-hidden="true" size={24} strokeWidth={3} />
            {t('review.accept', { n: ev.valid.length })}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet btn--block"
          onClick={() => {
            const o = run({ type: 'decline', suggestion: open.id });
            if (o.kind !== 'refused') onClose();
          }}
        >
          {t('review.decline')}
        </button>
      </>
    )
  ) : (
    <p className="note">{t('review.onlyApprovers', { names: w.approverNames() })}</p>
  );

  return (
    <Sheet title={t('review.title')} onClose={onClose} footer={footer}>
      <p className="sheet__lead">{t('review.from', { names })}</p>
      <ul className="review">
        {valid.map((e) => item(e, false))}
        {stale.map((x) => item(x, true))}
      </ul>
      {insight && sees && ev.valid.length > 0 ? <p className="review__after">{t('review.after', { open: insight.openAfter })}</p> : null}
    </Sheet>
  );
}
