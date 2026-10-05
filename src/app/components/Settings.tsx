/** Who is using Control, text size, language — and the first-run welcome. */
import { Check } from 'lucide-react';
import { useState } from 'react';
import { people, roleOf, type Lang, type Person } from '../../core';
import { useI18n } from '../../i18n/react';
import { sampleWorkspace } from '../../store/seed';
import { usePrefs, useServices, useToast, useWords, useWorkspace } from '../context';
import type { TextSize } from '../prefs';
import { Avatar } from './bits';
import { Sheet } from './Sheet';

const SIZES: readonly TextSize[] = [0, 1, 2];
const LANGS: ReadonlyArray<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'mn', label: 'Монгол' },
];

function WhoPicker({ onPicked }: { readonly onPicked?: () => void }) {
  const ws = useWorkspace();
  const w = useWords();
  const [prefs, setPrefs] = usePrefs();
  return (
    <div className="who">
      {people(ws).map((p: Person) => (
        <button
          key={p.id}
          type="button"
          className="who__btn"
          aria-pressed={prefs.me === p.id}
          onClick={() => {
            setPrefs({ me: p.id });
            onPicked?.();
          }}
        >
          <Avatar person={p} size="xl" />
          <span className="who__name">{p.name}</span>
          <span className="who__role">{w.role(roleOf(p.perms))}</span>
          {prefs.me === p.id ? (
            <span className="who__check" aria-hidden="true">
              <Check size={18} strokeWidth={3.25} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function LanguagePicker() {
  const [prefs, setPrefs] = usePrefs();
  const { t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('settings.language')}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className="seg__btn"
          lang={l.id}
          aria-pressed={prefs.lang === l.id}
          onClick={() => setPrefs({ lang: l.id })}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSheet({ onClose }: { readonly onClose: () => void }) {
  const { store } = useServices();
  const [prefs, setPrefs] = usePrefs();
  const toast = useToast();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const status = store.status();

  const startOver = () => {
    const current = prefs.me ? store.get().replay.state.people.get(prefs.me)?.name : undefined;
    const fresh = sampleWorkspace(prefs.lang, Date.now());
    store.replace(fresh);
    const same = people(fresh).find((p) => p.name === current) ?? people(fresh)[0];
    setPrefs({ me: same?.id ?? null });
    toast.dismiss();
    onClose();
  };

  return (
    <Sheet
      title={t('settings.title')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary btn--big btn--block" onClick={onClose}>
          {t('settings.done')}
        </button>
      }
    >
      <section className="settings__group">
        <h3 className="settings__title">{t('settings.who')}</h3>
        <WhoPicker />
        <p className="note">{t('settings.later')}</p>
      </section>

      <section className="settings__group">
        <h3 className="settings__title">{t('settings.textSize')}</h3>
        <div className="seg seg--sizes" role="group" aria-label={t('settings.textSize')}>
          {SIZES.map((s) => (
            <button key={s} type="button" className="seg__btn" aria-pressed={prefs.textSize === s} onClick={() => setPrefs({ textSize: s })}>
              <span className={`size-a size-a--${s}`} aria-hidden="true">
                A
              </span>
              {t(`settings.size${s}` as const)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__group">
        <h3 className="settings__title">{t('settings.language')}</h3>
        <LanguagePicker />
      </section>

      {!status.persistent && !status.newerData ? <p className="note-card">{t('settings.notSaved')}</p> : null}
      {status.recovered ? <p className="note-card">{t('settings.recovered')}</p> : null}
      {status.newerData ? <p className="note-card">{t('settings.newer')}</p> : null}

      <section className="settings__group settings__group--quiet">
        {confirming ? (
          <div className="confirm">
            <p>{t('settings.startOverBody')}</p>
            <div className="confirm__row">
              <button type="button" className="btn btn--danger" onClick={startOver}>
                {t('settings.startOverYes')}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link" onClick={() => setConfirming(true)}>
            {t('settings.startOver')}
          </button>
        )}
      </section>
    </Sheet>
  );
}

export function Welcome() {
  const { t } = useI18n();
  return (
    <main className="welcome">
      <div className="welcome__card">
        <p className="welcome__brand">Control</p>
        <h1 className="welcome__title" tabIndex={-1} data-page-title>
          {t('welcome.title')}
        </h1>
        <p className="welcome__body">{t('welcome.body')}</p>
        <WhoPicker />
        <div className="welcome__lang">
          <LanguagePicker />
        </div>
      </div>
    </main>
  );
}
