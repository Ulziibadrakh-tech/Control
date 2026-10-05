import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Lang } from '../core';
import { makeI18n, type I18n } from './i18n';

const I18nContext = createContext<I18n>(makeI18n('en'));

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => makeI18n(lang), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18n => useContext(I18nContext);
