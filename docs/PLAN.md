# Plan

## The idea

Control is meant to replace the static, manually operated admin panel with something that behaves like a version-control system for business data: changes are proposed, combined, reviewed, approved, published, tracked and undone, under clear permission rules, with analytics built into the work itself.

The fundamental question is not *"what can this user access?"* but *"what can this team accomplish together, and under what controlled conditions?"*

This first mini project proves the model on the smallest useful data set: a to-do list. One constraint drives every decision:

> The end user could be an 80-year-old woman. The logic and architecture must be of high quality; the visible interface must need very few, simple actions.

## Who it is for

A household where the list belongs to **Dulmaa (80)**, and family and a carer help with different levels of trust. The same shape fits a small business (owner, manager, staff, intern) without changing the model.

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

### Also delivered

- English and Mongolian, with Mongolian formatted by hand so every browser shows it correctly.
- Three text sizes, light and dark, WCAG 2.1 AA (axe-clean), keyboard and screen-reader support.
- Multi-tab: two tabs can be two people, and they stay in step.
- Storage that never crashes and never destroys data it cannot read.

## How the brief maps to the build

| Brief | Where it lives |
|---|---|
| Role management as an algebraic model | `core/permissions.ts` (lattice), `core/changes.ts` + `core/changeset.ts` (groupoid), [ALGEBRA.md](ALGEBRA.md) |
| Who can view, edit, publish or approve | Atoms `suggest:*`, `do:*`, `approve`, `manage`; `core/policy.ts` |
| Who can work with whom; combined permissions | Shared suggestions (`core/suggestions.ts`), `teamPerms`, `smallestTeams`, *Together* on People |
| Collaborative data preparation | Batches from several people in one suggestion |
| Edit request → review → approve → publish → track | Suggest → Review sheet → Accept → version → What changed |
| Version-controlled admin | Append-only log, replay, undo, go back, per-task story |
| Compare before and after | Phrases in What changed ("changed X to Y"), review sheet |
| Embedded analytics | `core/insights.ts`, shown in place, never on a separate report page |
| Website editing automation plugin | Not yet: the command layer is the foundation (see Next) |

## Next

1. **Server and sign-in.** Put `dispatch` behind an API (Postgres via Neon is a natural fit). Store the log as rows, use optimistic concurrency on the version number, and replace the "who is using" picker with real sign-in. The core needs no changes.
2. **More than one list, more content types.** Generalise `Task` into typed records (products, prices, banners) with field-level permissions: *Anu may change prices, Bat may change descriptions*. The lattice already supports per-field atoms.
3. **Requests assigned to people.** "Bat, please update these 20 descriptions": a suggestion opened by the approver and assigned to helpers, with a due date.
4. **The editing automation plugin.** Structured requests ("raise all prices in this category by 5%") compile into change sets, then go through the same routing, review and history. The command and change-set layers were built with this in mind.
5. **Deeper analytics.** Sales and conversion data next to product edits, and the predicted effect of a change shown in the review sheet.
