/**
 * The two side options. Write: type it. Choose: tap a ready-made one.
 * Both send the same "add" command, so permissions, suggestions, duplicates
 * and undo behave identically whichever way something is added.
 */
import { Check, Eye, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { choices, routeAction, MAX_TEXT, type Choice } from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useWords, useWorkspace } from '../context';
import { TileIcon } from './bits';

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
  onAdded,
}: {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  readonly onAdded?: () => void;
}) {
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const route = routeAction(me.perms, 'add');
  if (route === 'deny') return <ViewOnly />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const o = run({ type: 'add', text: draft }, { quietRefusals: true });
    if (o.kind === 'refused') {
      setError(w.refusal(o.refusal));
      input.current?.focus();
      return;
    }
    setDraft('');
    setError(null);
    if (onAdded) onAdded();
    else input.current?.focus();
  };

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
      <button type="submit" className="btn btn--primary btn--big btn--block">
        <Plus aria-hidden="true" size={24} strokeWidth={2.75} />
        {route === 'do' ? t('write.do') : t('write.suggest')}
      </button>
      {route === 'suggest' ? <p className="note">{t('write.suggestNote', { names: w.approverNames() })}</p> : null}
    </form>
  );
}

export function ChoosePanel() {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const { t, lang } = useI18n();
  const list = useMemo(() => choices(ws, lang), [ws, lang]);

  if (!me) return null;
  const route = routeAction(me.perms, 'add');
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
