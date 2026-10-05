/**
 * Per-device preferences: who is using the app, text size, language, and the
 * last side option. "Who" is also kept per tab, so two tabs can be two people
 * (handy for trying the suggestion flow on one computer).
 */
import type { Lang, PersonId } from '../core';
import { detectLang } from '../i18n/i18n';

export type TextSize = 0 | 1 | 2;
export type Panel = 'write' | 'choose';

export interface Prefs {
  readonly me: PersonId | null;
  readonly textSize: TextSize;
  readonly lang: Lang;
  readonly panel: Panel;
}

export interface PrefsStore {
  get(): Prefs;
  set(patch: Partial<Prefs>): void;
  subscribe(listener: () => void): () => void;
}

const KEY = 'control.prefs.v1';
const TAB_ME = 'control.me';

function storageOrNull(get: () => Storage): Storage | null {
  try {
    const s = get();
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // Preferences are a convenience; never fail because of them.
  }
}

export function createPrefsStore(): PrefsStore {
  const hasWindow = typeof window !== 'undefined';
  const local = hasWindow ? storageOrNull(() => window.localStorage) : null;
  const session = hasWindow ? storageOrNull(() => window.sessionStorage) : null;

  let saved: Partial<Record<keyof Prefs, unknown>> = {};
  attempt(() => {
    const raw = local?.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
  });
  let tabMe: string | null = null;
  attempt(() => {
    tabMe = session?.getItem(TAB_ME) ?? null;
  });

  let prefs: Prefs = {
    me: (tabMe ?? (typeof saved.me === 'string' ? saved.me : null)) as PersonId | null,
    textSize: saved.textSize === 1 || saved.textSize === 2 ? saved.textSize : 0,
    lang: saved.lang === 'mn' || saved.lang === 'en' ? saved.lang : detectLang(),
    panel: saved.panel === 'choose' ? 'choose' : 'write',
  };

  const listeners = new Set<() => void>();

  return {
    get: () => prefs,
    set(patch) {
      prefs = { ...prefs, ...patch };
      attempt(() => local?.setItem(KEY, JSON.stringify(prefs)));
      if ('me' in patch) {
        attempt(() => {
          if (prefs.me) session?.setItem(TAB_ME, prefs.me);
          else session?.removeItem(TAB_ME);
        });
      }
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
