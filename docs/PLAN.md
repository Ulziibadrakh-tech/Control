# Plan

## The idea

Control is meant to replace the static, manually operated admin panel with something that behaves like a version-control system for business data: changes are proposed, combined, reviewed, approved, published, tracked and undone, under clear permission rules, with analytics built into the work itself.

The fundamental question is not *"what can this user access?"* but *"what can this team accomplish together, and under what controlled conditions?"*

This first mini project proves the model on the smallest useful data set: a to-do list. One constraint drives every decision:

> The end user could be an 80-year-old woman. The logic and architecture must be of high quality; the visible interface must need very few, simple actions.

## Who it is for

- **A school (K-12)**, the default. A director, a manager, teachers, students and parents work on shared plans: an exam week, homework, a field trip. Real work has dependencies, so tasks can be broken into steps from the start, and the plan is shaped so as many steps as possible run at the same time.
- **A household**, the original example. The list belongs to **Dulmaa (80)**, and family and a carer help with different levels of trust.

The same model fits a small business (owner, manager, staff, intern) without changes.

## Milestones

### M1 · Todo with two side options ✅

- **Write**: one field, one button.
- **Choose**: twelve ready-made tiles in a fixed order (spatial memory matters more than ranking). Things written by hand more than once get tiles of their own.
- Tick, change words, remove. Every action shows a message with Undo.
- Done items tidy themselves away the next day.
- Duplicate protection, so a double tap adds once.

### M2 · Version control ✅

- Every change is a version in an append-only log, with author, time and cause.
- **What changed**: the history in plain sentences, grouped by day.
- **Undo** any version, which publishes its exact inverse. **Go back** to any moment, which publishes the inverse of everything since. Both are new versions, so both can be undone.
- Conflicts are explained, never overwritten ("Can't do that: Anu changed it later").
- **Its story**: the history of a single task.

### M3 · Roles, collaboration, embedded analytics ✅

- Permissions as a lattice: *suggest* and *do* levels for each action (add, tick, change words, remove), plus *approve* and *manage*.
- Five-step role ladder, plus Fine-tune.
- **Routing**: the same tap is published, suggested or refused depending on the person, and buttons say which ("Add to the list" or "Suggest adding").
- **Suggestions**: one shared suggestion per list. Batches from different people combine. Approve all, decline all, or leave parts out. Four-eyes rule. Rebased automatically when the list changes.
- **People**: roles in sentences, activity this week, the trust hint, and **Together** (what a team can do jointly, and who must approve the rest).
- **Embedded analytics**: progress in the list header, the week chart in What changed, a task's age and story, a suggestion's impact and context, the trust hint in People, and "often" marks in Choose.
- Safety rules: someone must always be able to manage people, nobody can remove themselves, and people changes are versioned and undoable like everything else.

### M4 · K-12 school standard ✅

- **Two standards**: school (the default) and home, each with its own role ladder and sample history. *Settings → Start over with an example* switches; `?example=home` starts with the household.
- **School roles**: *Parent < Student < Teacher < Manager < Director*, a chain in the lattice. Rights now have a scope, *own* (a task you created, a step in your plan or given to you) or *anyone's*, and a new `see` right. People without `see` see only their own part.
- **Breaking a task down when it is created**: Write → *Break it into steps*. Each step has a person and the steps it waits for. The shape is shown live (steps, rounds, how many can start now, "at the same time: 2 rounds instead of 3"), with the cost of each wait and no way to make a circle.
- **Ready-made plans** in Choose: six school plans built with as few waits as the work allows. Each step asks for a role; people are filled in, and *every student* steps fan out into one step per student, done side by side.
- **Plans are partial orders** (`core/poset.ts`): rounds are the levels, their number is the longest chain of waits (Mirsky), the most steps at once is the width (Dilworth, via matching), the ready steps are an antichain. "N rounds to go" and "Now: …" come from the part of the plan that is left.
- **Doing the steps**: *Your next steps* at the top of the list, the plan as rounds (Done, Now, Later), hourglasses on steps that still wait, groups of chips for "every student" steps. A task with steps is done when its last step is.
- **Strict control**: the plan rules (no circles, waits stay inside the plan, a done step never waits for an undone one) hold on every published state and every suggestion. Students see their steps and the ones right next to them; everything else is a count. Changes to a step from an old screen are refused. Removing a step passes its waits on, so nothing starts earlier than it could before.
- **Data**: stored format version 2 with a migration from version 1 (everyone keeps seeing what they saw).
- **Verified**: an independent review of the new rules (ten findings and a four-eyes gap, all fixed with regression tests), a fuzz test over random school histories, and browser tests including a student's partial view.

### Also delivered

- English and Mongolian, with Mongolian formatted by hand so every browser shows it correctly.
- Three text sizes, light and dark, WCAG 2.1 AA (axe-clean), keyboard and screen-reader support.
- Multi-tab: two tabs can be two people, and they stay in step.
- Storage that never crashes and never destroys data it cannot read.
- A `vercel.json` for deploying the static build, with strict security headers.

## How the brief maps to the build

| Brief | Where it lives |
|---|---|
| Role management as an algebraic model | `core/permissions.ts` (lattice of down-sets), `core/changes.ts` + `core/changeset.ts` (groupoid), [ALGEBRA.md](ALGEBRA.md) |
| School roles: director, manager, teacher, student, parent | `LADDERS.school` in `core/permissions.ts`; `rankOf` finds someone's rung even with extra rights |
| Who can view, edit, publish or approve | Atoms `suggest:*`, `do:*` (each for own or anyone's), `see`, `approve`, `manage`; `core/policy.ts` |
| Tasks with complex dependencies | Steps with "waits for" links (`Step.after`), checked as a partial order (`core/plan.ts`) |
| Break a task down from the start; do several things at once | Write → *Break it into steps*, ready-made plans, rounds (`core/poset.ts`) |
| Short paths, minimal dependencies | Rounds = longest chain (Mirsky), width (Dilworth), "waiting for it adds a round", plans built with as few waits as possible |
| Strict control | Plan invariants on every version, scoped rights, who-sees-what (`visibleSteps`, `planFor`, `changeVisibleTo`), refusals that reveal nothing |
| Who can work with whom; combined permissions | Shared suggestions (`core/suggestions.ts`), `teamPerms`, `smallestTeams`, *Together* on People |
| Collaborative data preparation | Batches from several people in one suggestion |
| Edit request → review → approve → publish → track | Suggest → Review sheet → Accept → version → What changed |
| Version-controlled admin | Append-only log, replay, undo, go back, per-task story |
| Compare before and after | Phrases in What changed ("changed X to Y"), review sheet |
| Embedded analytics | `core/insights.ts`, plan shapes and progress, shown in place, never on a separate report page |
| Website editing automation plugin | Not yet: the command layer is the foundation (see Next) |

## Next

1. **Server and sign-in.** This matters most for the school, where many people share one list from their own devices. Put `dispatch` behind an API (Postgres via Neon is a natural fit), store the log as rows, use optimistic concurrency on the version number, and replace the "who is using" picker with real sign-in. Who-sees-what then also applies to what the server sends. The core needs no changes.
2. **Classes and groups.** "Every student" means every student today. Classes (7A, 7B) as groups, so a plan can say "every student in 7A", and teachers see the classes they teach.
3. **Due dates and time.** Rounds say what can happen in parallel; dates would say when. The longest chain is already the critical path, so a plan can show which steps decide the finish date.
4. **More content types.** Generalise `Task` into typed records (products, prices, banners) with field-level permissions: *Anu may change prices, Bat may change descriptions*. The lattice already supports per-field atoms.
5. **The editing automation plugin.** Structured requests ("raise all prices in this category by 5%") compile into change sets, then go through the same routing, review and history. The command and change-set layers were built with this in mind.
6. **Deeper analytics.** Sales and conversion data next to product edits, and the predicted effect of a change shown in the review sheet.
