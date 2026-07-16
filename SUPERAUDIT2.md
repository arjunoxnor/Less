# LESS Superaudit 2: the UX teardown. 2026-07-16

Run on Claude Fable 5, single-threaded, line-level. Focus, per Arjun: user
experience and UI above all. The bar: the polish and joy of Arc Studio or
Celtx, without becoming complicated or obtrusive. Everything was on the table,
including a from-scratch rebuild.

Method: read all ~19k lines of source (every component, every stylesheet line,
the editor core, storage/sync, cloud, export, the API), then drove the live
site cold in a fresh browser profile: first visit, project creation, a typed
scene, autocomplete, undo, dark mode, focus mode, panels, palette. The prior
superaudit (2026-07-01, 58 findings) is carried as context; its verified fixes
are not re-litigated. This report is a proposal only. Nothing was changed.
The app is LIVE at less.oxnorhub.com with real user data (Arjun's scripts),
so every fix below must land migration-safe: nothing here requires a data
migration, but the executor must treat localStorage shapes and the D1 API as
frozen contracts.

---

## The verdict

**Keep the engine. Rebuild the shell. Fix five real bugs first.**

- The document engine is genuinely good and does not need a rebuild: the
  one-node schema, the Enter/Tab flow, SmartType, the pagination engine, the
  import/export stack, the per-field-clock sync. I typed a scene cold on the
  live site and the core writing loop already feels professional. The 2026-07
  audit hardened the data layer; the tests exist; the API is sound.
- The interface layer is where the Arc gap lives, and it is past patching. It
  accreted across ten phases: three stacked toolbars with ~24 equal-weight
  chips, four generations of dashboard CSS in one file, thirteen ad-hoc font
  sizes, nine border radii, zero motion, a bootstrap-blue accent that fights
  both the paper metaphor and the stated taste ("no brand color, typography
  over color"). No amount of chip-shuffling gets to Arc; the shell needs to be
  rebuilt on a designed system. The engine underneath it does not move.
- The live pass also surfaced real correctness bugs that no visual redesign
  fixes: undo can produce text that was never typed; focus mode is broken; the
  most natural keystroke pattern litters the document with empty lines; and a
  session expiry can silently wipe local copies. These are Tier 0, before or
  alongside the shell work.

One sentence: the product's skeleton is right, its muscles work, and it is
wearing the wrong clothes badly; also its Cmd+Z sometimes lies.

---

## Part 1: Ranked teardown findings

Format per finding: what is there / why it is wrong / the specifically better
version. B = bug, D = design. Ranked by (user harm x frequency).

### B1. Undo produces document states that never existed

**What is there.** Document-mutating auto-behaviors are hidden from the undo
history. `autoElement.ts:70` marks its element conversion `addToHistory:
false`; `autoCaps.ts` marks its uppercase rewrite `addToHistory: false` (the
comment says "fold into the same undo step", which is not what that meta does;
it makes the change invisible to history, not grouped). The autocomplete
accept plus my Enter-flow chain dispatches two separate transactions
(`autocomplete.ts` accept, then `runEnterFlow`).

**Why it is wrong.** Verified live: type a cue via autocomplete (`an` →
ANNA), Enter, Enter, type `int. b` (auto-converts to a scene heading), then
press Cmd+Z three times. The document lands on `character | "ANINT. B"`: five
lines, a cue containing text from two different lines, a state that never
existed at any point. When history cannot see some rewrites, its inverse steps
apply against a document that has drifted, and undo composes garbage. For a
writer, Cmd+Z is a covenant. Breaking it is disqualifying, and it is the kind
of bug that makes a person distrust the whole product.

**The better version.**
- Remove `addToHistory: false` from every transaction that changes document
  text or node attrs that affect meaning: `autoElement.ts:70`, the AutoCaps
  rewrite, and the SKIP_REVISION/`clearRevisions` case stays (revision marks
  are meta, undo of them is not expected; document `element` and text are not
  meta). ProseMirror's history plugin already composes an
  `appendTransaction` result into the same undo event as the transaction that
  triggered it; that is the grouping the comments wanted.
- Make the autocomplete Enter-accept a single dispatch: build one transaction
  that replaces the text, sets the selection, splits the block, and sets the
  new line's element (the `acceptAutocomplete` tr extended by the split), or
  chain both through one `editor.chain()` so history sees one step.
- Add the regression test in Part 3 (undo inverse-consistency property test).
  This is the test that would have caught it.

### B2. Focus mode does not focus (regression)

**What is there.** `globals.css:339` hides `.toolbar` and `.status-bar` in
focus mode. The editor has had a second bar above the toolbar since Phase 7
(`.chrome-bar`, EditorChrome.tsx), which the rule never learned about.

**Why it is wrong.** Verified live: enter Focus and the full project bar
stays: back button, title, Idea/In progress/Completed segmented control,
History, a bright blue "Sign in to save", font select, theme, Focus. The one
mode whose entire promise is "nothing but the page" keeps the most
account-flavored strip on screen. Also the permanent "Exit focus (Esc)" pill
floats at 50% opacity forever, a fixed distraction inside the distraction-free
mode.

**The better version.** Part 2, section F specifies the rebuilt focus mode
(hide all three bars, top-edge hover reveal, one 2.5s entry toast, typewriter
option). The minimal Tier-0 fix while the shell still exists: add
`.focus-mode .chrome-bar { display: none; }` and replace the permanent pill
with a toast that fades after 2.5s (opacity 180ms ease-out both ways),
re-shown on mouse-move-to-bottom-right only.

### B3. Enter on an empty cue/dialogue line litters the script with junk lines

**What is there.** `runEnterFlow` (keymap.ts) always splits. Verified live:
ANNA cue → Enter → empty dialogue → Enter leaves `dialogue: ""` in the
document and creates a new action line. The natural way every writer exits a
speech (double-Enter) permanently deposits an empty dialogue line.

**Why it is wrong.** Those empty lines are real nodes: they consume pagination
height (16px each), export as blank rows to Fountain/FDX/PDF, show up in the
line counts, and accumulate forever. Final Draft, Arc, and Fade In all treat
Enter on an empty element as "convert this line in place to the next logical
element" precisely so this cannot happen.

**The better version.** In `runEnterFlow`, before splitting: if the current
line is empty (`node.textContent.trim() === ""`) and its element is not
`action`, do not split; retype the line in place to `ENTER_FLOW[element]`
(dialogue → action, character → action, parenthetical → dialogue,
scene_heading → action, transition → scene_heading) and keep the caret where
it is. Enter on an empty action line keeps today's behavior (blank action
lines are a legitimate spacing idiom in prose-heavy pages, and pagination
already absorbs them). One undoable step. Add unit tests for each element's
empty-Enter transition.

### B4. A session expiry silently signs the writer out and wipes local copies

**What is there.** `client.ts` clears the session on any 401. The
`useProjects` identity effect treats user → null as a sign-out and runs
`dropCloudProjects()` + `clearLocalFolders()` + `clearAllBookkeeping()`,
deleting the local bodies of every cloud-created project. Sessions live 30
days.

**Why it is wrong.** Every device that stays signed in eventually crosses the
30-day line, and the first API call after that (an autosave, mid-typing)
clears the session, flips the identity, and the wipe runs with no flush, no
consent, and no explanation. The open editor's meta disappears, AppShell
bounces to home, and the unmount save writes the document into an orphaned
localStorage key no UI can see. Unsynced edits (the last debounce window, or
anything queued offline) are gone. The user-initiated sign-out path got a
flush in the last audit (F4); the expiry path got nothing.

**The better version.** Distinguish "the user signed out" from "the session
died". In `client.ts`, on 401: do NOT `clearSession()`; instead set a module
flag and dispatch `less:sessionexpired`. `useAuth` exposes
`sessionExpired: true` while keeping `user` non-null; sync paths check a
`isSessionLive()` guard and go quiet (status "error" → label "Session
expired"). The UI shows one banner: "Your sign-in expired. Sign in again to
keep syncing" with the Google button; local copies stay untouched; nothing is
wiped. `dropCloudProjects` runs only from the explicit sign-out button (which
already flushes first). The claim/sync-code path is unaffected.

### B5. Retyping a dual-dialogue line leaves the `dual` flag on non-dialogue elements

**What is there.** `screenplayLine.ts` `setElement` spreads `...node.attrs`,
so Cmd+2 on a dual dialogue line yields an action line with `dual: true`;
CSS `[data-dual="true"]` shoves it to the right half at 2.7in wide. The
Enter path was fixed in the last audit; the retype path was not.

**Why it is wrong.** An everyday edit (turning a speech into action) produces
a visibly mangled, mis-indented line whose cause is invisible to the writer,
and the flag exports.

**The better version.** In `setElement`, compute `keepDual = dual && (type ===
"dialogue" || type === "parenthetical" || type === "character")` and write
`dual: keepDual` in the same setNodeMarkup. Mirror the same normalization in
`toggleDual`'s cluster walk (already correct) and add a unit test: dual
dialogue retyped to action loses the flag; dual dialogue retyped to
parenthetical keeps it.

### B6. The storage-full banner is invisible in dark mode

**What is there.** `.storage-banner` uses `background: var(--fg, #1a1a1e);
color: var(--bg, #fff)`. `--fg` is defined nowhere in the codebase; `--bg` is
`#141417` in dark mode. Dark mode therefore renders near-black text
(`#141417`) on near-black (`#1a1a1e` fallback).

**Why it is wrong.** The one banner whose whole job is "your work may not be
saving" is unreadable in the theme half your users write in at night.

**The better version.** Give the banner real tokens: light theme `background:
#17171A; color: #F4F4F2`; dark theme `background: #E9E9ED; color: #17171A`
(inverted surface, the standard toast treatment), radius 8, shadow level 3
from the token set in Part 2A. Add it to the visual regression checklist.

### B7. AutoCaps corrupts positions on non-length-preserving uppercase (still open, F13)

`autoCaps.ts` still assumes `toUpperCase()` preserves length (`ß` → `SS`,
ligatures) and still carries the false comment. Skip any child where
`upper.length !== child.text.length` (CSS `text-transform: uppercase` already
displays those correctly) and fix the comment. Keep the IME guard. Unit test
with `STRAßE`.

### B8. AutoElement's revert-detection reads the wrong old line (still open, F14)

`autoElement.ts:55-57` maps the current line to the old document by top-level
index, which is wrong whenever the edit added/removed lines above the caret.
Map the position through the transactions' inverted mapping instead
(accumulate `tr.mapping.invert()` across `trs`, read
`oldState.doc.nodeAt(oldPos)`). Becomes trivial to hold to account once B1
puts these conversions back inside history.

### B9. The autocomplete and spelling popovers can render off-screen

`AutocompleteMenu`/`SpellMenu` position at `coords.bottom + 2` with no
viewport clamping and no flip; near the bottom of the window the menu is cut
off. Arrow-key navigation also never scrolls the active row into view
(max-height 240 + overflow auto). Clamp: if `coords.bottom + menuHeight >
innerHeight - 8`, render above (`top: coords.top - menuHeight - 2`); after
active-index changes, `scrollIntoView({ block: "nearest" })` on the active
row (the CommandPalette already does this correctly; copy it).

### B10. Dead affordances and dead code shipping to users

- The "Continue" card is gone: `lastOpenedId` is accepted by ProjectsHome and
  never used. Resuming the current draft, the single most common action, is
  not an affordance anywhere.
- `onStatusChange` is threaded into ProjectsHome and unused (status is not
  visible or settable on the dashboard at all).
- `renameFrom`/`renameTick` in ScreenplayBody are set to null/0 and never
  populated: the cast-panel → find-panel rename handoff they exist for is not
  wired.
- `HomeView` (sort + collapsed persistence) in localStore has zero callers.
- Three dead dashboard CSS generations (`.home-grid`/`.project-card` era,
  `.folder-card`/`.doc-row` era, `.chip-grid`+`.folder-tile`+`.open-folder`
  era) plus the live `.fnode-list`/`.fcard` era coexist in globals.css.
The shell rebuild (Part 2) deletes all of this; if the rebuild is deferred,
delete the dead code anyway.

### D1. There is no design system, and it shows everywhere

**What is there.** Thirteen font sizes (10, 11, 11.5, 12, 12.5, 13, 13.5, 14,
15, 16, 17, 18, 22), nine radii (2, 3, 4, 6, 7, 8, 10, 12, 999), ad-hoc
z-indices (0, 1, 20, 40, 50, 90, 100, 200, 300, 1000), spacing values chosen
per-component, two shadows plus a blue glow, and a single interactive style
(the bordered chip) for every control regardless of importance.

**Why it is wrong.** This is the mechanical answer to "why does Arc feel
polished and LESS does not." Polish is consistency under constraint: a small
type scale, one spacing grid, two or three radii, a deliberate elevation
ramp. None of that exists, so every screen reads as assembled rather than
designed.

**The better version.** The token sheet in Part 2A, applied by rebuilding the
stylesheet rather than patching 2,815 accreted lines.

### D2. The accent color fights the product and the stated taste

**What is there.** Bootstrap blue `#2f6df6` as brand text, active chip fill,
active text, selection, find highlight, scene numbers in panels, section
labels, segmented actives, a blue ambient glow around every page sheet
(`--accent-glow`), and the focus ring color. taste.md: "no brand color...
Typography over color. Color is rarely the design lever."

**Why it is wrong.** A screenwriting page is ink on paper. A saturated blue
system pulls attention to the chrome, away from the page; the glow literally
haloes the paper in brand color. It also makes LESS look like every bootstrapped
SaaS dashboard, which is the opposite of the identity a "last ever" writing
tool wants.

**The better version.** Ink-first palette (Part 2A): active states carried by
weight, underline, and surface contrast, not blue fills; the glow deleted;
blue demoted to exactly two jobs (text selection and the find highlight, both
platform conventions); the sync dot keeps its three semantic colors; folder
colors remain user-chosen data, not chrome.

### D3. The editor chrome is three bars and ~24 equal chips: the tool overshadows the writing

**What is there.** Row 1: back, title, 3-segment status, History, sync dot +
label + email, Sign out, font select, theme cycler, Focus. Row 2: six element
buttons with shortcut badges, Dual, Export, Import. Row 3: Scenes, Find, Cast,
Reports, Notes, Breakdown, Title Page, Spelling, Scene #, Revisions, (Clear
marks), CONT'D. Plus a status bar. ~130px of chrome, every control an
identical bordered chip.

**Why it is wrong.** No hierarchy: "Spelling" (set once) has the same visual
rank as "Find" (daily) and "Clear marks" (destructive, rare). The element row
duplicates what Tab/Enter/Cmd-numbers and the caret icon already do better;
Arc does not spend any toolbar on element switching. Account plumbing (email,
sign out, sync words) sits in the writer's eyeline permanently. Two words for
the same idea ("Idea/In progress/Completed" here, "Not started/Writing/Done"
in the data model) leak through. The theme button label shows the current
state, so clicking "Light" makes it not-light: a small ambiguity users hit
every time.

**The better version.** The single-bar + rail + dock architecture specced in
Part 2B. Element switching moves to the status bar pill + keyboard + caret
icon. Settings and rare toggles move to one overflow menu. Account collapses
to an avatar menu. Export becomes the one promoted action.

### D4. Panels are stacking overlays with no state model

**What is there.** Six independent booleans (`showScenes`, `showFind`,
`showCast`, `showReports`, `showNotes`, `showBreakdown`); every panel renders
`position: fixed; right: 0; width: 320px; z-index: 90` over the page.
Verified live: open Scenes, Find, Cast and all three toolbar chips light up
while only the top panel is visible; the others are buried at the same
coordinates. Panels also cover the right edge of the page (the page is 816px
on a desk that could dock 300px beside it), and they pop with zero animation.

**Why it is wrong.** Incoherent state (three "open" indicators, one panel),
hidden content (the page you are navigating is covered by the navigator), and
no spatial continuity (things appear from nowhere).

**The better version.** One `activePanel: PanelId | null` state; a docked
right column that pushes the page-scroll area (`grid-template-columns: 1fr
300px` on ≥1280px viewports, overlay with scrim below that), slide-in 180ms
ease-out, Esc closes, one panel at a time. Rail icons reflect the single
active panel. Specced in Part 2B.3.

### D5. The dashboard is a filing cabinet, not a writer's desk

**What is there.** First content a returning writer sees: "LOOSE PROJECTS"
(the label for unfiled scripts), a grid of gray chips with hover-only actions,
folder cards with stage chips duplicating project status, no search, no
Continue affordance, and a five-field modal ("Name / Type / Template / Written
by / Page target") between "New project" and typing. The dead `lastOpenedId`
confirms Continue existed and was lost. A hardcoded Storyteller link ships for
one specific email.

**Why it is wrong.** The writer's real question on arrival is "let me get back
into my script" (one click, zero decisions), then occasionally "start
something new" (which should also be one click; naming can happen later,
Google-Docs style). "Loose projects" is system vocabulary. Two parallel
three-state taxonomies (project status and folder stage, with different
labels) is one taxonomy too many. Search matters at 10+ projects (Arjun has
20+). Hover-only actions are undiscoverable and unusable on touch.

**The better version.** Part 2C: Continue hero card, one-click New that lands
in the editor, folder tree in a left sidebar, script rows with visible
metadata, search, one taxonomy, no personal easter eggs in product chrome.

### D6. First-run and empty states sell the product instead of being the product

**What is there.** A cold visitor gets centered marketing copy ("Write a
screenplay. A fast, free screenwriting editor...") with keyboard hints for an
editor they cannot see, and a small bordered "New project" chip that opens
the five-field modal. A new screenplay opens on a blank page whose only
guidance is one placeholder line. The original kickoff spec ("load a short
sample script by default so the empty state isn't intimidating and the
formatting is visible instantly") was built in Phase 1 and lost in Phase 7.

**Why it is wrong.** Arc/Celtx put you in a formatted document immediately;
the format IS the pitch. Words about formatting are strictly worse than
formatted words.

**The better version.** Part 2D: first visit lands directly in an untitled
screenplay pre-seeded with a six-line sample scene and a dismissible hint
card; the dashboard only appears once there is something to come back to.

### D7. Zero motion, everywhere

**What is there.** Four micro-transitions in 2,815 lines of CSS (chevron
rotate, card border-color, swatch scale, hold-fill). Panels, modals, menus,
the palette, theme switches, and page navigation all pop in a single frame.
No `prefers-reduced-motion` handling (nothing moves, so nothing to reduce).

**Why it is wrong.** Motion is how an interface communicates that something
came from somewhere. Its total absence is a large part of "poorly executed"
feel even when layouts are fine. (Its overuse would violate taste.md's "no
spring or bouncy animations": the answer is small and fast, not none.)

**The better version.** The motion token sheet and per-surface specs in Part
2E: 120-240ms, ease-out, opacity+translate only, honoring
`prefers-reduced-motion`.

### D8. The page: right idea, three wrong details

The paginated sheets with numbers are the correct Google-Docs-style call, and
the geometry is right (verified 8.5in, correct indents). Three details:
1. The blue glow shadow on every sheet (D2): delete.
2. 2px corner radius reads as an unfinished rectangle: paper is 0; use 0.
3. Dark mode paper `#232329` under `--shadow: 0 2px 20px rgba(0,0,0,0.5)` on
   `#141417` barely separates: raise paper to `#1E1E22`, desk to `#131316`,
   and use the elevation ramp (Part 2A) instead of one heavy shadow.
Also the WYSIWYG gap (no on-screen (MORE)/(CONT'D), long blocks pushed whole)
remains the biggest structural page issue: the staged F16 design from the
prior audit is adopted wholesale as the fix (Part 2G).

### D9. Native browser dialogs break the product's voice

`window.confirm` for import-replace and history-restore, `window.alert` for
import errors and create failures, `window.prompt` for link URLs
(PlainToolbar). Each is a jarring OS dialog inside an otherwise designed app,
unstylable and un-animated. Replace with the app modal (Part 2B.5) and, for
import-into-editor, a real choice: "Replace this script" vs "Import as new
project" (the current binary confirm defaults people into destroying their
open document; verified that a pre-snapshot exists, but the choice is still
wrong-shaped).

### D10. Discoverability cliff: the app's best features are invisible

Cmd+K exists (well-built) and is advertised nowhere: no hint in any bar, no
"?" shortcut sheet, no mention in empty states. Tab-cycling and Cmd+1-6
appear only in tooltips and on the one-time empty home. CONT'D, Scene #,
Revisions, page lock are unexplained jargon chips. The fix is structural
(fewer visible controls need less explaining) plus one affordance: a "?"
keyboard-shortcuts overlay (Part 2D.4) and a subtle "⌘K" hint in the top bar.

### D11. Accessibility debt

- `outline: none` on focused inputs/title with only a border-color change;
  buttons rely on default outlines that several rules strip. No
  `:focus-visible` ring anywhere.
- Modals do not trap focus and do not restore focus on close; Esc handling is
  inconsistent (TitlePageModal listens globally; AuthModal only via backdrop
  click; CommandPalette correct).
- Save state ("Saved/Saving") is not `aria-live`; sync failures are silent to
  screen readers.
- Hover-only actions (chip actions, cast Rename) have `:focus-within` as the
  only keyboard path, undiscoverable; drag-and-drop has no keyboard
  alternative at all.
- Muted-on-desk contrast in light mode (`#8a8a93` on `#e9e9ec`) is 3.4:1,
  below AA for the 11-12px sizes it is used at.
Part 2H specifies the floor: tokened focus ring, focus trap util, aria-live
status, 4.5:1 minimums, keyboard alternatives for every hover/drag action.

### D12. Defaults and small paper-cuts (each one line to say, each real)

- Auto-(CONT'D) defaults OFF; every professional tool defaults it on.
- Theme cycler shows current state, not action; three-way cycling hides
  "system" behind two clicks.
- Scene navigator/report page numbers derive from the visual engine
  (correct), but the navigator shows "p. N" without a scene-length signal
  (pages-per-scene is one subtraction away and is what writers scan for).
- `.doc` / `.pages` / `.pdf` import errors are good copy but arrive as
  alert() (D9).
- The Import button inside the editor replaces the script; the same word on
  the dashboard creates projects. Same verb, opposite blast radius (folded
  into D9's redesign).
- Relative times ("3 min ago") never refresh while the dashboard sits open.
- `spellcheck="false"` on the plain editor is `"true"` (native) while the
  screenplay uses the custom engine; the two underline styles differ.
- The rename flow from Cast panel was designed (initialRenameFrom) and never
  wired (B10); inline rename works but "rename everywhere including mentions"
  is only reachable through Find → Rename with manual retyping.

### What is genuinely fine (do not touch)

The one-node screenplay schema and strict Document. The Enter/Tab/Cmd-number
flow map. SmartType's ranking, catalogs, and gating. The screenplay-aware
spellcheck design. The visual pagination engine's measurement strategy
(post-F32) and shared layout table. The whole import/export stack (post-F18
escapes) and its single-orchestrator shape. The local-first storage layout,
per-field clocks, tombstones, eviction design, local snapshot ring. The D1
API's hardening (body caps, KV rate limits, alg pinning). Hold-to-delete for
folders. The status-bar concept. The caret-side element icon. The command
palette implementation. `EMPTY_SCREENPLAY` starting on a scene-heading line.

---

## Part 2: The redesign, specified

This is the shell rebuild. It is deliberately concrete enough to execute
without further design judgment. Where a choice was between restraint and
decoration, restraint won (taste.md is the tiebreaker).

### 2A. Design tokens (the new `tokens.css`, replaces the :root blocks)

Type (UI chrome; the page keeps Courier/Courier Prime 12pt/16px untouched):
```
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
--text-xs: 11px;   /* micro labels, badges */
--text-sm: 12.5px; /* secondary, status bar, menu items */
--text-md: 14px;   /* default controls, panel body */
--text-lg: 16px;   /* panel titles, modal titles, doc title */
--text-xl: 22px;   /* dashboard headings */
line-heights: 1.45 across chrome; weights 400/500/600 only (700 reserved for
the wordmark and scene headings on paper).
```

Color, light:
```
--desk: #ECECEA;        /* warm gray desk */
--paper: #FFFFFF;
--surface: #F6F6F4;     /* bars, cards, inputs sit here, NOT pure white */
--surface-2: #EFEFED;   /* hover fill, recessed wells */
--ink: #17171A;         /* text + active states */
--muted: #63636B;       /* secondary text; 4.6:1 on --surface */
--hairline: #DEDEDA;
--selection: rgba(47, 109, 246, 0.25);  /* the ONLY blues left */
--find-hit: rgba(47, 109, 246, 0.20); --find-hit-active: rgba(47,109,246,.38);
--ok: #2FBF71; --warn: #E2B53B; --danger: #E0533B;  /* sync dot + destructive */
--ring: #17171A;        /* :focus-visible, 2px, offset 2px */
```
Color, dark:
```
--desk: #131316; --paper: #1E1E22; --surface: #1A1A1E; --surface-2: #232328;
--ink: #E9E9ED; --muted: #A0A0A8; --hairline: #2A2A30;
--ring: #E9E9ED; (semantic + selection colors unchanged)
```
Removed outright: `--accent`, `--accent-glow`, `--btn-active-bg`,
`--btn-active-fg`, the blue brand text. The wordmark renders in `--ink`.
Active state = `--surface-2` fill + `--ink` text + 600 weight. Primary action
= solid `--ink` button with `--paper` text (one per screen, maximum).

Geometry and elevation:
```
--r-sm: 4px (controls); --r-md: 8px (menus, cards); --r-lg: 12px (modals);
page sheets: radius 0.
--space: 4 8 12 16 24 32 (the only gaps/paddings allowed);
--e1: 0 1px 2px rgba(0,0,0,.06);                       /* rails, bars */
--e2: 0 4px 16px -4px rgba(0,0,0,.12);                 /* menus, popovers */
--e3: 0 16px 48px -12px rgba(0,0,0,.24);               /* modals, palette */
page sheet shadow: 0 1px 3px rgba(0,0,0,.10), 0 8px 32px -16px rgba(0,0,0,.16)
(dark: alphas .35/.45). No colored glow.
z-scale: 10 dock, 20 bars, 30 menus, 40 toasts, 50 modal, 60 palette.
```

Motion:
```
--dur-1: 120ms (menus, hovers); --dur-2: 180ms (dock, toasts);
--dur-3: 240ms (modal, view swap);
--ease: cubic-bezier(0.2, 0, 0, 1);      /* decelerate; the default */
--ease-io: cubic-bezier(0.4, 0, 0.2, 1); /* moves that both start and end on screen */
@media (prefers-reduced-motion: reduce): all transitions become opacity-only
at 80ms; transforms disabled.
```

### 2B. Editor chrome architecture (replaces EditorChrome + both toolbars)

**2B.1 One top bar, 48px, `--surface`, hairline bottom.**
Left: `‹` back (icon button 32px) · document title (borderless inline input,
`--text-lg` 600; hover shows hairline; Enter/blur commits: keep current
logic) · sync indicator: one dot + one word ("Saved", "Saving", "Offline",
"Sign in to back up" as a quiet text button when signed out, "Session
expired: sign in" per B4). No email address in the bar, ever.
Right: `⌘K` hint chip (opens palette, `--muted`) · **Export** (the single
solid-ink button) · panel-rail toggle on small screens · overflow menu `⋯`.

Overflow menu `⋯` (280px, `--e2`, radius 8) groups, in order:
Import into this project… / Title page… / divider / toggles with checkmarks:
Spell check, Scene numbers, Auto (CONT'D) [default ON for new projects],
Revision mode (+ "Clear revision marks" action, danger-styled, only while
revisions on) / divider / Font: Courier Prime | Courier (radio rows) · Theme:
Light | Dark | System (radio rows, no cycling) · Page target… / Lock pages /
divider / status: Idea | Writing | Done (radio rows) / divider / account row
(email + Sign out, or Sign in) / Back to projects.

**2B.2 Left rail, 44px, icon-only, `--surface`, hairline right.**
Top-to-bottom: Scenes, Cast & Locations, Notes, Breakdown, Reports, History,
divider, Find (Cmd+F), Focus. 32px hit targets, `--muted` idle, `--ink` +
`--surface-2` pill when its panel is active. Tooltips (200ms delay) name each
with its shortcut. The rail hides in focus mode and below 900px (folds into
the top bar's rail toggle).

**2B.3 Right dock, 300px, one panel at a time.**
State: `activePanel: "scenes" | "cast" | "notes" | "breakdown" | "reports" |
"history" | "find" | null`. Rail clicks set-or-clear it. ≥1280px: the dock is
a grid column (`.editor-body { display: grid; grid-template-columns: 44px 1fr
300px; }`) so the page recenters in the remaining width; the dock slides in
(translateX(12px)→0 + opacity, --dur-2 --ease) while the page column
transitions its width (--dur-2 --ease-io). <1280px: the dock overlays with a
`rgba(0,0,0,.2)` scrim (click-to-close). Esc closes the dock before anything
else. Panel internals keep today's components with the token restyle: 16px
padding, `--text-md`, hairline separators, row hover `--surface-2`, actions
appear on hover AND on focus-within, kebab menu on touch.

**2B.4 Status bar, 26px.**
Left: the element pill: current element name in 600 (`Character ▾`); click or
Ctrl/Cmd+E opens an upward menu of the six elements with their Cmd-numbers;
selecting retypes the line (same `setElement`). Beside it, "Dual" appears as a
small toggle chip ONLY when the caret is in a cue cluster (contextual, not
permanent). Right: `Page 3 of 92 · 92 min` (from the visual engine; " of
target" style when pageTarget set: `31 / 110 pages`), words, and the save
word (doubles as the aria-live region). Locked pages show `Locked · Blue rev`
here.

**2B.5 App modal + toast primitives (replace every native dialog).**
Modal: centered, min 360px/max 440px, `--paper`, radius 12, `--e3`, scrim
`rgba(0,0,0,.35)` fading --dur-2, panel fades+scales 0.98→1 --dur-3 --ease;
focus trapped (loop Tab within; restore trigger focus on close; Esc closes;
initial focus on the first field or the least-destructive button).
Buttons right-aligned: text-button Cancel, solid-ink confirm; destructive
confirms are `--danger` solid with a 400ms disabled beat before becoming
clickable (prevents double-click disasters), never "OK".
Toast: bottom-center, inverted surface (B6 colors), radius 8, --e2, enters
translateY(8px)→0 --dur-2, auto-dismisses 4s with pause-on-hover, one at a
time, `role="status"`.
Replacements: import-replace confirm → modal with radio choice [Replace this
script / Add as a new project] + "A snapshot of the current text is kept in
History"; history-restore confirm → modal (same note); import errors → toast
(danger); link URL prompt → popover with input inside the plain toolbar.

### 2C. Dashboard redesign (replaces ProjectsHome layout)

Structure: top bar (48px: wordmark in ink · search input (flat, `--surface-2`,
placeholder "Search scripts", filters live, autofocus on `/`) · spacer ·
theme in an overflow `⋯` · account avatar/menu · solid-ink **New script ▾**
with a split menu: New document, From template…, Import files…, New folder).
Body: two columns on ≥1024px: a 220px folder sidebar (All scripts · Unfiled ·
folder tree with color dots, counts, drag targets, kebab per folder: rename,
color, new subfolder, delete-with-hold; stages dropped entirely) and the
content column:
1. **Continue card** (restores `lastOpenedId`): full-width, paper-colored,
   the last-opened script's title, "Page 31 · edited 2 hours ago", and its
   first scene heading in 12pt Courier as a live specimen. One click opens.
   Hidden if no projects.
2. **Script rows** (not chips): 52px rows: type icon tinted by folder color ·
   title (`--text-md` 600) · status dot+word (Idea/Writing/Done, click to
   cycle, gray/ink/ok colors) · pages (from meta cache; "12 pp") · updated ·
   kebab (Rename, Move to…, Duplicate, Export…, Delete). Row click opens.
   Drag to sidebar folders; keyboard: kebab "Move to…" opens a folder picker
   modal (the accessible path).
3. Empty folder: one line, "Nothing here yet. Drag a script in, or press New."
Sorting: header dropdown (Recent / Title / Created), persisted (revives
`HomeView`). Statuses and folder stages merge into the one project status.
The Storyteller link moves out of the product (bookmark, not chrome).

New-script flow: clicking **New script** creates `Untitled screenplay`
immediately and opens the editor (no modal). The title is selected-for-rename
in the top bar on first open. "From template…" opens the template picker
modal (Blank/Feature/TV/Sitcom with 12pt Courier previews); "Written by" and
page target live in Title page… and the overflow, where they belong.

### 2D. First-run, empty states, onboarding

1. **Cold visit** (no index): skip the dashboard. Create `Untitled screenplay`
   seeded with the six-line sample scene (restore `sampleScript.ts` content,
   Alex-at-the-laptop, minus the em dash it once had) and open it directly.
   The dashboard exists from the second project on.
2. **Hint card**, first open only: floating bottom-left, paper, radius 8,
   `--e2`, 260px: "Tab cycles the line type · Enter follows the flow · ⌘K
   does everything". Dismiss (×) or auto-fade after the first 50 keystrokes.
   Stored `less:hints:v1: dismissed`.
3. **New empty screenplay** (from dashboard): placeholder stays; add one
   ghost line under it, `--muted` 12pt Courier: "Press Tab to change the line
   type", removed at first keystroke (a decoration, never document content).
4. **"?" overlay**: pressing `?` outside a text input, or "Keyboard
   shortcuts" in ⌘K, opens a two-column modal listing the full map (elements,
   flow, panels, palette, focus, find). Static content, tokens-styled.

### 2E. Motion application map

- Dock: 2B.3. Menus/popovers/autocomplete/spell: opacity + translateY(-4→0),
  --dur-1 --ease; leave at 80ms opacity.
- Modals/palette: 2B.5 spec. Palette backdrop fades --dur-1.
- Toasts: 2B.5.
- View swap (dashboard ↔ editor): the incoming view fades 0→1 --dur-2 --ease
  with translateY(4px)→0; no exit animation (hash swap is instant).
- Page sheets: none. The paper never animates. Pagination reflow is instant.
- Chip/row hovers: background-color --dur-1.
- Focus ring: no transition (immediate).
- Sync dot: crossfade colors --dur-2; "Saving…" text does not pulse.
- prefers-reduced-motion: per 2A.

### 2F. Focus mode, rebuilt

Entering (rail icon or ⌘K): all three chrome regions and the dock hide (`
.focus-mode` hides top bar, rail, dock, status bar: the B2 fix is subsumed);
the desk dims 8% (`filter: brightness(.92)` on the backdrop only); a toast
"Focus. Esc to leave." shows once per session. The page column expands to the
full width (still centered, max 8.5in). Mouse to the top 8px reveals the top
bar (slide down --dur-2) until the pointer leaves it; typing hides it again.
Esc order: dock → focus mode (single-purpose handler checks dock first). A
`focus: typewriter` toggle in ⌘K keeps the caret line vertically centered
(on selection change, `scrollIntoView({ block: "center" })` throttled to
120ms) for writers who want it; off by default.

### 2G. The page and WYSIWYG

- Sheet: radius 0, elevation per 2A, page number `--muted` at 0.55 opacity,
  `page X` bottom-right 0.45in inset (unchanged position).
- Adopt the staged F16 merge exactly as designed in
  superaudit/2026-07-01.md ("F16 staged"): mid-block split decorations with
  `(MORE)` / `NAME (CONT'D)` via Range.getClientRects boundary search, ≥2
  lines each side, parentheticals never split, dual clusters exempt in v1,
  RAF-debounced recompute, acceptance test: a 60-line monologue paginates
  identically on screen and in the exported PDF.
- PDF: embed Courier Prime (Regular/Bold/Italic, OFL) via
  `pdf-lib` + `@pdf-lib/fontkit`, subset on; screen and print then share the
  actual face, and the CP1252 "?" substitution disappears for Latin-plus
  text. Fallback to built-in Courier if the font asset fails to load. Keep
  the 10cpi/6lpi metrics (Courier Prime is metrically compatible).
- Auto-(CONT'D) default flips ON for new projects (existing projects keep
  their saved pref).

### 2H. Accessibility floor (new, non-negotiable)

- `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`
  restored globally; remove every `outline: none` that lacks a replacement.
- Focus trap + focus restore in the modal primitive (2B.5) and the dock when
  overlaying.
- The save/sync word is `role="status" aria-live="polite"`; storage-full and
  session-expired banners `role="alert"`.
- Muted text never below 4.5:1 at sizes under 14px (the 2A values comply).
- Every hover-revealed action set gets a persistent kebab fallback; every
  drag interaction gets a menu-based equivalent (2C's "Move to…").
- The element pill, rail, dock, palette, menus: full arrow-key + Enter + Esc
  keyboard paths (palette already compliant; copy its pattern).

### 2I. Copy pass (one dialect)

- Status labels everywhere: **Idea / Writing / Done** (data values unchanged;
  display-only mapping; the "Not started/In progress/Completed" strings die).
- "Loose projects" → never shown (sidebar "Unfiled" when needed).
- Buttons are verbs ("Export PDF", "Restore this version"), toggles are
  nouns with checkmarks, no "OK", no exclamation marks anywhere (audit found
  none in UI copy: keep it that way), sentence case throughout (drop the
  ALL-CAPS section labels except on paper).
- The import distinction: dashboard "Import files…" (creates projects);
  editor "Import into this project…" (the modal with Replace/Add choice).

---

## Part 3: Testing plan (the "make sure there are no bugs" half)

The engine has 14 lww tests and nothing else. The plan adds three layers; the
executor writes these alongside, not after, the fixes.

**3.1 Unit (vitest, jsdom for PM where needed):**
- Undo inverse-consistency property test (B1): drive a scripted sequence of
  transactions through a headless editor (insert "an", accept autocomplete,
  Enter, Enter, type "int. b"), snapshot `doc.toJSON()` after each step, then
  undo step-by-step asserting each snapshot is re-reached in reverse order.
  Run the same property over 20 randomized short sequences (seeded).
- Empty-Enter conversions (B3): each element's empty-line Enter result;
  non-empty Enter still splits; caret position asserted.
- `setElement` dual normalization (B5) + `runEnterFlow` note/dual carry rules.
- AutoCaps: `STRAßE` (length change skipped), IME-composition no-op guard
  (mock `view.composing`), ordinary lowercase→upper still rewrites (B7).
- AutoElement revert-detection with a line inserted above the caret in the
  same transaction (B8).
- computeContinuations edge cases (existing behavior pinned).
- Fountain/FDX round-trips: the F18 forcing-character cases ('.45', '#1',
  '> ', '~hum'), dual dialogue, title pages, scene numbers.
- lww suite: unchanged, plus a case for the B4 session-expiry flag (reconcile
  must not run while expired).
- Pagination engine parity (post-F16): a corpus of 6 synthetic scripts
  (monologue-heavy, slug-heavy, dual, parenthetical chains) asserting
  screen-engine page starts == export-engine page starts.

**3.2 End-to-end (Playwright, new `e2e/`, run against `wrangler pages dev`):**
- Cold visit → lands in editor with sample → type the Anna scene via
  keyboard only → export PDF resolves a non-empty download.
- Undo storm: type the B1 sequence, mash Cmd+Z to empty, assert the document
  equals the initial sample at the end (no phantom text).
- Panels: open each rail icon; assert exactly one dock panel; Esc closes;
  page column width transitions (bounding-box check).
- Focus mode: all bars hidden (zero visible `header/nav` boxes), top-edge
  hover reveals, Esc exits, toast appears once.
- Two tabs: edit in A, assert B adopts (BroadcastChannel path) when clean and
  keeps its own dirty edits when dirty.
- Session expiry: intercept `/api/**` to 401 once signed in via a stubbed
  token; assert the expired banner, no local wipe (project rows persist), and
  re-auth restores sync.
- Import: drop a .fountain fixture on the dashboard (new project) and inside
  the editor (Replace vs Add flow both asserted).
- Dark mode + reduced motion: `prefers-reduced-motion: reduce` yields no
  transform transitions (computed style spot-check).
- Mobile 375px: dashboard rows usable, editor page full-width, rail folded.

**3.3 Manual matrix (release checklist, 20 minutes):**
Safari + Firefox + Chrome; 1280 and 1512 wide + 375; light/dark; macOS
Japanese IME smoke in a cue (B7 guard); VoiceOver pass of top bar → rail →
dock; print the PDF of a 3-page script and hold it next to the screen.

---

## Part 4: Execution order (hand this list to the executor)

Phase 0 is shippable same-day; each later phase is one focused session.
Nothing here touches `functions/api`, `migrations/`, or the localStorage
schema. Every task ends with: `npm run typecheck && npm run build && npm test`
green, plus the named E2E where present.

**Phase 0: Tier-0 bugs (ship before any redesign)**
1. B2 minimal: hide `.chrome-bar` in focus mode; pill → auto-fade toast.
2. B1: remove `addToHistory:false` from autoElement + autoCaps rewrites;
   single-dispatch autocomplete Enter-accept; add the undo property test.
3. B3: empty-line Enter converts in place; unit tests.
4. B5: `setElement` clears `dual` off non-dialogue targets; test.
5. B4: session-expiry flag + banner; stop wiping on 401; E2E.
6. B6 banner colors; B7 length guard; B8 mapping fix; B9 popover clamp +
   scroll-into-view; B10 dead code deletions (keep `lastOpenedId`: Phase 2
   uses it).

**Phase 1: Foundations**
7. `app/tokens.css` per 2A; delete dead dashboard CSS generations; migrate
   existing selectors to tokens mechanically (values only, no layout change
   yet). Visual smoke on both themes.
8. Primitives: `components/ui/Modal.tsx` (trap/restore/Esc/scrim/motion),
   `Toast.tsx`, `Menu.tsx` (anchored popover, arrow-keys), `Tooltip.tsx`.
   Replace every `window.confirm/alert/prompt` (D9) and the storage banner.
9. A11y floor (2H): focus-visible ring, aria-live save word, contrast bumps.

**Phase 2: Editor shell**
10. New `EditorShell` per 2B: top bar + overflow menu + left rail + dock +
    status-bar element pill; ScreenplayBody/PlainBody mount into it; the six
    element buttons, second/third bars, and per-panel booleans die
    (`activePanel` state). E2E: panels, chrome count.
11. Focus mode per 2F (subsumes B2). E2E: focus.
12. Onboarding surfaces per 2D: sample-seeded cold start, hint card, ghost
    line, "?" overlay, ⌘K hint chip. CONT'D default ON for new projects.

**Phase 3: Dashboard**
13. Rebuild ProjectsHome per 2C: sidebar tree, Continue card, script rows,
    search, sort, split New button, instant-create flow, folder-stage
    retirement (display only), copy pass 2I. E2E: cold visit, import flows,
    mobile 375.

**Phase 4: The page**
14. F16 pagination merge as staged (2G), then the parity test corpus (3.1)
    and the monologue E2E.
15. Courier Prime embedding in PDF with fallback (2G). Manual print check.

**Phase 5: Hardening**
16. Remaining 3.1 units + full 3.2 E2E suite in CI (GitHub Action step before
    deploy; Playwright against `wrangler pages dev` with a throwaway D1).
17. The 3.3 manual matrix, then a `superaudit/2026-07-16-verify.md` recording
    what shipped, with screenshots light/dark.

---

## Part 5: What stayed genuinely uncertain

- **Google OAuth consent status.** The AuthModal error copy references "test
  user on the consent screen", which suggests the OAuth app may still be in
  testing mode: if so, only allow-listed accounts can sign in. Verify in
  Google Cloud Console before treating sign-in as launched. Not fixable from
  the repo.
- **Audience.** The redesign assumes LESS stays what the README claims: a
  public, free tool whose first-run matters. If it is really a personal tool
  for Arjun plus friends, Phase 3's onboarding polish drops in priority
  (everything else stands).
- **Dashboard page counts** (2C's "12 pp" on rows) need a cached count in
  ProjectMeta (cheap to add at save time: `paginate` already runs in the
  editor; write `meta.pageCount` on save). Flagged because it is the one 2C
  item that touches the storage shape: additive, optional field, no
  migration.
- **Courier Prime metrics in pdf-lib**: metrically Courier-compatible in
  spec; the parity test (3.1 pagination corpus) is the guard if an edge
  differs.
- **`?` shortcut** conflicts with typing `?` in text: the overlay must only
  bind outside editable contexts (the spec says so; calling it out so it is
  not "simplified" away).

*End of report. Nothing in the repo was modified. The plan above is written
to be executed top-to-bottom by Opus (or Codex on branches) with the verify
gate after every numbered task.*
