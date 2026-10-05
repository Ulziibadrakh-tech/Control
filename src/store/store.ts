/**
 * The storage port. The interface talks to this, never to localStorage.
 *
 * A server-backed store would implement the same contract: `transact` runs a
 * pure function against the newest workspace and saves the result atomically
 * (optimistic concurrency on `rev`), and `subscribe` reports changes made
 * elsewhere. Permission checks already live in the pure core, so the same
 * `dispatch` can run on a server unchanged.
 */
import type { Workspace } from '../core';

export interface StoreStatus {
  /** False when changes cannot be saved on this device (private mode, blocked storage, full disk). */
  readonly persistent: boolean;
  /** True when saved data could not be read and a fresh list was started (the old data is kept aside). */
  readonly recovered: boolean;
  /** True when the saved data comes from a newer version of the app; it is left untouched. */
  readonly newerData: boolean;
}

export interface WorkspaceStore {
  get(): Workspace;
  status(): StoreStatus;
  subscribe(listener: () => void): () => void;
  /** Run `fn` on the newest workspace. If it returns a next workspace, save it and notify. */
  transact<T>(fn: (ws: Workspace) => { readonly next: Workspace | null; readonly result: T }): T;
  /** Replace everything (used by "start over"). */
  replace(ws: Workspace): void;
  /** Pick up changes another tab saved. */
  sync(): void;
}
