# The algebra

The brief asked for group theory as the conceptual foundation for roles, but without forcing axioms that do not hold. Two structures fit naturally, and both are used for real in the code, not as decoration:

| Part | Structure | Why it is not a group |
|---|---|---|
| **Permissions** | a bounded distributive lattice; combining is the *join* | the join is idempotent (`a ∨ a = a`), so nothing but the identity has an inverse |
| **History** | a groupoid of states and changes | composing is partial: "remove X" only applies to a state that contains X |

Every law below is checked by property tests on hundreds of random cases (see the table at the end).

---

## 1 · Permissions form a lattice

### Atoms and their order

```
Atoms  A = { suggest:x, do:x  |  x ∈ {add, check, edit, remove} } ∪ { approve, manage }
Order     suggest:x ≤ do:x        (whoever may do something may also propose it)
```

A **permission state** is a set of atoms that is *closed downwards*: if it contains `do:x` it also contains `suggest:x`. Call the set of all such states **L**.

### Operations

| | Definition | Meaning |
|---|---|---|
| join `P ∨ Q` | `P ∪ Q` | combining roles; what a team can do together |
| meet `P ∧ Q` | `P ∩ Q` | what two roles have in common |
| bottom `⊥` | `∅` | "Can look": grants nothing |
| top `⊤` | `A` | "Owner" |
| revoke `P ∖ R` | `P` minus `R` and everything above `R` | taking a right away, consistently |

### Mapping to the brief

| Brief | Here |
|---|---|
| Set *G* | `L`, the closed permission states |
| Binary operation *·* | join `∨` |
| **Closure** | the union of two closed sets is closed: if `do:x ∈ P ∪ Q`, it lies in `P` or `Q`, and that set also holds `suggest:x` |
| **Associativity** | `(P ∨ Q) ∨ R = P ∨ (Q ∨ R)`, and it is also commutative |
| **Identity** *e* | `⊥`: `P ∨ ⊥ = P` |
| **Transformation / reversal** | not an inverse element. `P ∨ Q = ⊥` forces `P = Q = ⊥`. Reversal is `revoke`, a separate operation that also preserves closure: if `do:x` survives, `suggest:x` was not revoked (revoking it would have removed `do:x` too), so it survives as well |

So `(L, ∨, ⊥)` is a commutative idempotent monoid, a join-semilattice with a bottom. With `∧` it is a bounded **distributive lattice**: the down-sets of an order are closed under union and intersection, which makes them a sublattice of the power set.

### Representation

One bit per atom. Join is `|`, meet is `&`. Downward closure is `bits | (doBits >> 4)` and the upward closure used by `revoke` is `bits | (suggestBits << 4)`. Stored data uses atom *names*, so the bit layout can change freely.

### Roles are a chain

```
Can look  <  Can suggest  <  Can change  <  Can approve  <  Owner
   ⊥         all suggest:x    all do:x       + approve        ⊤
```

Anything off the chain is shown as "Own mix" and described in sentences.

### Requirements, routing, teams

For a change set *C*, each change needs one atom: `add → x=add`, …, and people changes need `manage`.

```
need_do(C)      = ∨ { do:x(c)      | c ∈ C }
need_suggest(C) = ∨ { suggest:x(c) | c ∈ C }

route(P, C) = do       if need_do(C) ≤ P
            = suggest  if need_suggest(C) ≤ P      (never for people changes)
            = deny     otherwise, missing = need ∖ P
```

Routing is **monotone**: granting more never makes an action less possible (tested).

A **team's joint ability** is the join of its members: `ability(T) = ∨ perms(p)`. *Can these people prepare C together?* ⇔ `need_suggest(C) ≤ ability(T)`. `smallestTeams` finds the minimal groups that cover a need. On the People page this becomes the "Together" sentence:

> Together, Bat and Bold can add things and tick off. Their suggestions need an OK from Dulmaa or Anu.

This is how the brief's example plays out: *A can edit product info, B can edit pricing; A + B can prepare the update; only C can publish it.* Here A's and B's batches combine into one suggestion that neither could prepare alone, and only someone holding `approve` can publish it.

---

## 2 · History forms a groupoid

### Objects and arrows

- **Objects**: list states (tasks and people).
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

Every change touches exactly one *entity* (one task or one person). Changes to different entities commute, because they read and write disjoint parts of the state. The groupoid therefore splits into a product over entities, and any change set can be regrouped by entity without changing what it does.

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

Text edits and ticks touch different fields of the same task, so they also commute and may merge past each other. Results:

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
| edit, tick or role change whose target state already holds | satisfied: becomes the identity |
| anything else that does not fit | conflict |

If `c` already fits, `rebase` leaves it unchanged in effect (tested). It never guesses what someone meant by words that changed underneath them.

---

## 3 · How the two meet

- Each arrow added to the published path was authorised at the moment it was added: `route(perms(actor), arrow) = do`.
- A **suggestion** is a path that starts from the published state and is assembled from several people's batches. Their joined permissions make the path *preparable*. The approver's `approve` atom makes it part of the published path, under the four-eyes rule.
- **Undo is authorised like any other path**: its inverse is routed by the same rule. The single exception is taking back your own task change. It applies only to changes you made yourself (not by accepting a suggestion), only while you may still make that change, and only while the exact inverse still applies. It never covers people changes, so nobody can undo their way back into a role.
- **Four eyes is checked on the normal form**: every entity in `normalize(accepted changes)` must have been touched by someone other than the approver who is still on the list.
- **Invariants** (someone can always manage, nobody removes themselves) are checked on the resulting state of every version that touches people, whatever path produced it.

---

## Laws and where they are tested

| Law | Test |
|---|---|
| join associative, commutative, idempotent, identity ⊥ | `core/__tests__/permissions.test.ts` → *join is associative…* |
| meet dual, identity ⊤; absorption; distributivity | *meet is the dual…*, *absorbs and distributes…* |
| no inverses | *has no inverses…* |
| closure under ∨, ∧, revoke | *every operation keeps sets closed…* |
| revoke shrinks and removes implicants | *revoke removes the atoms…* |
| role ladder is a chain | *the preset ladder is a chain* |
| routing is monotone | *granting more never makes an action less possible* |
| smallest covering teams | *teams: what people can do together* |
| exact inverse | `core/__tests__/changes.test.ts` → *every change has an exact inverse* |
| involution | *inverting twice gives the same change* |
| composition, anti-homomorphism | *composition is concatenation…* |
| identity | *the empty change set is the identity* |
| commutation / undo of old changes | *an old change can be undone whenever nothing later touched the same thing* |
| normal form: equivalent, idempotent, `A·A⁻¹ ↦ ∅` | *normal form* suite |
| rebase: fitting sets unchanged, intent rules | *rebase* suite |
| invariants on every path | `core/__tests__/workspace.test.ts` → *people and roles* |
| own-undo limits; four eyes on the net effect; remove + re-add normalizes to an edit | `core/__tests__/regressions.test.ts` |
| normal form with items re-added under the same id | the generator in `core/__tests__/gen.ts` re-adds removed tasks and people |
