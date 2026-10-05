# Design

## Who it is for

An 80-year-old woman, on a tablet or a phone. She may have reading glasses, a slight tremor in her hands, and little patience for app conventions, and she is wary of breaking something. If it works for her, it works for everyone.

At school the same bar holds: a grandparent ticking a trip slip, a ten-year-old ticking homework, a teacher between lessons. Plans add structure underneath, never more to learn on top. A student who opens the app sees their next steps and taps one.

## Eleven rules

1. **Very few actions on screen.** Home has Write, Choose, the circles, and Look when a suggestion is waiting. Everything else is one step away. At school, breaking a task down is one folded button under the field, and a plan opens from its row.
2. **Words, not just icons.** Every button has a text label. Icons only support the words.
3. **Undo instead of "Are you sure?".** Every action can be taken back from the message that appears, and later from What changed. Only removing a person and starting over ask first.
4. **Buttons say what will happen.** "Add to the list" or "Suggest adding"; "Undo" or "Suggest undoing". The label comes from the same policy that will decide.
5. **Nothing moves by itself.** Choose tiles keep their places, because people find buttons by where they were last time. What history teaches shows up as an "Often" mark and as tiles added at the end, never as reordering.
6. **Big and calm.** Touch targets around 58 px and never under 44 px. Text 18 px or more and never under 16 px; tasks at 23 px. Three text sizes.
7. **Plain words.** "Suggestion", "What changed", "Can look", "Waits for", "Round 2", "Now". Never "branch", "commit", "changeset", "RBAC", "dependency" or "DAG".
8. **Forgive mistakes.** A double tap adds once and ticks once, and a second tap on a message that has only just appeared is ignored, so a double tap on Undo can't land on Redo. Duplicates are explained next to the field. Conflicts are explained in a sentence ("Anu changed it later").
9. **Messages wait.** They stay ten seconds and pause while hovered or focused.
10. **Respect the device.** Light or dark from the system, reduced motion, browser zoom, screen readers, keyboard.
11. **Plans read as rounds, not as diagrams.** A plan is a list of rounds (Done, Now, Later), not boxes and arrows: rounds answer "what can be done now?" without any diagram-reading. The shape is said in one line ("10 steps in 5 rounds · up to 5 at the same time"), and while building, the cost of a wait is said the moment it is chosen ("Waiting for it adds a round").

## The look: soft Swiss

**Swiss:** a strict grid, flush-left type, a strong hierarchy, generous white space, a few hard rules (2 px ink lines under the header and section titles) and one accent colour.

**Softened:** warm paper instead of white, rounded corners (12 / 16 / 24 px), one rounded typeface, and shadows only on things that float (sheets, toasts).

### Typeface

**Nunito** (variable, self-hosted): soft round terminals and a generous x-height, with full Cyrillic coverage including Mongolian **Ө** and **Ү**. One family everywhere, in weights from 580 (body) to 900 (numbers).

### Grid

| Screen | Layout |
|---|---|
| ≥ 960 px | two columns: side options (19–25 rem) and the list (up to 50 rem), 3 rem apart |
| < 960 px | one column; Write and Choose become a fixed bottom bar; sheets slide up from the bottom |

### Type scale (1 rem = 18 px at Normal size; Large = 20 px, Largest = 23 px)

| Use | Size | Weight |
|---|---|---|
| Greeting | 1.85–2.7 rem (fluid) | 850 |
| Page and section titles | 1.65–2.1 rem | 870–880 |
| Task text | 1.3 rem | 720 |
| Body | 1 rem | 580 |
| Smallest anything | 0.9 rem (16 px) | 700+ |

### Colour

Colour has meaning and is never the only signal; there is always a word or an icon too.

| Meaning | Light | Dark |
|---|---|---|
| **Do / done** (accent) | `#1c6450` | `#73cba9` |
| **Waiting for an OK** | `#7e4c00` on `#fcefd6` | `#f2c46e` on `#3a2d14` |
| **Remove** (used sparingly) | `#a33a2f` | `#f29a8f` |
| Ink · secondary · faint | `#1d2421` · `#48514c` · `#5f6964` | `#f2eee7` · `#c7cdc9` · `#a3aca7` |
| Paper · surface | `#f6f2ea` · `#ffffff` | `#141917` · `#1d2321` |

Contrast, measured:

| Pair | Light | Dark |
|---|---|---|
| Ink on paper | 14.2 : 1 | 15.4 : 1 |
| Secondary text on paper | 7.4 : 1 | 11.0 : 1 |
| Faintest text (done items) on paper | 5.1 : 1 | 6.9 : 1 |
| Button text on accent | 7.0 : 1 | 8.8 : 1 |
| Waiting text on its background | 6.3 : 1 | 8.2 : 1 |
| Control outlines (circles, fields) | 3.6–4.0 : 1 | 3.9–4.4 : 1 |

### Components

- **Segmented control**: Write / Choose, text size, language, No / Suggest / Yes. The selected option is raised, with a 2 px accent ring.
- **Tick**: a 56 px target with a 3 px ring. It fills green with a check and a small pop. A dashed amber ring with an hourglass means waiting.
- **Row**: a card with the tick, the text (and any waiting note), and Take back when it is yours.
- **Tile**: icon, words, and "On the list" or "Often".
- **Banner**: amber, the suggesters' faces, one sentence, and **Look**.
- **Sheet**: the native `<dialog>`; centred on wide screens, a bottom sheet on phones. Always a labelled **Close** button.
- **Toast**: dark, one line, one action (Undo / Redo / Take back).

Plans add a few more, built from the same parts:

- **Next steps**: a short list of ticks at the top of the list, each with the plan it belongs to ("In “Exam week”"), then a quiet line for the rest ("2 more of your steps wait for others first").
- **Ring**: on a plan's row, the share of steps done, with the count inside ("6/10"). The row's second line says how many rounds are left and who can act now.
- **Round**: a heading, a status pill (Done, **Now** in the accent colour, Later) and a rule down the left that turns accent while the round is going.
- **Step row**: a slightly smaller tick (3 rem, 54 px at Normal size), the words, a face and a name, and what it still waits for. A step that waits has a dashed ring with an hourglass instead of a tick, so it can't be ticked by accident.
- **Group row**: one step for many people ("Revise · 2 of 3 done") with a chip per person to tick their own.
- **Wait chips**: in the step editor, numbered chips for "waits for"; pressed chips fill with the accent. A chip that would close a circle is dashed and disabled, with the reason as its title.
- **Shape line**: a pale accent panel under the steps being written: "3 steps · 2 rounds · 2 can start now", and "At the same time: 2 rounds instead of 3".

### Motion

Movement only explains a change: the tick pops, a new row gets a fading ring, sheets slide up, toasts rise. Durations are 150–280 ms, and all of it is switched off under reduced motion.

## Writing

- Short sentences. Verbs first. Everyday words.
- Talk about the person's list and the person's people. Nothing about the system.
- Errors say what happened and what to do: "“Call Anu” is already on the list."
- **Mongolian**: phrases follow *subject verb: “thing”* ("Ану нэмсэн: “Талх авах”"), so quoted task names and names never need case endings. Lists of people use "нар" ("Сараа, Бат нар"). Dates are written the everyday way ("Даваа, 10-р сарын 5"), on a 24-hour clock.

## Accessibility, checked

- **axe-core WCAG 2.1 A/AA**: no violations on any screen (home, review, settings, What changed, People, welcome, and at school the plan sheet, the step sheet, Write with steps, ready-made plans and a plan preview), in light and dark, on desktop and phone (`e2e/a11y.spec.ts`).
- **Keyboard**: arrow keys move between Write and Choose; Enter adds; Space ticks; Escape closes a sheet and focus returns to whatever opened it. On every page change, focus moves to the page title.
- **Screen readers**: each tick is a checkbox named after its task or step (a chip in a group is named "Revise: Nomin"); messages are a polite live region; sheets are labelled dialogs; rounds are a list with headings; the progress bar has values and each ring a label ("6 of 10 steps done"); each day in the chart has a label.
- **Forced colours** (Windows high contrast): borders stay visible.
- **Text size**: rem-based throughout, so the in-app setting and browser zoom both scale the whole layout. Checked up to Largest on a 390 px phone.
