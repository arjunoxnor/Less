# Reordering and chrome: 2026-07-30

Three changes Arjun asked for after using the app. Written as the source of
truth for the build. House style: no em dashes, no emojis, no exclamation
marks, in code, copy or comments. Comments say why, not what.

## Frozen contracts

- `functions/api/**` and `migrations/**` do not change.
- No existing localStorage key changes shape. Additive optional fields only.
- No new ProseMirror node types.

## 1. Reorder project cards inside a section

Today rows reorder inside a folder, and the top-level headings reorder against
each other. The cards in between do not. Dragging one card onto another nests
it, so there is no way to say "ChessMaster sits above GodsOfOurAncestors".

Required:

- Dragging a card and releasing it **between** two cards in the same section
  places it there, with the same 2px drop line the rows use.
- Nesting stays available: releasing on a card's own body (its header area,
  not the gap between cards) still files the dragged folder inside it, exactly
  as now. The two gestures must not fight: gaps reorder, bodies nest.
- Dropping a card into a different section still re-parents it, and should
  land it at the slot it was dropped on rather than always at the end.
- Order persists through `reorderFolders` (already wired as `onReorderFolders`
  in `components/ProjectsHome.tsx`, currently used only by section headings).
  `lib/storage/library.ts` already sorts folders by `order`, so nothing in the
  read model needs to change.
- A folder can never be dropped into its own descendant. `canMoveFolderTo` in
  `lib/storage/library.ts` already answers this: use it.

The grid is two-dimensional, so hit-testing must use the same principle that
fixed row reordering: resolve the nearest gap across the whole grid rather
than requiring a precise landing. See `listDropProps` in
`components/ProjectsHome.tsx` for the pattern to follow, and
`reorderIdsAtSlot` in `lib/storage/library.ts` for the slot maths.

Tests: place a card before and after a sibling; a drop on a card body still
nests; a drop into another section lands at the chosen slot; a no-op drop
writes nothing; the descendant guard holds. Pure logic belongs in
`lib/storage/libraryInteraction.ts` next to the existing helpers, with tests in
`lib/storage/libraryInteraction.test.ts`.

## 2. One click to switch light and dark

Today the theme is three radio items (Light / Dark / System) buried in the
overflow menu, in three separate places: `components/ProjectsHome.tsx`,
`components/ScreenplayBody.tsx` and `components/PlainBody.tsx`.

Required:

- A single button in the top bar, always visible, that flips between light and
  dark in one click. No menu, no submenu.
- It shows the state it will switch TO, and says so in its `title` and
  `aria-label` ("Switch to dark" / "Switch to light"), so it is unambiguous.
- When the current theme is `system`, one click moves to the opposite of
  whatever the system is currently resolving to, so the click always visibly
  changes something.
- Matching the system stays reachable, as ONE item in the overflow menu ("Use
  system theme"), not a radio group. The three radios come out of all three
  files.
- The button belongs in the shared chrome so all three screens get the same
  control, not three copies. `components/chrome/TopBar.tsx` serves the editor;
  the home has its own header in `components/ProjectsHome.tsx`. Put the button
  itself in one shared component and use it in both.
- The theme still persists through the existing `prefs.theme` path. Do not
  change the stored values (`light` / `dark` / `system`).

Test what is testable: the next-theme decision (including the `system` case,
both ways) as a pure function with unit tests.

## 3. Put the panel rail on the side its panels open

While writing, the panel icons sit in a rail on the FAR LEFT
(`.editor-rail`), but the panel they open docks on the FAR RIGHT
(`.editor-dock`), and the Export and overflow buttons are top right. So the
writer clicks left and the result appears right, and the controls are split
across the full width of the screen. Arjun's words: the buttons being on
opposite sides during writing is tedious.

Required:

- The rail moves to the right-hand side of `.editor-body`, immediately beside
  the dock it opens, so an icon and the panel it opens are adjacent and all
  chrome lives in one band on the right.
- The page column stays centred and its width does not change.
- Focus mode still hides all of it, and the top-edge peek still works.
- The small-screen behaviour (the rail toggle in the top bar, the rail
  overlaying rather than displacing the page) keeps working, mirrored to the
  new side. Check the existing media queries around `.editor-rail`,
  `.editor-dock` and `.dock-open` in `app/globals.css`.
- Keyboard order should follow the visual order.

This is a layout change with no logic behind it, so the proof is a browser
check rather than a unit test: the rail and dock adjacent on the right, the
page unmoved and still centred, focus mode clean, and the narrow-window path
still usable.

## Definition of done

- `npx tsc --noEmit && npm test` pass. Run `npm run build` if the sandbox
  allows network; if it cannot fetch Google Fonts, say so plainly rather than
  editing the font setup. `app/layout.tsx` loads Montserrat and Jost from
  `next/font/google` deliberately: they are the fallbacks behind the Proxima
  Nova and Futura document fonts, and naming the families in CSS instead
  silently downgrades both. Do not change that.
- Append findings to `superaudit/2026-07-29-glitch-hunt-report.md` as a new
  section, or write a short companion report; do not rewrite existing ones.
