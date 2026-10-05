# Architecture

## Principles

1. **The interface never changes data.** It sends commands to one function, `dispatch`, and shows the outcome.
2. **History is stored, state is not.** The current list is the replay of an append-only log. History, undo, "go back" and the audit trail all come from that single rule.
3. **Rules live in one place.** Permissions, routing, invariants and conflict handling are pure functions in `src/core`, tested without a browser.
4. **Every refusal has a reason code.** The core returns `{ code: 'conflict', laterBy, … }`, never a sentence. Words live in `src/i18n`, in two languages.
5. **A pure core and a thin shell.** The core has no React, no DOM and no clock of its own. Time and ids are injected (`Env`), so tests and the sample history are deterministic.

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│ app/  React interface                                         │
│   Home (Write · Choose · list) · sheets · What changed · People│
│   useRun(cmd) → toast with Undo         words.ts → sentences  │
├───────────────────────────────────────────────────────────────┤
│ i18n/ English · Mongolian (typed: a missing key won't compile)│
├───────────────────────────────────────────────────────────────┤
│ store/ WorkspaceStore port ── localStore adapter              │
│        versioned schema · decode · migrate · sample history   │
├───────────────────────────────────────────────────────────────┤
│ core/  pure TypeScript                                        │
│   permissions (lattice) · changes/changeset (groupoid)        │
│   history (log, replay) · suggestions (batches, evaluation)   │
│   policy (routing) · workspace (dispatch) · view · insights   │
│   catalog · describe (phrases)                                │
└───────────────────────────────────────────────────────────────┘
```

Dependencies only point downwards. `core` imports nothing from the others.

## The life of a tap

Saraa (who may only suggest) taps **Choose → Drink water**:

```
ChoosePanel ── run({ type: 'add', text: 'Drink water' })
  useRun ── store.transact(ws =>
      dispatch(ws, saraa, cmd, env)
        ├─ actor on the list?                      else refused: not-a-member
        ├─ text clean, not too long, not a duplicate?
        ├─ routeAction(saraa.perms, 'add')  →  'suggest'
        ├─ build the change against the preview  { op: 'task.add', task }
        └─ propose(): rebase onto the preview, append a batch to the open suggestion
      → Outcome { kind: 'suggested', ws', suggestion, batch })
  store saves ws' (rev + 1) and notifies subscribers; other tabs reload
  toastFor(outcome) → "Sent to Dulmaa or Anu for an OK."  [Take back]
React re-renders: the row appears dashed, "Waiting for an OK", [Take back]
```

Dulmaa, in another tab, sees the banner straight away and taps **Look → Yes, accept**:

```
dispatch(ws, dulmaa, { type: 'accept', suggestion })
  ├─ has 'approve'?  four-eyes: not only her own batches?
  ├─ evaluation: each pending batch rebased onto the current state, in order
  └─ publish one version  { by: dulmaa, cause: { type: 'suggestion', contributors: [saraa, bat] } }
```

## Data model

```ts
Task      { id, text, done, createdAt, createdBy }
Person    { id, name, hue, perms }                       // perms: a closed set of atoms
State     { tasks: Map<id, Task>, people: Map<id, Person> }   // no stored order

Change    task.add(task) | task.remove(task) | task.edit(id, from, to) | task.check(id, from, to)
        | person.add(person) | person.remove(person) | person.perms(id, from, to)

Version   { n, at, by, changes: Change[], cause }
          cause: setup | direct | undo(of n) | restore(to n) | suggestion(id, contributors)

Suggestion { id, openedAt, batches: Batch[], resolution: null | accepted | declined | withdrawn }
Batch      { id, by, at, changes, origin: action | undo | restore,
             status: pending | withdrawn | declined | applied | skipped }
```

Every change carries the *before* it expects as well as the *after*, so every change has an exact inverse and a change never applies silently to the wrong state.

Tasks have no stored position. Order is derived (`createdAt`), so no change depends on an index, and undo always puts a task back exactly as it was.

## Routing policy (`core/policy.ts`)

For the changes an action would make, compute what they require as a lattice element and compare it with the person's permissions:

| Requirement covered at… | Result |
|---|---|
| `do` level | published directly, as a new version |
| `suggest` level | added as a batch to the shared suggestion |
| neither | refused, naming the missing atoms |

People changes need `manage` and can never be suggested.

**Undo is not a special power.** Undoing a version is its inverse change set, routed by the same rule: a helper's undo becomes a suggestion. The one exception (`POLICY.ownUndo`) lets people take back their own action without the inverse right ("I added it, I can take it back"), and only when all four of these hold:

- they made the change themselves, not by accepting someone else's suggestion
- it touched only tasks, never roles
- they are *still* allowed to make that change today, so someone turned into "Can look" can change nothing
- nobody has touched those tasks since, so the exact inverse still applies

**Four eyes is judged on the net effect.** Every thing that accepting would actually change must have been touched by someone else who is still on the list (`acceptance()`, used by both `dispatch` and the interface). Suggestions that cancel each other out do not count as a second pair of eyes, and removing a person withdraws their waiting suggestions.

**Edits carry what they were based on.** The task sheet and the role sheet send `from` (the words or the role on screen when editing began). If someone changed it in the meantime, the save is refused with "Someone changed this while you were looking".

**Invariants** are checked on the *result* of every version that touches people, so no path (direct, undo or go back) can bypass them: someone must still have `manage`, the actor must still be on the list, and names stay unique.

## Suggestions and rebasing

A suggestion is never rebased by hand. Each time it is looked at, `evaluate()` takes its pending batches in order and rebases each one onto the current state:

- a **remove** removes the task as it is now (ticked or renamed since, it still goes)
- an **edit**, **tick** or **role change** whose target state is already true is *satisfied* and dropped
- anything else that no longer fits makes the batch **stale**. It is shown as "No longer possible" and skipped

The preview state (published plus valid batches) is what helpers see and act on. A helper can build on their own pending addition: add "Kefir", then change it to "Kefir, 2 litres".

## Undo and going back

- **Undo version n**: `normalize(invert(v.changes))`. The strict inverse goes first (needed for the own-undo exception), then a rebased version. Conflicts name the first later version that touched the thing.
- **Go back to version n**: the normalized inverse of every *task* change after n. People are left alone. It applies by construction, since it is the inverse path in the groupoid.
- Both publish new versions (`cause: undo | restore`), so both can be undone.

## Storage (`store/`)

- **Port** (`store.ts`): `get`, `subscribe`, `transact(fn)`, `replace`, `sync`, `status`. A server adapter would implement `transact` with optimistic concurrency on `rev`.
- **localStorage adapter** (`localStore.ts`):
  - probes storage. If it is missing or blocked (private mode), it runs in memory and says so in Settings
  - unreadable data is **copied aside** (`…unreadable.<time>`) before starting fresh
  - data from a **newer schema** is left untouched and never overwritten
  - **multi-tab**: every save also writes a unique token. Before each write the store compares tokens, not counters, and reloads first if another tab saved, so a write always starts from the newest copy and two tabs can never both think they are newest. The `storage` event triggers `sync()` in the other tabs
  - **failed saves** (storage full): the change stays in memory and Settings says changes are not being saved. The next successful save writes everything, and nothing is reloaded over unsaved work
- **Stored format** (`schema.ts`): versioned (`schema: 1`), permissions stored as readable atom names, a strict decoder that reports *where* data is wrong, and a `migrate()` hook for future versions.
- **Sample history** (`seed.ts`): built by running real commands through the real `dispatch`, so it can never contradict the rules. A test checks it in both languages, including just after midnight.

## Internationalisation

- `messages.ts`: `en` is the reference, and `mn` is typed `Record<keyof typeof en, Msg>`, so a missing key fails to compile.
- Messages are strings with `{placeholders}` or functions for plurals and grammar.
- Mongolian phrases use *"subject verb: “thing”"* so quoted task names never need case endings.
- Mongolian dates, times and lists are formatted by hand. Many browsers ship without Mongolian locale data and would fall back to English silently.

## Testing

| Layer | How |
|---|---|
| Algebra | fast-check property tests: lattice laws, inverse laws, composition, normal form, commutation, rebase (400 random histories per law) |
| Workflows | scenario tests in a five-person household: routing, suggestions, four-eyes, stale and satisfied batches, undo conflicts, going back, the last owner |
| Insights | progress, week, story, review notes, trust hint, choices |
| Storage | round trip, invalid and newer data, unavailable storage, two tabs, notifications |
| i18n | completeness, plurals, Mongolian formatting |
| Interface | Playwright on desktop and phone: real flows, keyboard only, two tabs, and axe WCAG 2.1 AA on every screen in light and dark |

## Review

An independent review, by an agent that had not seen the code being written, went looking for ways around the rules and for data loss. It confirmed ten bugs, including an approver undoing accepted suggestions without a second check, a demoted person undoing their old changes, four-eyes bypasses, a remove-and-re-add pair in "go back" that could overwrite a concurrent edit, and three storage races. All are fixed, and each has a regression test in `src/core/__tests__/regressions.test.ts` and `src/store/store.test.ts`.

## Decisions and trade-offs

- **Event log over mutable state**: the history is the product, so the log is the source of truth. Replaying is linear in the log; snapshots can be added if logs grow large.
- **A bitmask for permissions, names in storage**: the algebra becomes bitwise OR/AND (fast, obviously lawful), while stored data stays readable and independent of bit order.
- **One shared suggestion per list**: simplest for an 80-year-old ("2 suggestions waiting"), and it is what makes combining permissions possible. Several named suggestions can come later without changing batches.
- **Rebase by intent, never by guessing**: removal and "make it so" intents adapt; text edits on changed text conflict. Predictable, and it never loses anyone's words.
- **No confirmation dialogs for everyday actions**: every action can be undone, which is kinder than asking "Are you sure?". Only removing a person and starting over ask first.
- **A profile picker instead of sign-in**: a deliberate placeholder for the prototype. The policy layer does not care where the actor id comes from.

## Moving to a server

1. Put `dispatch` behind `POST /lists/:id/commands`. The server loads the log, runs `dispatch`, appends the version in a transaction (`WHERE head = expected`), and returns the outcome.
2. Implement `WorkspaceStore` over that API (plus a change feed for live updates).
3. Take the actor from the session, not the request body.

The core, the interface and the tests stay as they are.
