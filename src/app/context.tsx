/** React bindings: services, preferences, the clock, toasts, and running commands. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { dispatch, type Command, type Env, type Outcome, type Person, type StandardId, type Workspace } from '../core';
import { useI18n } from '../i18n/react';
import type { WorkspaceStore } from '../store/store';
import type { Prefs, PrefsStore } from './prefs';
import { makeWords, toastFor, type Words } from './words';

export interface Services {
  readonly store: WorkspaceStore;
  readonly prefs: PrefsStore;
  readonly env: Env;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesProvider is missing');
  return s;
}

export function useWorkspace(): Workspace {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const { prefs } = useServices();
  const value = useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
  return [value, prefs.set];
}

/** Which ready-made setup this workspace follows ("school" or "home"). */
export function useStandard(): StandardId {
  return useWorkspace().data.standard;
}

/** The person using the app, if they are (still) on the list. */
export function useMe(): Person | undefined {
  const ws = useWorkspace();
  const [prefs] = usePrefs();
  return prefs.me ? ws.replay.state.people.get(prefs.me) : undefined;
}

/** The current time, refreshed every half minute and when the page becomes visible again. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}

export function useWords(): Words {
  const i18n = useI18n();
  const ws = useWorkspace();
  const [prefs] = usePrefs();
  return useMemo(() => makeWords(i18n, ws, prefs.me), [i18n, ws, prefs.me]);
}

/* ------------------------------------------------------------------ toasts */

export interface ToastSpec {
  readonly message: string;
  readonly tone: 'info' | 'warn';
  readonly action?: { readonly label: string; readonly kind: 'undo' | 'redo' | 'takeBack'; readonly run: () => void };
}

export interface Toast extends ToastSpec {
  readonly id: number;
}

interface ToastApi {
  readonly current: Toast | null;
  show(t: ToastSpec): void;
  dismiss(): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const show = useCallback((t: ToastSpec) => setCurrent({ ...t, id: Date.now() + Math.random() }), []);
  const dismiss = useCallback(() => setCurrent(null), []);
  const api = useMemo(() => ({ current, show, dismiss }), [current, show, dismiss]);
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const t = useContext(ToastContext);
  if (!t) throw new Error('ToastProvider is missing');
  return t;
}

/* --------------------------------------------------------------- commands */

export interface RunOptions {
  /** Do not toast refusals: the caller shows them next to the field instead. */
  readonly quietRefusals?: boolean;
}

/**
 * Run a command as the current person: dispatch on the newest workspace, save,
 * and explain the outcome in a toast (with Undo where it makes sense).
 */
export function useRun(): (cmd: Command, opts?: RunOptions) => Outcome {
  const { store, env, prefs } = useServices();
  const i18n = useI18n();
  const toast = useToast();

  const run = useCallback(
    (cmd: Command, opts: RunOptions = {}): Outcome => {
      const me = prefs.get().me;
      if (!me) return { kind: 'refused', refusal: { code: 'not-a-member' } };
      const { outcome, before } = store.transact((ws) => {
        const o = dispatch(ws, me, cmd, env);
        return { next: o.kind === 'refused' ? null : o.ws, result: { outcome: o, before: ws } };
      });
      if (outcome.kind === 'refused' && opts.quietRefusals) return outcome;
      const after = outcome.kind === 'refused' ? before : outcome.ws;
      const words = makeWords(i18n, after, me);
      const spec = toastFor(outcome, cmd, before, words, (next) => void run(next));
      if (spec) toast.show(spec);
      return outcome;
    },
    [store, env, prefs, i18n, toast],
  );
  return run;
}
