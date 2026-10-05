/**
 * One step, close up: its words, who does it, what it waits for, tick, remove.
 * Who and waits apply as soon as they are chosen (each with Undo); words are
 * saved with a button, like a task's words.
 *
 * Someone who sees only their part of a plan sees the steps around theirs by
 * name and the rest only as a number ("and 2 other steps"), as in the plan.
 */
import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cleanText, nodesOf, planFor, published, routeAction, stepsOf, waitCost, type StepId } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useWords, useWorkspace } from '../context';
import { Avatar } from './bits';
import { WhoSelect } from './PlanEditor';
import { waitOptions, waitsText } from './PlanView';
import { Sheet } from './Sheet';

export function StepSheet({ id, onClose }: { readonly id: StepId; readonly onClose: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t, list } = useI18n();
  const fieldId = useId();
  const pub = published(ws);
  const step = pub.steps.get(id);
  const task = step ? pub.tasks.get(step.task) : undefined;
  // The plan as this person may see it, and this step's place in it.
  const view = useMemo(() => (me && task ? planFor(pub, me, task) : null), [pub, me, task]);
  const item = view?.steps.find((ps) => ps.step.id === id);
  const [base, setBase] = useState(step?.text ?? '');
  const [text, setText] = useState(step?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<number | null>(null);

  // Removed here or elsewhere, or no longer theirs to see: close.
  useEffect(() => {
    if (!step || (view && !item)) onClose();
  }, [step, view, item, onClose]);

  // Someone else changed the words while this was open: follow along if nothing was typed yet.
  useEffect(() => {
    if (!step || step.text === base) return;
    if (text === base) setText(step.text);
    setBase(step.text);
  }, [step, base, text]);

  if (!step || !task || !me || !view || !item) return null;

  const ownsPlan = task.createdBy === me.id;
  const edit = routeAction(me.perms, 'edit', ownsPlan ? 'own' : 'all');
  const remove = routeAction(me.perms, 'remove', ownsPlan ? 'own' : 'all');
  const check = routeAction(me.perms, 'check', ownsPlan || step.who === me.id ? 'own' : 'all');
  const changed = cleanText(text) !== step.text;
  const options = waitOptions(ws, id);
  const waiting = item.waitingFor.length + item.hiddenWaits > 0;
  // Everything it waits for, done or not: by name what this person sees, the rest as a number.
  const shown = new Set(view.steps.map((ps) => ps.step.id));
  const named = step.after.filter((d) => shown.has(d)).map((d) => `“${pub.steps.get(d)?.text ?? '…'}”`);
  const unnamed = step.after.length - named.length;
  const afterText = list(unnamed > 0 ? [...named, t('plan.waitsMore', { n: unnamed })] : named);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    const o = run({ type: 'editStep', id, text, from: base }, { quietRefusals: true });
    if (o.kind === 'refused') setError(w.refusal(o.refusal));
  };

  const toggleWait = (dep: StepId, on: boolean) => {
    const after = on ? step.after.filter((a) => a !== dep) : [...step.after, dep];
    if (!on) {
      const n = waitCost(nodesOf(stepsOf(pub, step.task)), step.id, dep);
      setHint(n > 0 ? n : null);
    } else setHint(null);
    // With what was on screen, so a change someone else made meanwhile is not silently overwritten.
    run({ type: 'setWaits', id, after, from: step.after });
  };

  return (
    <Sheet title={t('step.title', { n: step.n })} onClose={onClose}>
      {edit === 'deny' ? (
        <p className="task-text">{step.text}</p>
      ) : (
        <form className="write" onSubmit={save} noValidate>
          <label htmlFor={fieldId} className="field-label">
            {t('task.words')}
          </label>
          <input
            id={fieldId}
            className="field"
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {changed ? (
            <button type="submit" className="btn btn--primary btn--block">
              {t(edit === 'do' ? 'task.save' : 'task.saveSuggest')}
            </button>
          ) : null}
        </form>
      )}

      <section className="stepsheet__group">
        {edit === 'deny' ? (
          <h3 className="stepsheet__title">{t('step.who')}</h3>
        ) : (
          <label className="stepsheet__title" htmlFor={`${fieldId}-who-select`}>
            {t('step.who')}
          </label>
        )}
        {edit === 'deny' ? (
          <p className="srow__who">
            <Avatar person={w.person(step.who)} size="sm" />
            {w.nameOrLeft(step.who)}
          </p>
        ) : (
          <WhoSelect
            id={`${fieldId}-who-select`}
            groups={false}
            value={{ kind: 'person', id: step.who }}
            onChange={(v) => {
              if (v.kind === 'person' && v.id !== step.who) run({ type: 'assignStep', id, who: v.id, from: step.who });
            }}
          />
        )}
      </section>

      <section className="stepsheet__group">
        <h3 className="stepsheet__title">{t('step.waits')}</h3>
        {edit === 'deny' || options.length === 0 ? (
          <p className="note">{step.after.length === 0 ? t('step.waitsNone') : afterText}</p>
        ) : (
          <>
            {step.after.length === 0 ? <p className="note">{t('step.waitsNone')}</p> : null}
            <span className="wchips" role="group" aria-label={t('step.waits')}>
              {options.map((o) => (
                <button
                  key={o.step.id}
                  type="button"
                  className="wchip"
                  aria-pressed={o.on}
                  disabled={o.circle}
                  title={o.circle ? t('shape.circle') : undefined}
                  onClick={() => toggleWait(o.step.id, o.on)}
                >
                  <span className="wchip__n">{o.step.n}</span>
                  <span className="wchip__text">{o.step.text}</span>
                </button>
              ))}
            </span>
            {hint ? <p className="pstep__hint">{t('shape.cost', { n: hint })}</p> : null}
          </>
        )}
      </section>

      <div className="stack">
        {check !== 'deny' && (step.done || !waiting) ? (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            onClick={() => {
              const o = run({ type: 'checkStep', id, done: !step.done });
              if (o.kind !== 'refused') onClose();
            }}
          >
            {step.done ? (
              <RotateCcw aria-hidden="true" size={22} strokeWidth={2.5} />
            ) : (
              <Check aria-hidden="true" size={22} strokeWidth={2.75} />
            )}
            {step.done
              ? t(check === 'do' ? 'task.notDone' : 'task.notDoneSuggest')
              : t(check === 'do' ? 'task.done' : 'task.doneSuggest')}
          </button>
        ) : null}
        {waiting && !step.done ? <p className="note">{waitsText(item, t, list)}</p> : null}
        {remove !== 'deny' ? (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={() => {
              const o = run({ type: 'removeStep', id });
              if (o.kind !== 'refused') onClose();
            }}
          >
            <Trash2 aria-hidden="true" size={22} strokeWidth={2.4} />
            {t(remove === 'do' ? 'step.remove' : 'step.removeSuggest')}
          </button>
        ) : null}
        {edit === 'deny' && check === 'deny' && remove === 'deny' ? <p className="note">{t('step.readOnly')}</p> : null}
      </div>
    </Sheet>
  );
}
