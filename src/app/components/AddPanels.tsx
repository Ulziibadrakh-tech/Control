/**
 * The two side options. Write: type it (and, at school, break it into steps).
 * Choose: tap a ready-made one (a task at home, a plan at school). Both send
 * the same "add" command, so permissions, suggestions, duplicates and undo
 * behave identically whichever way something is added.
 */
import { Check, Eye, ListTree, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { choices, planChoices, PLANS, routeAction, MAX_TEXT, type Choice, type PlanTemplate } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useStandard, useWords, useWorkspace } from '../context';
import { TileIcon } from './bits';
import { expandRows, newRow, PlanEditor, type DraftRow } from './PlanEditor';
import { PlanSheet } from './PlanSheet';

function ViewOnly() {
  const { t } = useI18n();
  const w = useWords();
  return (
    <div className="note-card">
      <Eye aria-hidden="true" size={26} strokeWidth={2.25} />
      <p>{t('write.denied')}</p>
      <p>{t('write.askOwner', { names: w.managerNames() })}</p>
    </div>
  );
}

export function WritePanel({
  draft,
  setDraft,
  rows,
  setRows,
  onAdded,
}: {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  /** The steps being written, or null when the task is not broken down. */
  readonly rows: readonly DraftRow[] | null;
  readonly setRows: (rows: DraftRow[] | null) => void;
  readonly onAdded?: () => void;
}) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const standard = useStandard();
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const route = routeAction(me.perms, 'add', 'own');
  if (route === 'deny') return <ViewOnly />;
  const steps = rows ? expandRows(ws, rows) : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const o = run({ type: 'add', text: draft, ...(steps.length > 0 ? { steps } : {}) }, { quietRefusals: true });
    if (o.kind === 'refused') {
      setError(w.refusal(o.refusal));
      input.current?.focus();
      return;
    }
    setDraft('');
    setRows(null);
    setError(null);
    if (onAdded) onAdded();
    else input.current?.focus();
  };

  const label =
    steps.length > 0
      ? t(route === 'do' ? 'write.doSteps' : 'write.suggestSteps', { n: steps.length })
      : t(route === 'do' ? 'write.do' : 'write.suggest');

  return (
    <form className="write" onSubmit={submit} noValidate>
      <label htmlFor={id} className="field-label">
        {t('write.label')}
      </label>
      <input
        ref={input}
        id={id}
        className="field"
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        placeholder={t('write.placeholder')}
        maxLength={MAX_TEXT + 40}
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {standard === 'school' ? (
        rows ? (
          <>
            <PlanEditor rows={rows} setRows={setRows} me={me.id} />
            <button type="button" className="link" onClick={() => setRows(null)}>
              {t('write.noSteps')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setRows([newRow(me.id)])}>
            <ListTree aria-hidden="true" size={22} strokeWidth={2.4} />
            {t('write.breakDown')}
          </button>
        )
      ) : null}

      <button type="submit" className="btn btn--primary btn--big btn--block">
        <Plus aria-hidden="true" size={24} strokeWidth={2.75} />
        {label}
      </button>
      {route === 'suggest' ? <p className="note">{t('write.suggestNote', { names: w.approverNames() })}</p> : null}
    </form>
  );
}

export function ChoosePanel() {
  const standard = useStandard();
  return standard === 'school' ? <ChoosePlan /> : <ChooseTile />;
}

function ChooseTile() {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const { t, lang } = useI18n();
  const list = useMemo(() => choices(ws, lang), [ws, lang]);

  if (!me) return null;
  const route = routeAction(me.perms, 'add', 'own');
  if (route === 'deny') return <ViewOnly />;

  const tile = (c: Choice) => (
    <li key={c.key}>
      <button type="button" className="tile" data-on={c.onList || undefined} onClick={() => run({ type: 'add', text: c.text })}>
        <span className="tile__icon">
          <TileIcon name={c.icon} />
        </span>
        <span className="tile__body">
          <span className="tile__text">{c.text}</span>
          {c.onList ? (
            <span className="tile__tag tile__tag--on">
              <Check aria-hidden="true" size={16} strokeWidth={3} />
              {t('choose.onList')}
            </span>
          ) : c.often ? (
            <span className="tile__tag">{t('choose.often')}</span>
          ) : null}
        </span>
      </button>
    </li>
  );

  return (
    <div className="choose">
      <p className="choose__hint">{route === 'do' ? t('choose.hint') : t('choose.hintSuggest')}</p>
      <ul className="tiles">{list.catalog.map(tile)}</ul>
      {list.own.length > 0 ? (
        <>
          <h3 className="tiles__title">{t('choose.own')}</h3>
          <ul className="tiles">{list.own.map(tile)}</ul>
        </>
      ) : null}
    </div>
  );
}

/** School: ready-made plans. A tap shows the plan first, with who does what, before anything is added. */
function ChoosePlan() {
  const ws = useWorkspace();
  const me = useMe();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<PlanTemplate | null>(null);
  const list = useMemo(() => (me ? planChoices(ws, lang, me.id) : []), [ws, lang, me]);

  if (!me) return null;
  if (routeAction(me.perms, 'add', 'own') === 'deny') return <ViewOnly />;

  return (
    <div className="choose">
      <p className="choose__hint">{t('choose.plansHint')}</p>
      <ul className="tiles tiles--plans">
        {list.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className="tile"
              data-on={c.onList || undefined}
              aria-haspopup="dialog"
              onClick={() => setOpen(PLANS.find((p) => p.key === c.key) ?? null)}
            >
              <span className="tile__icon">
                <TileIcon name={c.icon} />
              </span>
              <span className="tile__body">
                <span className="tile__text">{c.title}</span>
                {c.onList ? (
                  <span className="tile__tag tile__tag--on">
                    <Check aria-hidden="true" size={16} strokeWidth={3} />
                    {t('choose.onList')}
                  </span>
                ) : (
                  <span className="tile__tag">{t('choose.planMeta', { steps: c.shape.steps, rounds: c.shape.rounds })}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? <PlanSheet template={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
