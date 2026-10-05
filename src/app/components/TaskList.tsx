import { Check, Hourglass, Sun, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { acceptance, has, listView, progress, routeAction, waiting, type Row, type TaskId } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import { Avatar, ProgressBar } from './bits';

/** Only things added after the page opened get the gentle "just added" glow. */
const OPENED_AT = Date.now();

/** A double tap on a circle should tick once, not tick and untick. */
const lastToggle = new Map<string, number>();
const TAP_SETTLE_MS = 500;
function settled(id: string): boolean {
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
  const p = progress(ws, now);
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
  const { t } = useI18n();
  if (!me) return null;

  const checkRoute = routeAction(me.perms, 'check');
  const pending = row.pendingAdd;
  const mine = pending?.mine ? pending : row.notes.find((n) => n.mine);
  const fresh = row.createdAt > OPENED_AT && now - row.createdAt < 60_000;

  return (
    <li className={`row${fresh ? ' row--fresh' : ''}`} data-done={row.done || undefined} data-pending={pending ? true : undefined}>
      {pending ? (
        <span className="tick tick--wait" aria-hidden="true">
          <Hourglass size={22} strokeWidth={2.5} />
        </span>
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

  return (
    <div className="banner">
      <div className="banner__faces">
        {who.slice(0, 3).map((id) => (
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
          <p className="banner__title">{t('banner.waiting', { n: batches.length, names: w.approverNames() })}</p>
        )}
      </div>
      <button type="button" className="btn btn--wait" onClick={onOpenReview} aria-haspopup="dialog">
        {t('banner.look')}
      </button>
    </div>
  );
}
