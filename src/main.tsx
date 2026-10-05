import '@fontsource-variable/nunito/index.css';
import './app/styles/tokens.css';
import './app/styles/base.css';
import './app/styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { systemEnv } from './core';
import { App } from './app/App';
import { createPrefsStore } from './app/prefs';
import { createLocalStore, safeLocalStorage } from './store/localStore';
import { sampleWorkspace } from './store/seed';

const WORKSPACE_KEY = 'control.workspace.v1';

const prefs = createPrefsStore();
const store = createLocalStore({
  key: WORKSPACE_KEY,
  storage: safeLocalStorage(),
  seed: () => sampleWorkspace(prefs.get().lang, Date.now()),
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
