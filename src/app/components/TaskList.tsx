import { Check, Hourglass, Sun, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import {
  acceptance,
  has,
  listView,
  nextSteps,
  progress,
  routeAction,
  waiting,
  type MyStep,
  type Row,
  type TaskId,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import { Avatar, ProgressBar, Ring } from './bits';

/** Only things added after the page opened get the gentle "just added" glow. */
const OPENED_AT = Date.now();

/** A double tap on a circle should tick once, not tick and untick. */
const lastToggle = new Map<string, number>();
const TAP_SETTLE_MS = 500;
export function settled(id: string): boolean {
  const t = performance.now();
  const last = lastToggle.get(id) ?? -Infinity;
  lastToggle.set(id, t);
  return t - last >= TAP_SETTLE_MS;
}

export function TaskList({
  onOpenTask,
  onOpenReview,
}: {
  readonly onOpenTask: (id: TaskId) => void;
  readonly onOpenReview: () => void;
}) {
  const ws = useWorkspace();
  const me = useMe();
  const now = useNow();
  const { t } = useI18n();
  const view = useMemo(() => (me ? listView(ws, me.id, now) : null), [ws, me, now]);
  if (!me || !view) return null;
  const p = progress(ws, now, me);
  const label = t('list.progress', { done: p.done, open: p.open });

  return (
    <section className="list" aria-labelledby="list-title">
      <div className="list__head">
        <h2 id="list-title" className="list__title" tabIndex={-1} data-page-title>
          {t('list.title')}
        </h2>
        {p.done + p.open > 0 ? (
          <>
            <p className="list__progress">{label}</p>
            <ProgressBar done={p.done} total={p.done + p.open} label={label} />
          </>
        ) : null}
      </div>

      <Banner onOpenReview={onOpenReview} />
      <NextSteps onOpenTask={onOpenTask} />

      {view.open.length === 0 ? (
        view.doneToday.length === 0 ? (
          <div className="calm">
            <span className="calm__icon">
              <Sun aria-hidden="true" size={28} strokeWidth={2.25} />
            </span>
            <p className="calm__title">{t('list.empty')}</p>
            <p className="calm__body">{t('list.emptyHint')}</p>
          </div>
        ) : (
          <div className="calm calm--done">
            <span className="calm__icon">
              <Sparkles aria-hidden="true" size={28} strokeWidth={2.25} />
            </span>
            <p className="calm__title">{t('list.allDone')}</p>
          </div>
        )
      ) : (
        <ul className="rows">
          {view.open.map((row) => (
            <TaskRow key={row.id} row={row} onOpenTask={onOpenTask} onOpenReview={onOpenReview} now={now} />
          ))}
        </ul>
      )}

      {view.doneToday.length > 0 ? (
        <>
          <h3 className="list__sub">{t('list.doneToday')}</h3>
          <ul className="rows rows--done">
            {view.doneToday.map((row) => (
              <TaskRow key={row.id} row={row} onOpenTask={onOpenTask} onOpenReview={onOpenReview} now={now} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** "Your next steps": what this person can do right now, across all plans. */
function NextSteps({ onOpenTask }: { readonly onOpenTask: (id: TaskId) => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const { t } = useI18n();
  const next = useMemo(() => (me ? nextSteps(ws, me.id) : null), [ws, me]);
  if (!me || !next || (next.now.length === 0 && next.later.length === 0)) return null;
  return (
    <section className="next" aria-labelledby="next-title">
      <h3 id="next-title" className="next__title">
        {t('next.title')}
      </h3>
      {next.now.length > 0 ? (
        <ul className="rows">
          {next.now.map((s) => (
            <NextStep key={s.step.id} item={s} onOpenTask={onOpenTask} />
          ))}
        </ul>
      ) : null}
      {next.later.length > 0 ? <p className="next__later">{t('next.waiting', { n: next.later.length })}</p> : null}
    </section>
  );
}

function NextStep({ item, onOpenTask }: { readonly item: MyStep; readonly onOpenTask: (id: TaskId) => void }) {
  const me = useMe();
  const run = useRun();
  const { t } = useI18n();
  if (!me) return null;
  const canTick = routeAction(me.perms, 'check', 'own') !== 'deny';
  return (
    <li className="row row--step">
      {canTick ? (
        <button
          type="button"
          role="checkbox"
          className="tick"
          aria-checked={false}
          aria-label={item.step.text}
          onClick={() => {
            if (settled(item.step.id)) run({ type: 'checkStep', id: item.step.id, done: true });
          }}
        >
          <Check aria-hidden="true" size={24} strokeWidth={3.25} />
        </button>
      ) : (
        <span className="tick tick--still" aria-hidden="true" />
      )}
      <button type="button" className="row__main" aria-haspopup="dialog" onClick={() => onOpenTask(item.task.id)}>
        <span className="row__text">{item.step.text}</span>
        <span className="row__part">{t('next.part', { task: item.task.text })}</span>
      </button>
    </li>
  );
}

function TaskRow({
  row,
  onOpenTask,
  onOpenReview,
  now,
}: {
  readonly row: Row;
  readonly onOpenTask: (id: TaskId) => void;
  readonly onOpenReview: () => void;
  readonly now: number;
}) {
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t, list } = useI18n();
  if (!me) return null;

  const scope = row.createdBy === me.id ? 'own' : 'all';
  const checkRoute = routeAction(me.perms, 'check', scope);
  const pending = row.pendingAdd;
  const mine = pending?.mine ? pending : row.notes.find((n) => n.mine);
  const fresh = row.createdAt > OPENED_AT && now - row.createdAt < 60_000;

  // A plan: its progress and what can happen now (the list view already limits it to what this person may see).
  const plan = row.plan;
  let planLine: string | null = null;
  let ring: { done: number; total: number } | null = null;
  if (plan) {
    ring = { done: plan.done, total: plan.total };
    // The same step for several people is said once: "Do the homework (Anu, Khulan and Nomin)".
    const ready = new Map<string, string[]>();
    for (const s of plan.steps) if (s.ready) ready.set(s.step.text, [...(ready.get(s.step.text) ?? []), w.nameOrLeft(s.step.who)]);
    const parts: string[] = [];
    if (plan.left > 0 && !row.done) parts.push(t('row.left', { n: plan.left }));
    if (ready.size > 0 && !row.done) parts.push(t('row.now', { list: list([...ready].map(([text, names]) => `${text} (${list(names)})`)) }));
    planLine = parts.join(' · ') || null;
  }

  return (
    <li
      className={`row${fresh ? ' row--fresh' : ''}`}
      data-done={row.done || undefined}
      data-pending={pending ? true : undefined}
      data-plan={plan ? true : undefined}
    >
      {pending ? (
        <span className="tick tick--wait" aria-hidden="true">
          <Hourglass size={22} strokeWidth={2.5} />
        </span>
      ) : ring ? (
        <Ring done={ring.done} total={ring.total} label={t('row.steps', ring)} />
      ) : checkRoute === 'deny' ? (
        <span className="tick tick--still" data-on={row.done || undefined} aria-hidden="true">
          <Check size={24} strokeWidth={3.25} />
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          className="tick"
          aria-checked={row.done}
          aria-label={row.text}
          onClick={() => {
            if (settled(row.id)) run({ type: 'check', id: row.id, done: !row.done });
          }}
        >
          <Check aria-hidden="true" size={24} strokeWidth={3.25} />
        </button>
      )}

      <button
        type="button"
        className="row__main"
        aria-haspopup="dialog"
        onClick={() => (pending ? onOpenReview() : onOpenTask(row.id))}
      >
        <span className="row__text">{row.text}</span>
        {planLine ? <span className="row__plan">{planLine}</span> : null}
        {pending ? (
          <span className="row__note">{pending.mine ? t('list.waiting') : t('list.suggestedBy', { name: w.name(pending.by) })}</span>
        ) : null}
        {row.notes.map((n, i) => (
          <span key={`${n.batch}-${i}`} className="row__note">
            {w.noteText(n)}
          </span>
        ))}
      </button>

      {mine ? (
        <button type="button" className="btn btn--small btn--quiet row__takeback" onClick={() => run({ type: 'withdraw', batch: mine.batch })}>
          {t('list.takeBack')}
        </button>
      ) : null}
    </li>
  );
}

function Banner({ onOpenReview }: { readonly onOpenReview: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const w = useWords();
  const { t, people } = useI18n();
  const batches = waiting(ws);
  if (!me || batches.length === 0) return null;
  const who = [...new Set(batches.map((b) => b.by))];
  // Only ask for an OK this person could actually give (not for their own suggestions).
  const verdict = has(me.perms, 'approve') ? acceptance(ws, me) : null;
  const approver = verdict !== null && (verdict.ok || verdict.refusal.code !== 'own-only');
  // People who do not see everything only hear about their own suggestions.
  const ownOnly = !approver && !has(me.perms, 'see');
  if (ownOnly && !batches.some((b) => b.by === me.id)) return null;
  const count = ownOnly ? batches.filter((b) => b.by === me.id).length : batches.length;
  const faces = ownOnly ? [me.id] : who;

  return (
    <div className="banner">
      <div className="banner__faces">
        {faces.slice(0, 3).map((id) => (
          <Avatar key={id} person={w.person(id)} size="md" />
        ))}
      </div>
      <div className="banner__text">
        {approver ? (
          <>
            <p className="banner__title">
              {t('banner.approver', { names: people(who.map(w.who)), people: who.length, n: batches.length })}
            </p>
            <p>{t('banner.needsYou')}</p>
          </>
        ) : (
          <p className="banner__title">{t('banner.waiting', { n: count, names: w.approverNames() })}</p>
        )}
      </div>
      <button type="button" className="btn btn--wait" onClick={onOpenReview} aria-haspopup="dialog">
        {t('banner.look')}
      </button>
    </div>
  );
}
