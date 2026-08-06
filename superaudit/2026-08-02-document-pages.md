# Documents get real pages, measured properly

Arjun wants page sheets in documents. The previous change removed them, which
was the wrong call: he asked for the pagination to be FIXED, not deleted. Put
pages back, built for prose instead of borrowed from the screenplay engine.

House style: no em dashes, no emojis, no exclamation marks, in code, copy or
comments. Comments say why, not what.

## Why the old pages were wrong, so the new ones are not

`lib/editor/pagination.ts` is the SCREENPLAY paginator and must stay exactly
as it is: the screenplay editor depends on it and it is pinned by
`lib/export/paginateParity.test.ts`. It cannot serve prose because:

1. It reduces every block to a row count using ONE line height. A screenplay
   is monospaced at six lines per inch; prose has headings, lists, quotes,
   code and a writer-chosen `docFontSize`, so several different line heights
   appear on one page.
2. It reads inter-block spacing from margin-TOP, while the prose styles use
   margin-BOTTOM, so gaps counted as zero and heights came out too small.
   That is why text overran the sheet and landed in the gap between pages.
3. It applies screenplay rules (cue keep-with-next, (MORE) and (CONT'D)) to
   content that has no cues.

## What to build

A new prose paginator, `lib/editor/docPagination.ts`, in the same shape as the
screenplay one (a TipTap extension plus a pure planner) but measuring real
geometry:

- Measure each top-level block's REAL height from the DOM, including its
  margins, and account for margin collapse between adjacent blocks. Do not
  assume a line height anywhere.
- Page geometry matches the screenplay sheets so the app looks consistent:
  US Letter, 1 inch margins, the same page width, the same inter-page gap.
  Reuse the existing constants rather than redefining them.
- Break at block boundaries when a whole block does not fit.
- Split a long paragraph across a boundary at a real LINE boundary, found from
  the block's own line boxes (`Range.getClientRects` plus a binary search over
  caret positions), the same technique the screenplay engine already uses for
  dialogue. Never split mid-line, and never split a heading.
- Keep a heading with at least the first two lines of the block that follows.
  A heading alone at the bottom of a page is the single most obvious defect.
- Orphan and widow control: never leave one line of a paragraph alone at the
  bottom or top of a page. Move the whole block instead when fewer than two
  lines would land on either side.
- List items are blocks in their own right for breaking purposes: a list may
  split between items, and a single item may split between its lines, but its
  marker must stay with its first line.
- Never render text inside the gap between sheets. That is the reported bug
  and it is the acceptance test.

## Reflow

The layout must be re-measured, debounced, whenever any of these change:
content, `docFont`, `docFontSize`, the window size, focus mode, and the dock
opening or closing. Use a ResizeObserver on the prose element rather than
polling. A 500-block document must stay responsive while typing: measure
incrementally or throttle rather than re-measuring everything on every
keystroke.

## Surface

- The sheets are drawn behind the text as they are for screenplays, so a
  document looks like a stack of pages.
- The status bar shows the page count and the current page for documents, the
  way it does for screenplays.
- The text column width must not change from what it is today, or every
  writer's line wrapping shifts.

## Testing

- The planner is pure and takes measured block heights as input, so it can be
  unit tested with no DOM: a block that fits, a block that does not, a
  paragraph that splits, a heading that must move with its paragraph, orphan
  and widow avoidance, a block taller than a whole page (which must split
  rather than loop forever), and an empty document.
- Property-style test: for any sequence of block heights, no page's content
  may exceed the text height, and no block may be dropped or duplicated.
- The screenplay suites must pass unchanged.

## Definition of done

- `npx tsc --noEmit && npm test` pass.
- A report at `superaudit/2026-08-02-document-pages-report.md` covering what
  was built, the break rules implemented, and what needs a human eye.
- Do not touch `functions/api/`, `migrations/`, `duet/`, the root
  `wrangler.toml`, or `app/layout.tsx` font loading. Do not change stored
  shapes. Do not add ProseMirror node types.
