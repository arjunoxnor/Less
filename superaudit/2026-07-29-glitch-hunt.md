# Glitch hunt: 2026-07-29

## Why this exists

LESS is live at less.oxnorhub.com with a real writer's real scripts in it.
On 2026-07-29 Arjun sent the app to a friend. The friend found a visible
formatting glitch **within seconds**, by doing nothing stranger than holding
Tab on a blank page. Arjun's instruction: assume people use this in ways the
builder did not, and make it flawless in the corners.

The standard for this pass: a first-time user hammering the keyboard on a
blank document, and a writer with 32 scripts in 14 folders dragging things
around, must not be able to produce a wrong-looking or wrong-behaving result.

## Frozen contracts (do not touch)

- `functions/api/**` and `migrations/**`: the live backend. No changes.
- Every existing localStorage key shape. Additive optional fields only.
- ProseMirror document schema: one `screenplayLine` node with an `element`
  attribute. Do not add node types.

## Two confirmed bugs, with root causes already located

### BUG 1: an empty transition line shows left-aligned "CUT TO:"

**Reproduce:** open a brand-new empty screenplay. Press Tab five times to
cycle `scene_heading -> action -> character -> dialogue -> parenthetical ->
transition`. The line now reads `CUT TO:` sitting at the LEFT margin, and a
suggestion popup (CUT TO: / DISSOLVE TO: / SMASH CUT TO:) opens off to the
right, detached from the text. A transition must be right-aligned. It looks
like the app formatted a transition wrongly.

**Root cause A, verified by reading the code, still worth confirming:**
the text is not real. It is the empty-line placeholder. `placeholderFor()` in
`lib/editor/buildExtensions.ts:25` returns `"CUT TO:"` for a transition, and
`app/globals.css` renders placeholders with:

```css
.sp-prose .is-empty::before {
  content: attr(data-placeholder);
  ...
  float: left;      /* <- this is the bug */
}
```

`float: left` pins the placeholder to the left edge regardless of the line's
own `text-align`. `.sp-transition` is `text-align: right`, and
`.sp-scene_heading` / `.sp-character` carry left indents, so the placeholder
disagrees with the real caret position on every element that is not plain
action. The caret sits where the text will actually go; the hint sits at the
left margin. That mismatch is what reads as a glitch.

Fix so the placeholder always sits exactly where typed text will appear, on
every one of the six elements. Do not reach for `float` alone: verify against
`scene_heading`, `character`, `parenthetical`, `dialogue` and `transition`,
each of which has different margins, indents and alignment. Check the caret
does not jump when the first character is typed.

**Root cause B:** `computeTransition()` in `lib/editor/autocomplete.ts:222`
deliberately opens the menu with all seeded transitions when the line is
empty. Combined with the misplaced placeholder this produces a popup that
looks unmoored. Decide whether a menu should open on a line the writer has
not typed into at all, in particular when the transition was reached by Tab
cycling rather than by the Enter flow. Arjun's read is that it should not:
Tab is for choosing a format, not for being offered content. Whatever you
decide, the popup must be anchored to the caret it belongs to.

### BUG 2: irregular paragraph spacing in a plain document

**Reproduce:** open a DOCUMENT (not a screenplay) with several paragraphs of
notes. Gaps between paragraphs are visibly uneven: some pairs are tight,
others have a wide gap. Screenshot evidence shows a wide gap after the first
paragraph, then three tight lines, then a wide gap again, in one document the
writer typed normally.

Suspicion, to verify rather than assume: Enter and Shift+Enter produce
different node structures (separate paragraphs vs hard breaks inside one
paragraph) that look identical while typing but space differently, and
`.pl-prose` margins compound with `:first-child` / adjacent-sibling rules.
Look at `components/PlainBody.tsx`, `lib/editor/buildPlainExtensions.ts` and
the `.pl-prose` block in `app/globals.css`.

Make the rhythm uniform and predictable: the same visible gap between any two
paragraphs, regardless of how the writer got there, with no double margin at
the top or after headings/lists.

## Then hunt for the rest

Read the actual code paths. Do not speculate. Priority order:

1. **Every keyboard path in `lib/editor/keymap.ts`.** Tab, Shift+Tab, Enter,
   Backspace at line start, Mod+1..6, Escape. Each one against: an empty
   line, the very first line, the last line, a range selection spanning
   several lines, a line inside a dual-dialogue cluster, and with the
   autocomplete menu open. Hold Tab through the full cycle repeatedly and
   confirm nothing accumulates or is lost.
2. **`lib/editor/autocomplete.ts`.** Stale menu after the document changes
   under it; Enter/Tab/Escape while open; the menu opening on lines the
   writer never typed in; a menu positioned outside the viewport; accepting
   an item whose text no longer matches the line.
3. **The plain editor.** Toolbar buttons against a range selection and an
   empty document, Markdown-ish input rules firing where they should not,
   Backspace at the start of a list item.
4. **The home (`components/ProjectsHome.tsx`, `lib/storage/library.ts`).**
   Drop a row on itself; drop while a rename input is open; drag a folder
   into its own descendant; release outside every target; reorder a
   single-item list; delete a folder mid-drag; fold state naming folders that
   no longer exist; rename to empty or whitespace; create while a drag is in
   flight.
5. **Undo integrity.** After every automatic conversion (AutoCaps,
   AutoElement, the Enter flow, autocomplete acceptance), one Cmd+Z must undo
   one writer-visible action, and must never leave a phantom state. There is
   an existing suite at `lib/editor/undoIntegrity.test.ts`: extend it.
6. **Export (`lib/export/**`).** An empty document; a document that is one
   blank line; dual dialogue; a speech long enough to split across pages; a
   transition as the last line of a page; a title page with empty fields;
   characters with accents and apostrophes.

## Definition of done

- Every bug found is fixed, or explicitly reported as found-and-not-fixed
  with the reason.
- Every fix has a regression test where the logic is testable. Editor tests
  use the headless kit; follow the existing patterns in `lib/editor/*.test.ts`
  and `lib/storage/*.test.ts`. A test must fail before the fix and pass after.
- The gate passes: `npx tsc --noEmit && npm test && npm run build`.
- A report at `superaudit/2026-07-29-glitch-hunt-report.md`, one entry per
  bug: what it is, exact reproduction steps, the root cause in file:line
  terms, the fix, and the test that pins it. Rank by how likely a real writer
  is to hit it.

## House style

No em dashes, no emojis, no exclamation marks, in code comments, copy, or the
report. Comments explain why, not what. Match the surrounding code's voice.

---

## BUG 3 (added mid-run): a parenthetical does not bring its own parentheses

Reported by Arjun on 2026-07-29, after the two above. This is standard
behaviour in Final Draft, Arc Studio and Celtx, and LESS does not do it.

**Reproduce:** type a character cue, press Enter, then Tab (or Mod+5) to make
the line a parenthetical. Type `quietly`. The line reads `quietly`. It should
read `(quietly)`. Today the writer has to type both brackets by hand on every
single parenthetical.

**This is also an output bug, not only a convenience one.** `lib/export/
fountain.ts:77` has `ensureParens()` and wraps parenthetical text on the way
out. The PDF path does not: `lib/export/pdf.ts` and `lib/export/paginate.ts`
never add brackets. So a parenthetical stored without brackets exports as
`(quietly)` to Fountain and as a bare `quietly` in the PDF, which is simply
wrong screenplay format in the deliverable that matters most.

**Required behaviour:**

1. Setting a line to `parenthetical` inserts the brackets and puts the caret
   between them, so the writer types straight into `(|)`. This must hold for
   every route to that element: Tab cycle forward, Shift+Tab backward, Mod+5,
   and the Enter flow from a character cue.
2. If the line already holds text, wrap it rather than prepending: `quietly`
   becomes `(quietly)` with the caret before the closing bracket.
3. Never double-wrap. `(quietly)` stays `(quietly)`. A line that already opens
   with `(` and closes with `)` is left alone.
4. Typing, and pressing End, must keep the closing bracket last. The writer
   must not be able to end up with `(quietly` or `(quietly))` by normal typing.
5. A parenthetical that still reads `()` counts as EMPTY for every existing
   empty-line rule, in particular the Enter-on-an-empty-line conversion in
   `lib/editor/keymap.ts`, so an abandoned parenthetical never leaves `()`
   litter in the script. The same applies to the placeholder logic and to
   whether the autocomplete menu treats the line as blank.
6. One undo step removes the whole automatic insertion, not one bracket at a
   time. Extend `lib/editor/undoIntegrity.test.ts`.
7. Make the PDF path tolerant of parentheticals stored without brackets, the
   way Fountain already is, so scripts written before this change and scripts
   imported from elsewhere still print correctly. Fountain's `ensureParens` is
   idempotent, so nothing double-wraps once the editor starts storing them.

**Tests required:** each of the four routes to a parenthetical; wrapping
existing text; the no-double-wrap case; Enter on a `()` line; the single-undo
case; and an export test proving a bracket-less stored parenthetical renders
with brackets in both the PDF line data and the Fountain output.
