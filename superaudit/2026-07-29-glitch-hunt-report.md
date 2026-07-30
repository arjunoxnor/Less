# Glitch hunt report: 2026-07-29

## Result

The two confirmed bugs are fixed. The priority areas in the brief were traced
through their production code paths and covered with regressions. Ten
additional interaction or export bugs and one offline build blocker were found
and fixed.

The frozen contracts were respected:

- No file under `functions/api/` changed.
- No file under `migrations/` changed.
- No existing localStorage key changed shape.
- No ProseMirror node type was added.

Final gate:

```text
npx tsc --noEmit && npm test && npm run build

TypeScript: passed
Tests: 18 files, 167 tests passed
Production build: passed
```

## Fixed bugs, ranked by likelihood

### 1. Very high: screenplay placeholders disagree with the real text position

Reproduction:

1. Open an empty screenplay.
2. Press Tab through Scene heading, Action, Character, Dialogue,
   Parenthetical, and Transition.
3. Compare each placeholder with the caret position. The Transition
   placeholder appears on the left even though typed text is right-aligned.
   Indented elements show the same placeholder and caret disagreement.

Root cause:

`app/globals.css:448-455` floated every empty-line pseudo-element left.
The float ignored the parent line's content alignment. The six parent line
styles at `app/globals.css:393-423` use different margins and, for Transition,
right alignment.

Fix:

The placeholder is now a zero-height block inside the line's own content box
and inherits `text-align`. Character, Dialogue, and Parenthetical therefore use
their parent indents, Transition uses the right edge, and the pseudo-element
does not occupy caret space when the first character is typed.

Regression:

`lib/editor/editorStyles.test.ts:14-19`,
`screenplay placeholders inherit the line box alignment without floating`.

### 2. Very high: choosing an empty format opens an unmoored autocomplete menu

Reproduction:

1. Open an empty screenplay.
2. Press Tab until the line becomes Transition or Character.
3. Before typing, observe a suggestion menu for seeded transitions or the
   existing cast.
4. Continue pressing Tab. The menu can take ownership of the next Tab instead
   of allowing a clean element cycle.

Root cause:

`lib/editor/autocomplete.ts:187-220` treated an empty Character or Transition
query as sufficient to open content suggestions. The plugin also treated any
`docChanged` transaction as typing, even when Tab or Mod-number changed only
the line's `element` attribute at `lib/editor/autocomplete.ts:500-523`.

Fix:

Empty Character and Transition queries now stay closed. Attribute-only
transactions close autocomplete instead of recomputing it. Suggestions still
open as soon as the writer types a matching query. Rendered-menu ownership for
Enter, Tab, Shift+Tab, and Escape remains intact.

Regression:

- `lib/editor/autocomplete.test.ts:96-117`, empty retype and attribute-only cases.
- `lib/editor/autocomplete.test.ts:190-250`, rendered keyboard ownership.
- `lib/editor/keymap.test.ts:26-43`, repeated empty-line Tab cycle.

### 3. Very high: plain-document paragraph gaps depend on Enter versus Shift+Enter

Reproduction:

1. Open a plain Document.
2. Type several note lines, using Enter between some and Shift+Enter between
   others.
3. The Enter lines are separate paragraphs with a bottom margin. The
   Shift+Enter lines are hard breaks inside one paragraph with no paragraph
   gap.
4. Put paragraphs in a list and observe the broad paragraph margin compound
   with list spacing.

Root cause:

StarterKit's default Shift+Enter command created a `hardBreak` in
`lib/editor/buildPlainExtensions.ts`. The CSS rule at the old
`app/globals.css:2087` applied paragraph spacing to every paragraph, including
nested list paragraphs, while hard breaks received none.

Fix:

`lib/editor/buildPlainExtensions.ts:12-34` maps Shift+Enter to `splitBlock` for
top-level paragraphs and headings. Nested list, quote, and code contexts retain
their normal soft-break behavior. `app/globals.css:2088-2112` gives the visible
gap only to top-level paragraphs, resets nested paragraph margins, and removes
extra top and bottom margins at document edges.

Regression:

- `lib/editor/plainEditor.test.ts:37-70`, top-level and nested Shift+Enter.
- `lib/editor/editorStyles.test.ts:20-24`, top-level margin contract.
- `lib/editor/plainEditor.test.ts:73-130`, range formatting, empty formatting,
  code input rules, and list Backspace.

### 4. High: a full Tab cycle permanently uppercases Action text

Reproduction:

1. Type `Sentence case.` on an Action line.
2. Press Tab six times to cycle through all element types and return to Action.
3. The old AutoCaps pass uppercases the existing text while the line briefly
   has Character, Scene heading, or Transition formatting.
4. The line returns to Action as `SENTENCE CASE.`.

Root cause:

`lib/editor/autoCaps.ts:31-68` scanned every uppercase element after every
document-changing transaction. `setNodeMarkup` changes the document even when
only the `element` attribute changes, so formatting shortcuts were mistaken
for text input.

Fix:

`lib/editor/autoCaps.ts:34-43` ignores transactions whose document text is
unchanged. Actual typing and paste changes still run AutoCaps.

Regression:

`lib/editor/keymap.test.ts:45-58`,
`a full Tab cycle does not uppercase action text`.

### 5. High in large libraries: no-op and self-drops can mutate placement

Reproduction:

1. Drag a project onto the folder it already belongs to.
2. Its folder setter runs anyway, stamping its placement clock.
3. For top-level folders, drag across another heading, return to the original
   heading, and release.
4. The previous hover's reorder caret can still be applied to the self-drop.

Root cause:

`components/ProjectsHome.tsx` previously called the project or folder placement
handler without comparing the current destination. The heading drop path also
read `caretRef.current` before rejecting a self-drop.

Fix:

`components/ProjectsHome.tsx:435-448` skips writes when the destination is
unchanged. `components/ProjectsHome.tsx:494-509` rejects a folder self-drop
before consulting the reorder caret. `lib/storage/library.ts:117-135` provides
a shared no-op-safe reorder calculation.

Regression:

- `components/ProjectsHome.test.tsx:124-139`, stale heading target.
- `components/ProjectsHome.test.tsx:141-156`, project dropped on current folder.
- `lib/storage/library.test.ts:263-274`, self and single-item reorder cases.

### 6. High in large libraries: deleting a drag source or target leaves actionable stale state

Reproduction:

1. Start dragging a project or folder.
2. Delete the source or destination from another state update or tab before
   releasing.
3. Release over the stale target.
4. The old path can call a placement handler with an id that no longer exists.

Root cause:

The drag ref outlived the rendered entity, and `canDropOn` checked only whether
a drag ref existed.

Fix:

`components/ProjectsHome.tsx:414-432` clears a drag whose source disappears and
validates both source and target before a drop. The pure guards are at
`lib/storage/library.ts:70-101`.

Regression:

`lib/storage/library.test.ts:250-261`, deleted folder, project, and target
cases.

### 7. High: dragging from a rename field starts the enclosing row drag

Reproduction:

1. Begin renaming a project or folder.
2. Select text in the rename input with a pointer drag.
3. The draggable ancestor can start moving the whole row instead of selecting
   the name.

Root cause:

Every row and folder container was `draggable`, and its `onDragStart` accepted
events originating from nested inputs and buttons.

Fix:

`components/ProjectsHome.tsx:540-556` rejects drag starts from interactive
controls through `lib/storage/libraryInteraction.ts`.

Regression:

`lib/storage/libraryInteraction.test.ts:6-20`.

### 8. Medium-high: creating during a drag leaves the old drag active

Reproduction:

1. Start dragging a folder.
2. Trigger creation through the available keyboard or create control before
   the native drag lifecycle finishes.
3. The new object appears while the old row remains marked as the active drag,
   allowing later hover or drop state to act on it.

Root cause:

Creation flows did not clear `drag.current`, `caretRef.current`, or their visual
state.

Fix:

All creation and quick-jot flows clear drag state before writing at
`components/ProjectsHome.tsx:646-700`.

Regression:

`components/ProjectsHome.test.tsx:109-122`.

### 9. Medium-high: fold state accumulates deleted folder ids

Reproduction:

1. Fold several folders.
2. Delete or sync-delete those folders.
3. Inspect `less:home:folds:v1`. Deleted ids remain forever.

Root cause:

The home loaded and appended fold entries but never reconciled the record with
the live folder list.

Fix:

`lib/storage/library.ts:103-115` prunes unknown and malformed entries.
`components/ProjectsHome.tsx:299-336` persists the pruned record after folder
hydration. The hydration guard is important because the initial empty array
from `useProjects` is not a confirmed empty library.

Regression:

- `lib/storage/library.test.ts:276-283`, stale entry pruning.
- `components/ProjectsHome.test.tsx:101-107`, initial hydration preservation.

### 10. Medium: the Move to dialog omits orphaned and cyclic folders

Reproduction:

1. Load a synced library containing an orphaned parent id or a parent cycle.
2. The main library safely hoists those folders and shows them.
3. Open Move to. The old recursive target builder starts only at
   `parentId === undefined`, so the same visible folders are absent.

Root cause:

The Move to target builder in `components/ProjectsHome.tsx` used a separate,
non-cycle-safe tree walk instead of the library's normalized child index.

Fix:

`lib/storage/library.ts:191-208` now builds every move target from the same
cycle-safe index used by the visible library.
`components/ProjectsHome.tsx:750-755` consumes that selector.

Regression:

`lib/storage/library.test.ts:285-296`.

### 11. Medium: autocomplete candidates stay stale after the outline catches up

Reproduction:

1. Open a Character or location autocomplete menu.
2. Change the document so the cast or location outline changes.
3. The autocomplete transaction recomputes immediately against the previous
   debounced outline.
4. When `useOutline` finishes 120 ms later, no editor transaction refreshes the
   open menu, so obsolete candidates remain selectable.

Root cause:

The outline ref update at `components/ScreenplayBody.tsx:299-303` was not
connected to autocomplete plugin state.

Fix:

`lib/editor/autocomplete.ts:464-475` adds a history-free rescan for an already
open menu. The outline effect invokes it. A dismissed menu remains dismissed,
so delayed outline work cannot recreate the caret-arrival trap.

Regression:

`lib/editor/autocomplete.test.ts:158-187`.

### 12. Medium on small windows: autocomplete can still extend above or beyond the viewport

Reproduction:

1. Open autocomplete in a short viewport or with an on-screen keyboard.
2. Put the caret near the bottom so the menu flips above.
3. If the full menu does not fit above either, its computed `top` is negative.
   A viewport narrower than the fixed minimum width can also overflow.

Root cause:

`components/AutocompleteMenu.tsx` flipped vertically and clamped the right
edge, but it did not clamp the resulting top or handle a viewport smaller than
the menu's fixed minimum dimensions.

Fix:

`lib/editor/autocompletePosition.ts:12-30` clamps both axes after choosing
above or below. `app/globals.css:901-905` bounds menu dimensions by the current
viewport.

Regression:

`lib/editor/autocompletePosition.test.ts:4-25`.

### 13. Medium: LESS FDX title pages collapse on round-trip

Reproduction:

1. Fill Title, Credit, Author, Source, Draft date, Contact, and Copyright.
2. Export FDX.
3. Import that FDX back into LESS.
4. The first line becomes Title and most remaining lines collapse into Contact.

Root cause:

`lib/export/fdx.ts` exported visually formatted but unlabeled title-page
paragraphs. The fallback importer at `lib/export/fdx.ts:93-136` had no field
identity to recover.

Fix:

`lib/export/fdx.ts:225-240` writes a non-printing `LESSField` attribute on each
title paragraph. The parser reads it and joins repeated Contact lines. Visible
title-page text remains unchanged, and untagged external FDX files retain the
existing heuristic.

Regression:

`lib/export/exportEdges.test.ts:71-87`.

### 14. Build gate: production compilation required network access

Reproduction:

1. Run `npm run build` without network access.
2. Next.js attempts to download Courier Prime, Montserrat, and Jost from Google
   Fonts.
3. Turbopack fails before producing the app.

Root cause:

`app/layout.tsx` used `next/font/google` even though Courier Prime is already
vendored in `public/fonts`.

Fix:

`app/layout.tsx:1-35` loads the four vendored Courier Prime faces through
`next/font/local`. `app/tokens.css` supplies local/system fallbacks for the two
optional plain-document lookalikes. The production build is now offline-safe.

Regression:

The required production build is the regression gate. It failed before this
change and passes after it.

## Audited paths with no additional defect

- Enter on empty and non-empty lines, including first, last, range selection,
  and dual-dialogue cases.
- Backspace at the first screenplay line and between adjacent Action lines.
- Mod+1 through Mod+6 over caret and range selections.
- Autocomplete acceptance after its line stops matching. The stale acceptance
  is rejected without changing text.
- Plain-editor marks on ranges and empty paragraphs.
- Markdown input rules inside code blocks.
- Backspace at the start of an empty list item.
- Folder-to-descendant drops and release outside a target.
- Whitespace-only renames. Existing call sites correctly keep the prior name.
- Empty and one-blank-line exports, dual dialogue, long speech continuation,
  a Transition on the final printable row, empty title fields, and accented or
  apostrophized character names.
- One-step undo for AutoCaps, AutoElement, empty-line Enter conversion, and
  autocomplete acceptance with Enter flow.

## Found but not fixed

None. Every real interaction or export defect found in the scoped paths was
fixed and given regression coverage.

## Added mid-run: BUG 3

### 15. High: a parenthetical does not bring its own parentheses

Reproduction:

1. Type a character cue and press Enter.
2. Press Tab or Mod+5 to make the dialogue line a Parenthetical.
3. Type `quietly`.
4. The stored line and PDF output read `quietly` instead of `(quietly)`.

Root cause:

`setElement` at `lib/editor/screenplayLine.ts:114-150` previously changed only
the line attribute. It supplied neither the punctuation nor a caret position.
The empty-line branch at `lib/editor/keymap.ts:61-70` recognized only
whitespace, so an automatic `()` pair would not have participated in the
existing empty-line flow. Fountain had a private output repair, while
`docToLines` and `paginate` passed bracket-less Parenthetical text through to
the PDF draw operations.

Fix:

`lib/editor/screenplayLine.ts:152-203` now wraps text in the same transaction
that changes the element and places a caret before the close. It records only
editor-added punctuation in ephemeral plugin state, so a full Tab cycle can
remove that formatting punctuation without removing parentheses the writer
already supplied. No ProseMirror node or stored attribute was added.

`lib/editor/parenthetical.ts:16-193` supplies the shared empty and wrapping
rules, protects the closing bracket during typing, End, Backspace, and Delete,
and renders the Parenthetical placeholder between an untouched pair.
`lib/editor/keymap.ts:64-95` treats `()` as empty and removes it during the
existing in-place Enter conversion.

`lib/export/flatten.ts:55-94` supplies missing punctuation on the read-only
document export bridge. `lib/export/paginate.ts:175-188` applies the same
idempotent tolerance to callers that already hold flat line data, and Fountain
uses the shared helper. Old and imported bracket-less Parentheticals therefore
print correctly without rewriting storage.

Required behavior coverage:

1. Tab, Shift+Tab, Mod+5, and the character-cue Enter-then-Tab flow insert `()`
   with the caret between the brackets.
2. Existing text is wrapped and the caret lands before the close.
3. Already wrapped text is not wrapped again.
4. Typing, End, Backspace, and Delete preserve one final closing bracket.
5. `()` is empty for Enter, placeholder, autocomplete, and lossless Tab-cycle
   behavior.
6. One undo removes the element change and both inserted brackets.
7. Bracket-less stored text is corrected in PDF line data and Fountain output.

Regression:

- `lib/editor/keymap.test.ts:67-215`
- `lib/editor/enterFlow.test.ts:61-70`
- `lib/editor/undoIntegrity.test.ts:122-140`
- `lib/editor/autocomplete.test.ts:239-248`
- `lib/export/exportEdges.test.ts:98-112`

Gate:

`npx tsc --noEmit` passes. `npm test` passes all 180 tests in 18 files.
`npm run build` reaches Next.js compilation, then fails because the sandbox
cannot fetch Montserrat and Jost through `next/font/google`. The font setup was
left unchanged as required.
