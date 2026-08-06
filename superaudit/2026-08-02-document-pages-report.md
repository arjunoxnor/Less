# Document pages report

## Outcome

Documents have real US Letter page sheets again. They use a new prose-only
pagination extension and pure pixel planner in `lib/editor/docPagination.ts`.
The screenplay paginator in `lib/editor/pagination.ts` was not changed.

The planner consumes measured block border-box heights, collapsed adjoining
margins, and the real top coordinate of every rendered line. It returns page
assignments and page breaks without accessing the DOM. The TipTap layer only
collects geometry, resolves a planned line break to a document position, and
installs transparent spacer decorations.

The document page host now uses the shared sheet backdrop and shared
screenplay page constants. The prose width remains 8.5 inches with the same
6.5 inch desktop text column. Documents also report `Page X of Y` in the
status bar.

## Break rules

- A whole block stays on the current page when its measured height and the
  browser-resolved adjoining margin fit.
- A whole block moves to the next page when it does not fit and has no legal
  line split.
- Paragraphs split only at line tops measured with `Range.getClientRects`.
  The TipTap layer locates the corresponding caret position with a binary
  search over `coordsAtPos`.
- Paragraph splits require at least two lines on both sides. If the current
  page would receive one orphan line, the whole paragraph moves. If a split
  would carry one widow line, the break backs up by one line.
- Headings never split. A heading reserves enough room for consecutive
  headings and at least the first two lines of the following body block. A
  three-line paragraph is kept whole because a two-and-one split would violate
  widow control.
- Top-level lists are measured one item at a time. A list can break between
  items, and an item can break only at one of its own line tops. A split never
  precedes the first line, so the marker stays with that line.
- Quotes and code blocks can split at their own measured line boundaries when
  taller than the available page space.
- A block taller than a page keeps making progress at real line boundaries,
  so it cannot loop forever.
- Page-top margins are suppressed by the plan. On-page margins use the actual
  gap between browser rectangles after CSS margin collapse.

## Reflow and responsiveness

Content changes schedule a 90 ms debounced measurement with a 320 ms maximum
delay during continuous typing. This caps full-document measurement instead
of doing it for every keystroke. The prose root has a `ResizeObserver`, and a
window resize listener covers viewport changes. Explicit reflow requests cover
font family, font size, focus mode, and dock state changes. A font-ready pass
catches replacement of fallback fonts.

Existing pagination widgets are subtracted from the next measurement. The
extension then converges against a canonical decoration signature, which keeps
page gaps from being counted as prose geometry.

## Automated coverage

Planner tests cover:

- a fitting block and a whole-block move;
- a paragraph split at uneven measured line tops;
- heading keep-with-next and atomic headings;
- orphan and widow avoidance;
- list-item boundaries, item line splitting, and marker ownership;
- quote and code splitting;
- a multi-page block that must make progress;
- positive, negative, and mixed-sign margin collapse;
- an empty document;
- 250 seeded property-style documents with varied block heights, line heights,
  and margins, asserting that no page overflows and no measured line is
  dropped or duplicated.

Surface tests verify that documents install `docPagination`, do not install
the screenplay `pagination` extension, draw the shared page backdrop, size the
host to its page count, and report the current page. Static layout tests cover
the gap styles and every required reflow trigger.

The unchanged screenplay parity suite passed all 18 tests. The full suite
passed 25 files and 236 tests.

## Human browser review

The remaining checks need real browser layout APIs and a human eye:

- type and paste across a page boundary with every font at 11 px and 32 px;
- mix headings, paragraphs, ordered and unordered lists, task lists, nested
  items, quotes, code, and rules immediately around page boundaries;
- confirm no glyph appears in the 22 px desk gap while typing continuously;
- confirm heading placement and paragraph widows at several zoom levels;
- inspect list numbering and task markers when an item splits;
- inspect quote borders and code backgrounds across a split;
- resize through desktop and narrow widths, then open and close the dock and
  enter and leave focus mode;
- verify caret scrolling, selection, undo, and redo across a line split.

No development server was started in this sandbox.

## Gate

- `npx tsc --noEmit`: passed.
- `npm test`: passed, 25 files and 236 tests.
