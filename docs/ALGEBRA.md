# The algebra

The brief asked for group theory and combinatorics as the conceptual foundation for roles and tasks, but without forcing axioms that do not hold. Three structures fit naturally, and all three are used for real in the code, not as decoration:

| Part | Structure | Why it is not a group |
|---|---|---|
| **Permissions** | a bounded distributive lattice of down-sets; combining is the *join* | the join is idempotent (`a ∨ a = a`), so nothing but the identity has an inverse |
| **Plans** | a finite partial order on a task's steps | an order is not an operation at all; what it gives is structure: chains, antichains, levels |
| **History** | a groupoid of states and changes | composing is partial: "remove X" only applies to a state that contains X |

Every law below is checked by property tests on hundreds of random cases (see the table at the end).

---

## 1 · Permissions form a lattice

### Atoms and their order

For each action `x ∈ {add, check, edit, remove}` there are four atoms, along two independent axes:

```
level   suggest  <  do        whoever may do something may also propose it
scope   own      <  all       whoever may do it to anything may do it to their own

        suggest:x@own  ≤  do:x@own  ≤  do:x
        suggest:x@own  ≤  suggest:x ≤  do:x
```

*Own* means a task you created, a step in your plan, or (for ticking) a step given to you. Three more atoms:

```
see        see every task, not only your own part
approve    say OK to suggestions                     see ≤ approve
manage     decide who can do what
                                                     see ≤ suggest:x   (acting on anyone's things means seeing them)
```

So there are 19 atoms. A **permission state** is a set of atoms that is *closed downwards* (a down-set): if it contains `do:x` it also contains `suggest:x`, `do:x@own` and `see`. Call the set of all such states **L**.

### Operations

| | Definition | Meaning |
|---|---|---|
| join `P ∨ Q` | `P ∪ Q` | combining roles; what a team can do together |
| meet `P ∧ Q` | `P ∩ Q` | what two roles have in common |
| bottom `⊥` | `∅` | grants nothing, not even seeing |
| top `⊤` | all atoms | "Owner", "Director" |
| revoke `P ∖ R` | `P` minus `R` and everything above `R` | taking a right away, consistently: revoking `see` also takes every anyone's atom and `approve` |

### Mapping to the brief

| Brief | Here |
|---|---|
| Set *G* | `L`, the down-sets of the atom order |
| Binary operation *·* | join `∨` |
| **Closure** | the union of two down-sets is a down-set: anything below an atom of `P ∪ Q` is below an atom of `P` or of `Q`, and that set holds it |
| **Associativity** | `(P ∨ Q) ∨ R = P ∨ (Q ∨ R)`, and it is also commutative |
| **Identity** *e* | `⊥`: `P ∨ ⊥ = P` |
| **Transformation / reversal** | not an inverse element. `P ∨ Q = ⊥` forces `P = Q = ⊥`. Reversal is `revoke`, which removes an up-set, and the complement of an up-set is a down-set, so the result stays closed |

So `(L, ∨, ⊥)` is a commutative idempotent monoid, a join-semilattice with a bottom. With `∧` it is a bounded **distributive lattice**: the down-sets of any finite order are closed under union and intersection, which makes them a sublattice of the power set (Birkhoff's representation theorem says every finite distributive lattice arises this way).

### Representation

One bit per atom. Join is `|`, meet is `&`. Each atom's down-set and up-set are precomputed as masks from the covering relation, so closing a set is OR-ing the down-set masks of its bits, and `revoke` is AND-ing out the up-set masks. Stored data uses atom *names*, so the bit layout can change freely.

### Roles are chains

Each standard's ladder is a chain in `L`: every rung is the one below joined with more atoms.

```
Home     Can look  <  Can suggest  <  Can change  <  Can approve  <  Owner
         see          suggest:x       do:x           + approve        ⊤

School   Parent       <  Student             <  Teacher                     <  Manager     <  Director
         do:check@own    + suggest:add@own      do:x@own, suggest:x            do:x,          ⊤
                                                (so see), approve              approve
```

Below *Teacher* nobody holds `see`: students and parents see only their part (section 2).

Anything off the chain is shown as "Own mix" and described in sentences. For ready-made plans, which ask for "a teacher", `rankOf(P)` is the **floor of P in the chain**: the highest rung `r` with `r ≤ P`. A teacher given one extra right is still a teacher.

### Requirements, routing, teams

For a change set *C*, each change needs one atom, and its scope depends on whose thing it touches (`scopeOf`): `do:add@own` to add a step to your own plan, `do:check@own` to tick a step given to you, `do:edit` to change someone else's task. People changes need `manage`.

```
need_do(C)      = ∨ { do:x(c)@scope(c)      | c ∈ C }
need_suggest(C) = ∨ { suggest:x(c)@scope(c) | c ∈ C }

route(P, C) = do       if need_do(C) ≤ P
            = suggest  if need_suggest(C) ≤ P      (never for people changes)
            = deny     otherwise, missing = need ∖ P
```

The scope is read from the state as `C` walks forward, so the steps of a plan you are creating count as your own. Routing is **monotone**: granting more never makes an action less possible (tested).

A **team's joint ability** is the join of its members: `ability(T) = ∨ perms(p)`. *Can these people prepare C together?* ⇔ `need_suggest(C) ≤ ability(T)`. `smallestTeams` finds the minimal groups that cover a need. On the People page this becomes the "Together" sentence:

> Together, Bat and Bold can add things and tick off. Their suggestions need an OK from Dulmaa or Anu.

This is how the brief's example plays out: *A can edit product info, B can edit pricing; A + B can prepare the update; only C can publish it.* Here A's and B's batches combine into one suggestion that neither could prepare alone, and only someone holding `approve` can publish it.

---

## 2 · Plans are partial orders

### Steps and waits

A task can be broken into steps, and a step can wait for other steps of the same task. As long as the waits never go round in a circle, they generate a **strict partial order**: `a < b` when `b` waits for `a`, directly or through other steps. Two steps that are not ordered either way are *independent*: they can be done at the same time, by different people.

The question the brief asks, *how do we keep paths short and avoid being dragged out by dependencies?*, has exact answers in the combinatorics of finite orders.

| Notion | Definition | In the product |
|---|---|---|
| **chain** | steps that are pairwise ordered | a line of waits: one after the other |
| **antichain** | steps that are pairwise independent | things that can happen at the same time |
| **level** | 0 for a step that waits for nothing, else 1 + the highest level it waits for | the step's **round** |
| **height** | the length of the longest chain | the number of rounds |
| **width** | the size of the largest antichain | the most steps in progress at once |
| **minimal elements** of what is left | undone steps whose waits are all done | *Now*, *Your next steps* |
| **down-set** | a set that contains everything below its members | the done steps |

### The facts used

- **Rounds are antichains.** Steps on the same level never wait for each other (if `a < b` then `level(a) < level(b)`), so each round can be done all at once. The rounds partition the plan.
- **Mirsky's theorem**: the minimum number of antichains that cover an order equals its height. The levels are one such cover, so **the number of rounds is the longest chain of waits, and no schedule with any number of people finishes in fewer rounds.** It is the shortest path through the plan. The interface says it as *"At the same time: 5 rounds instead of 10."*
- **Dilworth's theorem**: the maximum size of an antichain equals the minimum number of chains that cover the order. It is computed through **König's theorem**: in the bipartite graph with an edge `u → v` whenever `u < v`, the minimum chain cover has `n − |maximum matching|` chains. A maximum matching is found with augmenting paths (Kuhn), and a largest antichain is read off a minimum vertex cover. This is *"up to 5 at the same time"*.
- **Minimal elements form an antichain**, so everything in *Your next steps* can be done in any order or together.
- **Foata normal form.** In the language of traces, independent steps commute: every order of doing the steps that respects the waits is the same trace. Its Cartier–Foata normal form, which puts each step in the block right after the last block holding a step it depends on, is exactly the rounds (tested on random orders).
- **A wait's cost** is `height(with it) − height(without it)`. A new wait is free when it fits in the slack and costs a round when it lengthens the longest chain. The interface says *"Waiting for it adds a round"* while you build the plan. This is what "minimal dependencies accelerate the work" means in numbers.

### The rules a plan keeps

Checked on the result of every version and every suggestion (`planProblem`):

1. every step belongs to a task that exists
2. a step only waits for steps of the same task
3. the waits are acyclic, so they really form a partial order
4. **the done steps form a down-set**: a done step never waits for an undone one. You can't finish a step before what it waits for, and you can't untick a step while something after it is done.

They are rules about several steps at once, so no single change checks them: each change touches one entity, which is what keeps changes to different things commuting (section 3). Versions check them, whatever path produced the version.

### Changing a plan without breaking it

- **Adding a wait** that would close a circle is refused (`wouldCycle`: `b` may wait for `a` only if `b` is not already below `a`).
- **Removing a step** passes its waits on: whoever waited for it now waits for what it waited for, adding only links that aren't already implied. The order on the remaining steps is then **exactly the old order restricted to them** (tested): nothing can start earlier than before, and nothing waits longer.
- **Ready-made plans** use *each* steps: one template step becomes one copy per student, and anything that waited for it waits for every copy. The copies are an antichain, so a class revises side by side and the plan gets wider, not longer.

### Who sees what

A person without `see` sees their own steps and their direct **neighbours**: the steps their steps wait for, and the steps that wait for theirs, as the plan links them. For those neighbours, "waits for" lists only visible steps and counts the rest. The plan-wide numbers that would describe hidden steps (width, longest chain) are withheld.

---

## 3 · History forms a groupoid

### Objects and arrows

- **Objects**: list states (tasks, steps and people).
- **Arrows**: a change `c : s → t` exists when applying `c` to `s` gives `t`. Each change records the *before* it expects, so it is an arrow from one specific state, not a blind overwrite.

| Law | Statement |
|---|---|
| Composition | change sets are words; `A · B : s → u` when `A : s → t` and `B : t → u` |
| Associativity | concatenation |
| Identity | the empty change set at every state |
| Inverse | `c⁻¹ : t → s`; for sets `(A)⁻¹` = inverses in reverse order; `apply(apply(s, A), A⁻¹) = s` |
| Involution | `(A⁻¹)⁻¹ = A` |
| Anti-homomorphism | `(A · B)⁻¹ = B⁻¹ · A⁻¹` |

A category in which every arrow is invertible is a **groupoid**: "a group with many objects". It is not a group because composition is only defined when the end of one arrow is the start of the next.

**In product terms:**

- The **version log** is a path from the empty state. The current state is where the path ends. `stateAt(n)` is a point on it.
- **Undo** a version: follow its inverse arrow from where you are now.
- **Go back** to version n: follow the inverse of the whole path since n.
- Both are appended as new arrows, so the path only grows. Nothing is ever erased.

### Commutation and the normal form

Every change touches exactly one *entity* (one task, one step or one person). Changes to different entities commute, because they read and write disjoint parts of the state. The groupoid therefore splits into a product over entities, and any change set can be regrouped by entity without changing what it does.

Inside one entity, `normalize` reduces the sequence like a word in a free group (`c · c⁻¹ = 1`), with merge rules for the obvious combinations:

```
add(t) · edit(t.text → y)       = add(t with text y)
edit(a → b) · edit(b → c)       = edit(a → c)            (and a → a disappears)
edit(a → b) · remove(t:b)       = remove(t:a)
check(a → b) · check(b → c)     = check(a → c)
remove(t) · add(t)              = 1
remove(t) · add(t′)             = edit(t.text → t′.text) · check(t.done → t′.done)    (same task, put back differently)
```

The last rule matters for safety as well as for brevity. A task taken away and put back with other words *is* an edit. Kept as remove + add, a later rebase would remove whatever the task says now and put the old words back, silently overwriting someone else's edit. As an edit, it conflicts the way an edit should.

**Steps** have four fields that change independently: words, done, who does it, and what it waits for. The same rules apply field by field (`assign(a → b) · assign(b → c) = assign(a → c)`, a step added and then edited is added edited), and changes to different fields of the same step commute and may merge past each other, as text edits and ticks do on a task.

Results:

- `normalize(A)` applies wherever `A` applies, with the same result
- `normalize` is idempotent and never longer than its input
- `normalize(A · A⁻¹) = ∅`

That is why "go back to Monday" can show and publish a short, readable change ("bring back 2, remove 1") rather than a replay of every step since.

**Undoing an old change** follows from commutation: if nothing after `c` touched `c`'s entity, then applying `c⁻¹` now gives exactly the history without `c` (tested).

### Partiality as safety: conflicts and rebasing

Because arrows start at specific states, a change that no longer fits is a **conflict**, never a silent overwrite ("Can't do that: Anu changed it later"). For suggestions evaluated later than they were made, `rebase(s, c)` adapts a change *by intent only*:

| Change | Adapted how |
|---|---|
| remove | removes the thing as it is now |
| edit, tick, assignment, waits or role change whose target state already holds | satisfied: becomes the identity |
| a step tick | "make it so": ticks the step as it is now |
| anything else that does not fit | conflict |

If `c` already fits, `rebase` leaves it unchanged in effect (tested). It never guesses what someone meant by words that changed underneath them.

---

## 4 · How the three meet

- Each arrow added to the published path was authorised at the moment it was added: `route(perms(actor), arrow) = do`, with the scope read from the state the arrow starts at.
- Each published state satisfies the plan rules: the arrow is checked where it ends, whatever produced it.
- A **suggestion** is a path that starts from the published state and is assembled from several people's batches. Their joined permissions make the path *preparable*. The approver's `approve` atom makes it part of the published path, under the four-eyes rule.
- **Undo is authorised like any other path**: its inverse is routed by the same rule. The single exception is taking back your own task or step change. It applies only to changes you made yourself (not by accepting a suggestion), only while you may still make that change, and only while the exact inverse still applies. It never covers people changes, so nobody can undo their way back into a role.
- **Four eyes is checked on the normal form**: every entity in `normalize(accepted changes)` must have been touched by someone other than the approver who is still on the list, and when the approver contributed too, the normal form must equal that of the others' changes alone.
- **Invariants** on people (someone can always manage, nobody removes themselves, names stay unique) are checked on the resulting state of every version that touches people, whatever path produced it.

---

## Laws and where they are tested

| Law | Test |
|---|---|
| join associative, commutative, idempotent, identity ⊥ | `core/__tests__/permissions.test.ts` → *join is associative…* |
| meet dual, identity ⊤; absorption; distributivity | *meet is the dual…*, *absorbs and distributes…* |
| no inverses | *has no inverses…* |
| closure under ∨, ∧, revoke | *every operation keeps sets closed downwards* |
| the atom order: do ⇒ suggest, all ⇒ own, acting on all ⇒ see | *follows the order of the atoms…* |
| revoke removes up-sets and only shrinks | *revoke removes the atoms and everything implying them…* |
| each ladder is a chain; floor in the chain | *each ladder is a chain*, *finds the highest rung someone holds…* |
| setting one level for one scope stays a down-set | *sets one action level for one scope…*, *raising "anyone's" raises "own"…* |
| routing by scope; a new plan's steps are the owner's own | *routes by what the action needs, and whose thing it is*, *counts a new plan's steps as the owner's own* |
| routing is monotone | *granting more never makes an action less possible* |
| smallest covering teams | *teams: what people can do together* |
| rounds are an antichain partition | `core/__tests__/poset.test.ts` → *partition the steps into antichains…* |
| number of rounds = longest chain (Mirsky) | *number exactly the longest chain of waits (Mirsky)…* |
| rounds = Foata normal form | *are the Foata normal form of every order that respects the waits* |
| width = largest antichain (Dilworth, König) | *equals the largest antichain (Dilworth)…* |
| done steps form a down-set; ready steps an antichain | *done steps taken in any respectful order always form a down-set…* |
| removing a step keeps the restricted order | *taking a step out keeps the order among the rest exactly as it was* |
| wait cost | *a wait costs rounds only when it lengthens the longest chain* |
| plan rules under any sequence of actions | `core/__tests__/plans.test.ts` → *keeps every plan sound for any mix of people and actions* |
| exact inverse | `core/__tests__/changes.test.ts` → *every change has an exact inverse* |
| involution | *inverting twice gives the same change* |
| composition, anti-homomorphism | *composition is concatenation…* |
| identity | *the empty change set is the identity* |
| commutation / undo of old changes | *an old change can be undone whenever nothing later touched the same thing* |
| normal form: equivalent, idempotent, `A·A⁻¹ ↦ ∅` | *normal form* suite |
| rebase: fitting sets unchanged, intent rules | *rebase* suite |
| invariants on every path | `core/__tests__/workspace.test.ts` → *people and roles* |
| own-undo limits; four eyes on the net effect; remove + re-add normalizes to an edit | `core/__tests__/regressions.test.ts` |
| four eyes with steps; who sees what in every view | `core/__tests__/school-regressions.test.ts` |
| normal form with items re-added under the same id | the generator in `core/__tests__/gen.ts` re-adds removed tasks, steps and people |
