/**
 * Routing by URL hash, so the browser's Back button works the way people expect.
 *
 * Links still carry real hrefs (for "open in new tab" and screen readers), but
 * a plain click goes through `navigate`, which sets the hash on this document
 * directly. That also works when the app runs inside a sandboxed frame, where
 * a bare "#/…" link could resolve against the host page instead.
 */
import { useSyncExternalStore, type MouseEvent } from 'react';

export type Route = 'home' | 'history' | 'people';

export function parseRoute(hash: string): Route {
  if (hash.startsWith('#/history')) return 'history';
  if (hash.startsWith('#/people')) return 'people';
  return 'home';
}

export const hrefOf = (r: Route): string => (r === 'home' ? '#/' : `#/${r}`);

const listeners = new Set<() => void>();
let current: Route = typeof window === 'undefined' ? 'home' : parseRoute(window.location.hash);

function emit(): void {
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parseRoute(window.location.hash);
    emit();
  });
}

export function navigate(r: Route): void {
  current = r;
  try {
    const hash = hrefOf(r);
    if (window.location.hash !== hash) window.location.hash = hash.slice(1);
  } catch {
    // Some embedded frames refuse URL changes; the in-memory route still moves.
  }
  emit();
}

/** onClick for a route link: plain clicks navigate in place; modified clicks keep the browser's behaviour. */
export function onRouteClick(r: Route) {
  return (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(r);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'home',
  );
}
