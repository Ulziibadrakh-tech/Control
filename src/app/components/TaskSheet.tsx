/** A task, close up: change its words, tick it, remove it, and see its story. */
import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cleanText, preview, published, routeAction, story, type TaskId } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import { Avatar } from './bits';
import { Sheet } from './Sheet';

export function TaskSheet({ id, onClose }: { readonly id: TaskId; readonly onClose: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const now = useNow();
  const w = useWords();
  const { t, when } = useI18n();
  const fieldId = useId();
  const edit = me ? routeAction(me.perms, 'edit') : 'deny';
  // People who may only suggest see (and build on) the list including what is waiting.
  const task = (edit === 'suggest' ? preview(ws) : published(ws)).tasks.get(id) ?? published(ws).tasks.get(id);
  const [base, setBase] = useState(task?.text ?? '');
  const [text, setText] = useState(task?.text ?? '');
  const [error, setError] = useState<string | null>(null);

  // If the task disappears (removed here or in another tab), close.
  useEffect(() => {
    if (!task) onClose();
  }, [task, onClose]);

  // Someone else changed the words while this was open: follow along if nothing was typed yet.
  useEffect(() => {
    if (!task || task.text === base) return;
    if (text === base) setText(task.text);
    setBase(task.text);
  }, [task, base, text]);

  if (!task || !me) return null;

  const check = routeAction(me.perms, 'check');
  const remove = routeAction(me.perms, 'remove');
  const changed = cleanText(text) !== task.text;
  const tale = story(ws, id, now);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    const o = run({ type: 'edit', id, text, from: base }, { quietRefusals: true });
    if (o.kind === 'refused') setError(w.refusal(o.refusal));
    else onClose();
  };

  const checkLabel = task.done
    ? t(check === 'do' ? 'task.notDone' : 'task.notDoneSuggest')
    : t(check === 'do' ? 'task.done' : 'task.doneSuggest');

  return (
    <Sheet title={t('task.title')} onClose={onClose}>
      {edit === 'deny' ? (
        <p className="task-text">{task.text}</p>
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

      <div className="stack">
        {check !== 'deny' ? (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            onClick={() => {
              run({ type: 'check', id, done: !task.done });
              onClose();
            }}
          >
            {task.done ? (
              <RotateCcw aria-hidden="true" size={22} strokeWidth={2.5} />
            ) : (
              <Check aria-hidden="true" size={22} strokeWidth={2.75} />
            )}
            {checkLabel}
          </button>
        ) : null}
        {remove !== 'deny' ? (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={() => {
              run({ type: 'remove', id });
              onClose();
            }}
          >
            <Trash2 aria-hidden="true" size={22} strokeWidth={2.4} />
            {t(remove === 'do' ? 'task.remove' : 'task.removeSuggest')}
          </button>
        ) : null}
        {edit === 'deny' && check === 'deny' && remove === 'deny' ? <p className="note">{t('task.readOnly')}</p> : null}
      </div>

      {tale ? (
        <section className="story" aria-labelledby={`${fieldId}-story`}>
          <h3 id={`${fieldId}-story`} className="story__title">
            {t('task.story')}
          </h3>
          <p className="story__age">{t('story.age', { days: tale.ageDays })}</p>
          <ol className="story__list">
            {[...tale.events].reverse().map((e) => (
              <li key={`${e.version}-${e.kind}`}>
                <Avatar person={w.person(e.by)} size="sm" />
                <span>{t(`story.${e.kind}` as const, { who: w.who(e.by) })}</span>
                <span className="story__when">{when(e.at, now)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </Sheet>
  );
}
