import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskId } from '../core';
import { I18nProvider, useI18n } from '../i18n/react';
import { ServicesProvider, ToastProvider, useMe, usePrefs, type Services } from './context';
import { Header } from './components/Header';
import { HistoryPage } from './components/HistoryPage';
import { Home } from './components/Home';
import { PeoplePage } from './components/PeoplePage';
import { ReviewSheet } from './components/ReviewSheet';
import { SettingsSheet, Welcome } from './components/Settings';
import { TaskSheet } from './components/TaskSheet';
import { ToastHost } from './components/ToastHost';
import { useRoute } from './route';

export function App({ services }: { readonly services: Services }) {
  return (
    <ServicesProvider services={services}>
      <WithLanguage>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </WithLanguage>
    </ServicesProvider>
  );
}

function WithLanguage({ children }: { readonly children: ReactNode }) {
  const [prefs] = usePrefs();
  return <I18nProvider lang={prefs.lang}>{children}</I18nProvider>;
}

/** Keep <html lang>, text size and the tab title in step with preferences. */
function useDocumentSettings(): void {
  const [prefs] = usePrefs();
  const { t } = useI18n();
  useEffect(() => {
    const root = document.documentElement;
    root.lang = prefs.lang;
    root.dataset.textSize = String(prefs.textSize);
    document.title = `${t('app.name')} · ${t('list.title')}`;
  }, [prefs.lang, prefs.textSize, t]);
}

function Shell() {
  const me = useMe();
  const route = useRoute();
  const [task, setTask] = useState<TaskId | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [settings, setSettings] = useState(false);
  const firstRoute = useRef(true);
  useDocumentSettings();

  // On every page change, start at the top and move focus to the page title (for screen readers and keyboards).
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('[data-page-title]')?.focus({ preventScroll: true });
  }, [route]);

  if (!me) {
    return (
      <>
        <Welcome />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <div className="app">
        <Header route={route} onOpenSettings={() => setSettings(true)} />
        <main className="main">
          {route === 'history' ? (
            <HistoryPage />
          ) : route === 'people' ? (
            <PeoplePage />
          ) : (
            <Home onOpenTask={setTask} onOpenReview={() => setReviewing(true)} />
          )}
        </main>
      </div>
      {task ? <TaskSheet id={task} onClose={() => setTask(null)} /> : null}
      {reviewing ? <ReviewSheet onClose={() => setReviewing(false)} /> : null}
      {settings ? <SettingsSheet onClose={() => setSettings(false)} /> : null}
      <ToastHost />
    </>
  );
}
