/**
 * What changed: the version history in plain words, newest first, grouped by
 * day. Every entry can be undone (or the undo suggested) when the rules allow,
 * and any moment can be gone back to. The week chart on top is the embedded
 * analytics for this page.
 */
import { ArrowLeft, ChevronDown, ChevronUp, RotateCcw, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { planRestore, startOfDay, timeline, week, type TimelineItem, type Version } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import { hrefOf, onRouteClick } from '../route';
import type { Words } from '../words';
import { Avatar } from './bits';
import { Sheet } from './Sheet';

const PAGE = 40;

export function HistoryPage() {
  const ws = useWorkspace();
  const me = useMe();
  const now = useNow();
  const { t, day } = useI18n();
  const [shown, setShown] = useState(PAGE);
  const [restoreTo, setRestoreTo] = useState<Version | null>(null);
  const items = useMemo(() => (me ? timeline(ws, me.id) : []), [ws, me]);

  if (!me) return null;

  const visible = items.slice(0, shown);
  const groups: Array<{ day: number; items: TimelineItem[] }> = [];
  for (const item of visible) {
    const d = startOfDay(item.at);
    const last = groups[groups.length - 1];
    if (last && last.day === d) last.items.push(item);
    else groups.push({ day: d, items: [item] });
  }

  return (
    <div className="page">
      <a className="back" href={hrefOf('home')} onClick={onRouteClick('home')}>
        <ArrowLeft aria-hidden="true" size={22} strokeWidth={2.5} />
        {t('nav.back')}
      </a>
      <h2 className="page__title" tabIndex={-1} data-page-title>
        {t('history.title')}
      </h2>
      <p className="page__intro">{t('history.intro')}</p>

      <WeekCard />

      {groups.map((g) => (
        <section key={g.day} className="daygroup" aria-label={day(g.day, now)}>
          <h3 className="daygroup__title">{day(g.day, now)}</h3>
          <ol className="timeline">
            {g.items.map((item) => (
              <Entry
                key={item.type === 'version' ? `v${item.version.n}` : `d${item.suggestion.id}`}
                item={item}
                onRestore={setRestoreTo}
              />
            ))}
          </ol>
        </section>
      ))}

      {items.length > shown ? (
        <button type="button" className="btn btn--quiet btn--block more" onClick={() => setShown((n) => n + PAGE)}>
          {t('history.more')}
        </button>
      ) : null}

      {restoreTo ? <RestoreSheet version={restoreTo} onClose={() => setRestoreTo(null)} /> : null}
    </div>
  );
}

function WeekCard() {
  const ws = useWorkspace();
  const me = useMe();
  const now = useNow();
  const { t, weekdayShort } = useI18n();
  // Someone who sees only their own part counts only their own part.
  const wk = useMemo(() => (me ? week(ws, now, me) : null), [ws, now, me]);
  if (!wk) return null;
  const max = Math.max(1, ...wk.days.map((d) => d.count));
  const today = startOfDay(now);

  return (
    <section className="week" aria-labelledby="week-title">
      <div className="week__head">
        <h3 id="week-title" className="week__title">
          {t('history.week')}
        </h3>
        <p className="week__total">{t('history.weekDone', { n: wk.total })}</p>
        <p className="week__before">{t('history.weekBefore', { n: wk.previous })}</p>
      </div>
      <ol className="week__bars">
        {wk.days.map((d) => (
          <li
            key={d.start}
            className="week__col"
            data-today={d.start === today || undefined}
            aria-label={t('history.chartLabel', { day: weekdayShort(d.start), n: d.count })}
          >
            <span className="week__n" aria-hidden="true">
              {d.count > 0 ? d.count : ''}
            </span>
            <span className="week__track" aria-hidden="true">
              <span className="week__bar" style={{ height: `${(d.count / max) * 100}%` }} />
            </span>
            <span className="week__day" aria-hidden="true">
              {weekdayShort(d.start)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function summary(item: TimelineItem, w: Words): { main: string; sub: string[] } {
  const { t, i18n } = w;
  if (item.type === 'declined') {
    return {
      main: t('ph.declined', { who: w.who(item.by), names: i18n.people(item.contributors.map(w.who)) }),
      sub: item.phrases.map(w.itemText),
    };
  }
  const v = item.version;
  const one = item.phrases.length === 1 ? item.phrases[0] : undefined;
  switch (v.cause.type) {
    case 'setup':
      return { main: t('ph.setup', { who: w.who(v.by) }), sub: [] };
    case 'suggestion':
      return {
        main: t('ph.accepted', {
          who: w.who(v.by),
          n: item.phrases.length,
          names: i18n.people(v.cause.contributors.map(w.who)),
        }),
        sub: item.phrases.map(w.itemText),
      };
    case 'undo':
      return { main: t('ph.undid', { who: w.who(v.by) }), sub: (item.undid ?? item.phrases).map(w.itemText) };
    case 'restore':
      return { main: t('ph.restored', { who: w.who(v.by), when: '…' }), sub: item.phrases.map(w.itemText) };
    case 'direct':
      return one
        ? { main: w.phraseSentence(one, v.by), sub: [] }
        : { main: t('ph.many', { who: w.who(v.by), n: item.phrases.length }), sub: item.phrases.map(w.itemText) };
  }
}

function Entry({ item, onRestore }: { readonly item: TimelineItem; readonly onRestore: (v: Version) => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const now = useNow();
  const w = useWords();
  const { t, time, when } = useI18n();
  const [open, setOpen] = useState(false);
  if (!me) return null;

  const by = item.type === 'version' ? item.version.by : item.by;
  let { main, sub } = summary(item, w);
  if (item.type === 'version' && item.version.cause.type === 'restore') {
    const to = ws.data.log[item.version.cause.to - 1];
    main = t('ph.restored', { who: w.who(by), when: to ? when(to.at, now) : '' });
  }
  const showSubInline = sub.length > 0 && sub.length <= 2;
  const restorePlan = item.type === 'version' ? planRestore(ws, me, item.version.n) : null;
  const canRestore = restorePlan !== null && restorePlan.kind !== 'refused';
  const hasDetails = sub.length > 2 || canRestore || (item.type === 'version' && item.undo.kind === 'no' && item.version.cause.type !== 'setup');

  return (
    <li className="entry" data-declined={item.type === 'declined' || undefined}>
      <Avatar person={w.person(by)} size="md" />
      <div className="entry__body">
        <p className="entry__text">{main}</p>
        {showSubInline ? sub.map((s, i) => <p key={i} className="entry__sub">{s}</p>) : null}
        <div className="entry__meta">
          <span>{time(item.at)}</span>
          {item.type === 'declined' ? <span className="tag">{t('history.notAccepted')}</span> : null}
          {hasDetails ? (
            <button type="button" className="link entry__more" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
              {open ? (
                <ChevronUp aria-hidden="true" size={18} strokeWidth={2.75} />
              ) : (
                <ChevronDown aria-hidden="true" size={18} strokeWidth={2.75} />
              )}
              {t(open ? 'history.hide' : 'history.details')}
            </button>
          ) : null}
        </div>

        {open ? (
          <div className="entry__details">
            {!showSubInline && sub.length > 0 ? (
              <ul className="entry__list">
                {sub.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : null}
            {item.type === 'version' && item.undo.kind === 'no' && item.version.cause.type !== 'setup' ? (
              <p className="entry__why">
                {t('history.cantUndo')}: {w.refusal(item.undo.refusal)}
              </p>
            ) : null}
            {canRestore && item.type === 'version' ? (
              <button type="button" className="btn btn--small btn--quiet" onClick={() => onRestore(item.version)}>
                <RotateCcw aria-hidden="true" size={20} strokeWidth={2.5} />
                {t(restorePlan.kind === 'do' ? 'history.goBack' : 'history.goBackSuggest')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="entry__actions">
        {item.type === 'version' && item.undo.kind !== 'no' ? (
          <button
            type="button"
            className="btn btn--small btn--quiet"
            onClick={() => run({ type: 'undo', version: item.version.n })}
          >
            <Undo2 aria-hidden="true" size={20} strokeWidth={2.5} />
            {t(item.undo.kind === 'do' ? 'history.undo' : 'history.suggestUndo')}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function RestoreSheet({ version, onClose }: { readonly version: Version; readonly onClose: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const now = useNow();
  const { t, when } = useI18n();
  if (!me) return null;
  const plan = planRestore(ws, me, version.n);
  const suggest = plan.kind === 'suggest';

  return (
    <Sheet
      title={t('history.goBackTitle')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--primary btn--big btn--block"
            onClick={() => {
              const o = run({ type: 'restore', to: version.n });
              if (o.kind !== 'refused') onClose();
            }}
          >
            <RotateCcw aria-hidden="true" size={22} strokeWidth={2.5} />
            {t(suggest ? 'history.goBackSuggestDo' : 'history.goBackDo')}
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <p className="sheet__lead">{t('history.goBackBody', { when: when(version.at, now) })}</p>
    </Sheet>
  );
}
