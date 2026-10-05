/**
 * Suggestions: GitHub-style pull requests for list data.
 *
 * There is at most one open suggestion per list, shared by everyone who may
 * only propose. Each person's action lands in it as a *batch*. Batches from
 * different people combine, so two helpers whose permissions differ can
 * prepare one change together that neither could prepare alone. Someone with
 * "approve" then accepts or declines it.
 *
 * A suggestion is evaluated against the current published state every time it
 * is looked at. Each batch is rebased (see rebaseChange) and applied
 * all-or-nothing; batches that no longer fit, or that would break a plan's
 * rules, are reported as out of date and skipped. Nobody ever has to resolve
 * a merge by hand.
 */
import { rebaseSet, type ChangeSet, type SetConflict } from './changeset';
import type { BatchId, PersonId, SuggestionId } from './ids';
import type { State } from './model';
import { planProblem, touchedTasks, type PlanProblem } from './plan';

export type Origin =
  | { readonly type: 'action' }
  | { readonly type: 'undo'; readonly of: number }
  | { readonly type: 'restore'; readonly to: number };

export type BatchStatus = 'pending' | 'withdrawn' | 'declined' | 'applied' | 'skipped';

export interface Batch {
  readonly id: BatchId;
  readonly by: PersonId;
  readonly at: number;
  readonly changes: ChangeSet;
  readonly origin: Origin;
  readonly status: BatchStatus;
  readonly decidedBy: PersonId | null;
  readonly decidedAt: number | null;
}

export type Resolution =
  | { readonly type: 'accepted'; readonly by: PersonId; readonly at: number; readonly version: number }
  | { readonly type: 'declined'; readonly by: PersonId; readonly at: number }
  | { readonly type: 'withdrawn'; readonly at: number };

export interface Suggestion {
  readonly id: SuggestionId;
  readonly openedAt: number;
  readonly batches: readonly Batch[];
  readonly resolution: Resolution | null;
}

export interface EvaluatedBatch {
  readonly batch: Batch;
  /** The batch's changes adapted to the current state. Empty if it is already true. */
  readonly changes: ChangeSet;
}

export interface StaleBatch {
  readonly batch: Batch;
  /** The change that no longer fits, if that is why. */
  readonly conflict: SetConflict | null;
  /** The plan rule it would break, if that is why. */
  readonly problem: PlanProblem | null;
}

export interface Evaluation {
  /** Published state with every batch that still fits applied on top. */
  readonly preview: State;
  readonly valid: readonly EvaluatedBatch[];
  readonly stale: readonly StaleBatch[];
}

export function pendingBatches(s: Suggestion): Batch[] {
  return s.batches.filter((b) => b.status === 'pending');
}

export function evaluate(published: State, s: Suggestion): Evaluation {
  let preview = published;
  const valid: EvaluatedBatch[] = [];
  const stale: StaleBatch[] = [];
  for (const batch of pendingBatches(s)) {
    const r = rebaseSet(preview, batch.changes);
    if (!r.ok) {
      stale.push({ batch, conflict: r.error, problem: null });
      continue;
    }
    const problem = planProblem(r.value.state, touchedTasks(r.value.changes, preview, r.value.state));
    if (problem) {
      stale.push({ batch, conflict: null, problem });
      continue;
    }
    preview = r.value.state;
    valid.push({ batch, changes: r.value.changes });
  }
  return { preview, valid, stale };
}

export function contributors(batches: readonly Batch[]): PersonId[] {
  return [...new Set(batches.map((b) => b.by))];
}

export function decide(b: Batch, status: BatchStatus, by: PersonId, at: number): Batch {
  return { ...b, status, decidedBy: by, decidedAt: at };
}

/** When nothing is pending any more, the suggestion closes by itself. */
export function closeIfEmpty(s: Suggestion, by: PersonId, at: number): Suggestion {
  if (s.resolution !== null || pendingBatches(s).length > 0) return s;
  const anyDeclined = s.batches.some((b) => b.status === 'declined');
  return { ...s, resolution: anyDeclined ? { type: 'declined', by, at } : { type: 'withdrawn', at } };
}
