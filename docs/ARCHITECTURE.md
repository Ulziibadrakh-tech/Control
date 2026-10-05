# Architecture

## Principles

1. **The interface never changes data.** It sends commands to one function, `dispatch`, and shows the outcome.
2. **History is stored, state is not.** The current list is the replay of an append-only log. History, undo, "go back" and the audit trail all come from that single rule.
3. **Rules live in one place.** Permissions, routing, plan rules, visibility and conflict handling are pure functions in `src/core`, tested without a browser.
4. **Every refusal has a reason code.** The core returns `{ code: 'conflict', laterBy, … }`, never a sentence. Words live in `src/i18n`, in two languages.
5. **A pure core and a thin shell.** The core has no React, no DOM and no clock of its own. Time and ids are injected (`Env`), so tests and the sample histories are deterministic.

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│ app/  React interface                                         │
│   Home (Write · Choose · next steps · list) · plan and step   │
│   sheets · What changed · People                              │
│   useRun(cmd) → toast with Undo         words.ts → sentences  │
├───────────────────────────────────────────────────────────────┤
│ i18n/ English · Mongolian (typed: a missing key won't compile)│
├───────────────────────────────────────────────────────────────┤
│ store/ WorkspaceStore port ── localStore adapter              │
│        versioned schema · decode · migrate · sample histories │
├───────────────────────────────────────────────────────────────┤
│ core/  pure TypeScript                                        │
│   permissions (lattice) · changes/changeset (groupoid)        │
│   poset (partial orders) · plan (rules, shape, who sees what) │
│   history (log, replay) · suggestions (batches, evaluation)   │
│   policy (routing) · workspace (dispatch) · view · insights   │
│   catalog (tiles, ready-made plans) · describe (phrases)      │
└───────────────────────────────────────────────────────────────┘
```

Dependencies only point downwards. `core` imports nothing from the others.

## The life of a tap

Saraa (who may only suggest) taps **Choose → Drink water** in the household:

```
ChoosePanel ── run({ type: 'add', text: 'Drink water' })
  useRun ── store.transact(ws =>
      dispatch(ws, saraa, cmd, env)
        ├─ actor on the list?                      else refused: not-a-member
        ├─ text clean, not too long, not a duplicate she can see?
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
  ├─ has 'approve'?  four eyes on the net effect (see below)
  ├─ evaluation: each pending batch rebased onto the current state, in order
  └─ publish one version  { by: dulmaa, cause: { type: 'suggestion', contributors: [saraa, bat] } }
```

At school, Anu (a student) ticks **Revise** under *Your next steps*:

```
dispatch(ws, anu, { type: 'checkStep', id, done: true })
  ├─ the step is given to her  →  scope 'own'  →  needs do:check@own, which she has
  ├─ build { op: 'step.check', id, from: false, to: true }
  └─ publish: plan rules on the result (a done step may not wait for an undone one)
React re-renders: the ring moves on, "Hold the exam" stops waiting for her
```

## Data model

```ts
Task      { id, text, done, createdAt, createdBy }
Step      { id, task, n, text, who, after: StepId[], done, createdAt, createdBy }
Person    { id, name, hue, perms }                       // perms: a down-set of atoms
State     { tasks, steps, people }                       // maps; no stored order

Change    task.add(task) | task.remove(task) | task.edit(id, from, to) | task.check(id, from, to)
        | step.add(step) | step.remove(step) | step.edit | step.check | step.assign | step.deps   (id, from, to)
        | person.add(person) | person.remove(person) | person.perms(id, from, to)

Version   { n, at, by, changes: Change[], cause }
          cause: setup | direct | undo(of n) | restore(to n) | suggestion(id, contributors)

Suggestion { id, openedAt, batches: Batch[], resolution: null | accepted | declined | withdrawn }
Batch      { id, by, at, changes, origin: action | undo | restore,
             status: pending | withdrawn | declined | applied | skipped }

WorkspaceData { standard: 'school' | 'home', log, suggestions, … }
```

Every change carries the *before* it expects as well as the *after*, so every change has an exact inverse and a change never applies silently to the wrong state.

**Steps** belong to one task and wait for other steps of the same task (`after`). A step's number `n` is a stable label ("step 3"), never reused, not even after a removal or by a step still waiting in a suggestion. A task with steps is done when all its steps are done; it cannot be ticked as a whole. Removing a task removes its steps in the same version, so undo brings the whole plan back.

Each change touches exactly one entity (a task, a step or a person). That is what makes changes to different things commute (see [ALGEBRA.md](ALGEBRA.md)), and it is why plan rules are never checked on single changes.

Tasks have no stored position. Order is derived (`createdAt`), so no change depends on an index, and undo always puts a task back exactly as it was.

## Routing policy (`core/policy.ts`)

For the changes an action would make, compute what they require as a lattice element and compare it with the person's permissions:

| Requirement covered at… | Result |
|---|---|
| `do` level | published directly, as a new version |
| `suggest` level | added as a batch to the shared suggestion |
| neither | refused, naming the missing atoms |

What a change requires depends on **whose thing it touches** (`scopeOf`):

| Change | Counts as *own* when… |
|---|---|
| a task (add, remove, change words, tick) | you created the task |
| adding or removing a step; a step's words, person or waits | the task is your plan |
| ticking a step | the step is given to you, or the task is your plan |

*Own* changes need the `@own` atom, anything else the anyone's atom. Ownership is read from the state as the change set walks forward, so the steps of a plan you are creating count as your own. People changes need `manage` and can never be suggested.

Doers act on the published list. People who may only suggest act on the preview (the list as it would look after the open suggestion), so they can build on their own waiting ideas. When the two disagree about whose thing it is, the cautious answer wins: a disagreement can turn a change into a suggestion or a refusal, never into a direct publish.

**Undo is not a special power.** Undoing a version is its inverse change set, routed by the same rule: a helper's undo becomes a suggestion. The one exception (`POLICY.ownUndo`) lets people take back their own action without the inverse right ("I added it, I can take it back"), and only when all four of these hold:

- they made the change themselves, not by accepting someone else's suggestion
- it touched only tasks and steps, never roles
- they are *still* allowed to make that change today, so someone turned into "Can look" can change nothing
- nobody has touched those things since, so the exact inverse still applies

Undo and go back are also refused, before any rebasing, when the versions involved touch something the person can't see, so a refusal never describes it.

**Four eyes is judged on the net effect.** Every thing that accepting would actually change must have been touched by someone else who is still on the list (`acceptance()`, used by both `dispatch` and the interface). Suggestions that cancel each other out do not count as a second pair of eyes. And when the approver has batches of their own in the suggestion, accepting must publish exactly what the others suggested: Saraa changing a step's words does not let an approver slip their own change to who does it past review.

**Changes carry what they were based on.** The task, step and role sheets send `from` with every change that replaces a value: the words, who does a step, what it waits for, or the role on screen. If someone changed it in the meantime, the change is refused with "Someone changed this while you were looking".

## Plans (`core/poset.ts`, `core/plan.ts`)

A task's steps and their waits form a partial order. Everything the interface says about a plan is computed from it:

| Shown as | Computed by |
|---|---|
| Round 1, 2, 3… | `levels`: 0 for a step that waits for nothing, otherwise one more than the highest round it waits for |
| "10 steps in 5 rounds" | `height`, the longest chain of waits (Mirsky): no schedule is shorter |
| "up to 5 at the same time" | `width`, the largest set of steps that don't wait for each other (Dilworth), via a maximum matching |
| "Longest chain of waits: …" | `longestChain`, the critical path |
| Now, hourglass, "Your next steps" | `ready`: undone steps whose waits are all done |
| "3 rounds to go" | the height of `remaining`, the undone part of the plan |
| "Waiting for it adds a round" | `waitCost`: the height with the wait minus the height without |
| a chip that can't be chosen | `wouldCycle` |

**Plan rules** (`planProblem`) are checked on the result of every version and every suggestion, never on single changes:

1. every step belongs to a task that exists
2. a step only waits for other steps of the same task
3. the waits never go round in a circle
4. a done step never waits for an undone one, so the done steps always form a down-set of the plan

`publish` checks them whatever the path (a direct change, undo, go back, accepting), and `evaluate` marks a waiting suggestion as out of date when it would break them. Commands check them early too, so the refusal can say why ("That would make steps wait for each other in a circle", "“Book the rooms” is done, so it can’t wait for “Print the papers”").

**Removing a step** passes its waits on (`withoutStep`): whoever waited for it now waits for what it waited for, adding only links that aren't already implied. The order among the remaining steps stays exactly what it was, so nothing can start earlier than before.

**Ready-made plans** (`catalog.ts`) ask for a role per step. `planDraft` fills in the people whose rung is that role (`rankOf`), and an *each* step becomes one step per person, with whatever waited for it waiting for all of the copies.

## Who sees what

People with `see` see everything, and so does the owner of a plan. Everyone else (at school, students and parents) sees:

- the tasks they created or have a step in (`canSeeTask`)
- in those, their own steps and the steps right next to them: what their steps wait for, and the steps that wait for theirs (`visibleSteps`)

`planFor` builds the plan as the person may see it. Hidden steps are left out, each "waits for" list names only visible steps and counts the rest (`hiddenWaits`, shown as "and 2 other steps"), and the plan-wide numbers that would describe hidden steps (width, longest chain) are withheld.

The same rule runs through every way information could leak, each with a test:

- the list rows and the notes on them about waiting suggestions (`listView`)
- What changed: only the changes this person may see, and the version data that comes with them carries only those (`timeline`, `changeVisibleTo`). A removed thing is judged from history: a removed task by who made it, a removed step by who it was given to
- the week chart and progress (`week`, `progress` take the viewer, and it is required)
- refusals: undo and go back of versions touching unseen things are refused with "not allowed" before anything is compared, and the duplicate check only looks at tasks the person can see
- someone who is no longer on the list gets empty views

## Suggestions and rebasing

A suggestion is never rebased by hand. Each time it is looked at, `evaluate()` takes its pending batches in order and rebases each one onto the current state:

- a **remove** removes the thing as it is now (ticked or renamed since, it still goes)
- an **edit**, **tick**, **assignment**, **waits** or **role change** whose target state is already true is *satisfied* and dropped
- a step **tick** is "make it so": it adapts to the step as it is now
- anything else that no longer fits makes the batch **stale**. It is shown as "No longer possible" and skipped
- a batch whose result would break a plan rule is stale too

The preview state (published plus valid batches) is what people who suggest see and act on. A helper can build on their own pending addition: add "Kefir", then change it to "Kefir, 2 litres".

**Leaving takes your suggestions with you.** After any version, the waiting batches of everyone no longer on the list are withdrawn, whether they were removed or their joining was undone. Nobody counts as a second pair of eyes after leaving.

## Undo and going back

- **Undo version n**: `normalize(invert(v.changes))`. The strict inverse goes first (needed for the own-undo exception), then a rebased version. Conflicts name the first later version that touched the thing.
- **Go back to version n**: the normalized inverse of every *task and step* change after n. People are left alone. It applies by construction, since it is the inverse path in the groupoid. The plan rules are still checked on the result.
- Both publish new versions (`cause: undo | restore`), so both can be undone.

## Storage (`store/`)

- **Port** (`store.ts`): `get`, `subscribe`, `transact(fn)`, `replace`, `sync`, `status`. A server adapter would implement `transact` with optimistic concurrency on `rev`.
- **localStorage adapter** (`localStore.ts`):
  - probes storage. If it is missing or blocked (private mode), it runs in memory and says so in Settings
  - unreadable data is **copied aside** (`…unreadable.<time>`) before starting fresh
  - data from a **newer schema** is left untouched and never overwritten
  - **multi-tab**: every save also writes a unique token. Before each write the store compares tokens, not counters, and reloads first if another tab saved, so a write always starts from the newest copy and two tabs can never both think they are newest. The `storage` event triggers `sync()` in the other tabs
  - **failed saves** (storage full): the change stays in memory and Settings says changes are not being saved. The next successful save writes everything, and nothing is reloaded over unsaved work
- **Stored format** (`schema.ts`): versioned (`schema: 2`, key `control.workspace.v2`), permissions stored as readable atom names, a strict decoder that reports *where* data is wrong. `migrate()` turns version 1 into version 2: no steps yet, the home standard, and `see` added to everyone so they keep seeing what they saw.
- **Sample histories** (`seed.ts`): the school and the household, both built by running real commands through the real `dispatch`, so they can never contradict the rules. Tests check them in both languages, including just after midnight.

## Internationalisation

- `messages.ts`: `en` is the reference, and `mn` is typed `Record<keyof typeof en, Msg>`, so a missing key fails to compile.
- Messages are strings with `{placeholders}` or functions for plurals and grammar.
- Mongolian phrases use *"subject verb: “thing”"* so quoted task names never need case endings.
- Mongolian dates, times and lists are formatted by hand. Many browsers ship without Mongolian locale data and would fall back to English silently.

## Testing

| Layer | How |
|---|---|
| Algebra | fast-check property tests: lattice laws, the atom order, inverse laws, composition, normal form, commutation, rebase (hundreds of random cases per law) |
| Partial orders | rounds are antichains and number the longest chain (Mirsky); width equals the largest antichain (Dilworth); rounds are the Foata normal form; done steps form a down-set; removing a step keeps the order; wait costs |
| Plans | breaking down at creation, ready-made plans in both languages, ticking order, removing and undoing, who sees what, and a fuzz test: random school histories with every role, plan rules checked after every action |
| Workflows | scenario tests in a household and a school: routing, suggestions, four eyes, stale and satisfied batches, undo conflicts, going back, the last owner |
| Insights | progress, week, story, review notes, trust hint, choices |
| Storage | round trip, invalid and newer data, migration from version 1, unavailable storage, two tabs, notifications |
| i18n | completeness, plurals, Mongolian formatting |
| Interface | Playwright on desktop and phone: real flows, plans, a student's partial view, keyboard only, two tabs, and axe WCAG 2.1 AA on every screen in light and dark |

## Reviews

Two independent reviews, each by an agent that had not seen the code being written, went looking for ways around the rules.

- **The household version**: ten bugs, including an approver undoing accepted suggestions without a second check, a demoted person undoing their old changes, four-eyes bypasses, a remove-and-re-add pair in "go back" that could overwrite a concurrent edit, and three storage races.
- **Plans and school roles**: no way around the permission rules and no broken plan in 2,500 random school histories (about 150,000 commands), checked by an independent checker. It confirmed ten smaller bugs, mostly a student seeing a little too much (step names in the history, notes, plans and refusals), changes to a step from an old screen overwriting newer ones, suggestions surviving an undone joining, reused step numbers, and a gap in four eyes for steps.

All are fixed, and each has a regression test in `src/core/__tests__/regressions.test.ts`, `school-regressions.test.ts` and `src/store/store.test.ts`.

## Decisions and trade-offs

- **Event log over mutable state**: the history is the product, so the log is the source of truth. Replaying is linear in the log; snapshots can be added if logs grow large.
- **A bitmask for permissions, names in storage**: the algebra becomes bitwise OR/AND with precomputed down-set and up-set masks, while stored data stays readable and independent of bit order.
- **Plan rules per version, not per change**: single changes stay entity-local, so they commute and undo stays simple. Rules that span several steps (circles, order) are checked where a version is formed.
- **Rounds, not dates**: the levels of the partial order say what can happen at the same time without anyone entering a date. They are the shortest possible path, and they stay true whoever does the work.
- **Neighbours visible, the rest counted**: a student needs to know who they wait for and who waits for them, nothing more. Counting the rest keeps "waits for" honest without naming anything.
- **One shared suggestion per list**: simplest for an 80-year-old ("2 suggestions waiting"), and it is what makes combining permissions possible. Several named suggestions can come later without changing batches.
- **Rebase by intent, never by guessing**: removal and "make it so" intents adapt; text edits on changed text conflict. Predictable, and it never loses anyone's words.
- **No confirmation dialogs for everyday actions**: every action can be undone, which is kinder than asking "Are you sure?". Only removing a person and starting over ask first.
- **A profile picker instead of sign-in**: a deliberate placeholder for the prototype. The policy layer does not care where the actor id comes from.

## Moving to a server

1. Put `dispatch` behind `POST /lists/:id/commands`. The server loads the log, runs `dispatch`, appends the version in a transaction (`WHERE head = expected`), and returns the outcome.
2. Implement `WorkspaceStore` over that API (plus a change feed for live updates). Send each person only what `listView`, `timeline` and `planFor` give them, so who-sees-what holds on the wire too.
3. Take the actor from the session, not the request body.

The core, the interface and the tests stay as they are.
