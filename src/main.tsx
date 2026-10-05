import '@fontsource-variable/nunito/index.css';
import './app/styles/tokens.css';
import './app/styles/base.css';
import './app/styles/app.css';
import './app/styles/plans.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { systemEnv, type StandardId } from './core';
import { App } from './app/App';
import { createPrefsStore } from './app/prefs';
import { createLocalStore, safeLocalStorage } from './store/localStore';
import { sampleWorkspace } from './store/seed';

/**
 * v2: the school version. Data saved by the first version (v1) stays where it
 * is, untouched; "Settings → Start over" brings back either example.
 */
const WORKSPACE_KEY = 'control.workspace.v2';

/** Which example a fresh start shows: the school, unless the address says ?example=home. */
function firstExample(): StandardId {
  try {
    return new URLSearchParams(window.location.search).get('example') === 'home' ? 'home' : 'school';
  } catch {
    return 'school';
  }
}

const prefs = createPrefsStore();
const store = createLocalStore({
  key: WORKSPACE_KEY,
  storage: safeLocalStorage(),
  seed: () => sampleWorkspace(firstExample(), prefs.get().lang, Date.now()),
});

// Another tab saved something: pick it up.
window.addEventListener('storage', (e) => {
  if (e.key === null || e.key.startsWith(WORKSPACE_KEY)) store.sync();
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App services={{ store, prefs, env: systemEnv }} />
  </StrictMode>,
);
