/**
 * Choosing what someone can do: a five-step ladder for the usual cases, and
 * "Fine-tune" (No / Suggest / Yes per action) for the rest. Every save is a
 * versioned change with Undo, like everything else.
 */
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  ACTIONS,
  has,
  levelOf,
  PRESETS,
  presetPerms,
  roleOf,
  withFlag,
  withLevel,
  type Flag,
  type LevelChoice,
  type Perms,
  type Person,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useWords } from '../context';
import { Sheet } from './Sheet';

const LEVELS: readonly LevelChoice[] = ['none', 'suggest', 'do'];
const FLAGS: readonly Flag[] = ['approve', 'manage'];

function Ladder({ value, onChange, name }: { readonly value: Perms; readonly onChange: (p: Perms) => void; readonly name: string }) {
  const { t } = useI18n();
  return (
    <fieldset className="ladder">
      <legend className="sr-only">{t('addperson.role')}</legend>
      {PRESETS.map((p) => (
        <label key={p.id} className="choice">
          <input type="radio" name={name} checked={value === p.perms} onChange={() => onChange(p.perms)} />
          <span className="choice__title">{t(`role.${p.id}` as const)}</span>
          <span className="choice__desc">{t(`roleDesc.${p.id}` as const)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function FineTune({ value, onChange }: { readonly value: Perms; readonly onChange: (p: Perms) => void }) {
  const { t } = useI18n();
  const id = useId();
  // Open at first for custom mixes; after that it stays however the person left it.
  const [initiallyOpen] = useState(() => roleOf(value) === 'custom');
  return (
    <details className="finetune" open={initiallyOpen}>
      <summary>
        <ChevronDown aria-hidden="true" size={20} strokeWidth={2.75} className="finetune__chev" />
        {t('rolesheet.fineTune')}
      </summary>
      <div className="finetune__body">
        {ACTIONS.map((a) => (
          <div key={a} className="ft-row" role="radiogroup" aria-labelledby={`${id}-${a}`}>
            <span id={`${id}-${a}`} className="ft-row__label">
              {t(`actTitle.${a}` as const)}
            </span>
            <div className="seg seg--small">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  className="seg__btn"
                  aria-checked={levelOf(value, a) === l}
                  onClick={() => onChange(withLevel(value, a, l))}
                >
                  {t(`level.${l}` as const)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {FLAGS.map((f) => (
          <label key={f} className="switch-row">
            <span>{t(`flag.${f}` as const)}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={has(value, f)}
              onChange={(e) => onChange(withFlag(value, f, e.target.checked))}
            />
          </label>
        ))}
      </div>
    </details>
  );
}

export function RoleSheet({ person, onClose }: { readonly person: Person; readonly onClose: () => void }) {
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t } = useI18n();
  const name = useId();
  const [base, setBase] = useState<Perms>(person.perms);
  const [draft, setDraft] = useState<Perms>(person.perms);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isMe = me?.id === person.id;

  // Changed elsewhere while open: follow along if nothing was chosen yet.
  useEffect(() => {
    if (person.perms === base) return;
    if (draft === base) setDraft(person.perms);
    setBase(person.perms);
  }, [person.perms, base, draft]);

  const save = () => {
    if (draft === base) return onClose();
    const o = run({ type: 'setPerms', id: person.id, perms: draft, from: base }, { quietRefusals: true });
    if (o.kind === 'refused') setError(w.refusal(o.refusal));
    else onClose();
  };

  return (
    <Sheet
      title={t('rolesheet.title', { name: person.name })}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="btn btn--primary btn--big btn--block" onClick={save}>
            {t('rolesheet.save')}
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            {t('rolesheet.cancel')}
          </button>
        </>
      }
    >
      <Ladder value={draft} onChange={(p) => { setDraft(p); setError(null); }} name={name} />
      <FineTune value={draft} onChange={(p) => { setDraft(p); setError(null); }} />
      <p className="note">{w.permsLines(draft).join(' ')}</p>

      {!isMe ? (
        confirming ? (
          <div className="confirm">
            <p>{t('rolesheet.removeConfirm', { name: person.name })}</p>
            <div className="confirm__row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  const o = run({ type: 'removePerson', id: person.id });
                  if (o.kind !== 'refused') onClose();
                }}
              >
                {t('rolesheet.removeYes')}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link link--danger" onClick={() => setConfirming(true)}>
            {t('rolesheet.remove', { name: person.name })}
          </button>
        )
      ) : null}
    </Sheet>
  );
}

export function AddPersonSheet({ onClose }: { readonly onClose: () => void }) {
  const run = useRun();
  const w = useWords();
  const { t } = useI18n();
  const id = useId();
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<Perms>(presetPerms('helper'));
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const o = run({ type: 'addPerson', name, perms }, { quietRefusals: true });
    if (o.kind === 'refused') setError(w.refusal(o.refusal));
    else onClose();
  };

  return (
    <Sheet
      title={t('addperson.title')}
      onClose={onClose}
      focus="field"
      footer={
        <button type="button" className="btn btn--primary btn--big btn--block" onClick={add}>
          {t('addperson.save')}
        </button>
      }
    >
      <div className="write">
        <label htmlFor={id} className="field-label">
          {t('addperson.name')}
        </label>
        <input
          id={id}
          className="field"
          type="text"
          value={name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          aria-invalid={error ? true : undefined}
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <p className="field-label">{t('addperson.role')}</p>
      <Ladder value={perms} onChange={setPerms} name={`${id}-role`} />
    </Sheet>
  );
}
