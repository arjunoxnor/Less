# Documents are not screenplays: fix plain-document pagination

Arjun sent two screenshots of a DOCUMENT (an outline, not a screenplay) where
the page breaks are visibly wrong: a page ends with a large dead area while
text continues on the next sheet, and a heading sits on the seam between two
sheets rather than inside a page. This is the second layout bug in the plain
editor after the uneven paragraph spacing, and he is right to be angry about
it.

House style: no em dashes, no emojis, no exclamation marks, in code, copy or
comments. Comments say why, not what.

## Root cause, already traced

`components/PlainBody.tsx:35` imports the SCREENPLAY paginator and applies it
to prose:

```ts
import { Pagination, STRIDE, PAGE_H } from "@/lib/editor/pagination";
...
Pagination.configure({ onPages: setPages })
...
style={{ minHeight: (Math.max(1, pages) - 1) * STRIDE + PAGE_H }}
<PageBackdrop pages={pages} />
```

`lib/editor/pagination.ts` is screenplay-specific by construction and cannot
be correct for prose:

1. It reads each block's `element` attribute and applies screenplay break
   rules: keep-with-next for cues and parentheticals, the firstDialogueKeep
   reservation, (MORE) and (CONT'D) split markers. A plain document has no
   `element` attributes at all, so every block falls to a default kind and the
   rules fire on content they were never written for.
2. It reduces every block to a row count using ONE global line height
   (`lib/editor/pagination.ts:41` `DEFAULT_LINE_H = 16`, overridden by the
   computed line-height of the first measured block). A screenplay is
   monospaced at a fixed 6 lines per inch so that holds. Prose does not: the
   plain editor has headings, lists, blockquotes and a writer-selectable
   `docFontSize`, so blocks have several different line heights on one page
   and every estimate after the first is wrong.
3. Block spacing is read as `spaceBefore` from margin-TOP. The plain styles
   use margin-BOTTOM (`app/globals.css`, `.pl-prose > p { margin: 0 0 0.8em }`),
   so the gap between paragraphs is counted as zero. Heights are therefore
   systematically UNDER-estimated, which is exactly the reported symptom: the
   planner thinks more fits on a page than really does, so text overruns the
   sheet and lands in the gap.

## The decision: documents are one continuous sheet

Plain documents must not be paginated at all.

The evidence for this, not a preference:

- `lib/export/plainExport.ts:9` shows the only export formats for a document
  are `markdown` and `txt`. There is no PDF, no print layout, nothing that
  consumes a page count. The sheets are purely decorative.
- A document in this app is an outline, beats, or notes. Page boundaries carry
  no meaning for that content, unlike a screenplay where one page is roughly
  one minute of screen time and the breaks are a professional requirement.
- Keeping decorative pages means maintaining a second, prose-aware paginator
  forever, for zero benefit, with every future bug landing here again.

So: a document renders as a single white sheet that grows with its content.

## What to change

- Remove `Pagination` from the plain editor's extensions in
  `components/PlainBody.tsx`. Do not touch `lib/editor/pagination.ts` itself:
  the screenplay editor depends on it and it is covered by the 24-test parity
  suite in `lib/export/paginateParity.test.ts`, which must keep passing.
- Replace the paged backdrop with one continuous sheet. Keep the paper look:
  the same sheet width, the same left and right margins, and a generous top
  and bottom padding so text never touches the edge. The measured text column
  width must not change, or every writer's line wrapping shifts.
- The sheet grows with the content. No fixed `minHeight` computed from a page
  count, no `STRIDE`, no `PAGE_H` in this file.
- `PageBackdrop` is shared with the screenplay editor. Either give it a
  continuous mode or give the plain editor its own simple sheet; do not
  regress the screenplay's sheets either way.
- Remove any page reporting from the document's status bar, and keep the word
  and character counts. If a page number is currently shown for a document,
  it is meaningless and should go.
- Check the focus-mode and narrow-window paths still look right afterwards.

## Then sweep the rest of the plain editor

Two layout bugs have now been reported here, so audit it properly rather than
stopping at the reported one. Read the code, do not guess:

- A very long document: scrolling, caret visibility, and that nothing depends
  on a page count that no longer exists.
- Headings, lists, task lists, blockquotes, code blocks and horizontal rules:
  spacing above and below each, and their spacing when adjacent to a
  paragraph, so the uniform rhythm fixed earlier holds for every block type
  rather than only for paragraphs.
- `docFont` and `docFontSize` at their extremes: the smallest and largest
  settings must not break the sheet, the margins, or the caret.
- Long unbroken strings, pasted URLs and pasted rich text: nothing should
  overflow the sheet horizontally.
- The toolbar against an empty document and against a range selection.

## Definition of done

- `npx tsc --noEmit && npm test` pass. Run `npm run build` if the sandbox has
  network; if it fails fetching Google Fonts, report it and do NOT edit
  `app/layout.tsx`, which loads Montserrat and Jost deliberately.
- The screenplay editor is untouched in behaviour: its pagination, its parity
  suite and its undo-integrity suite all still pass unchanged.
- Tests where the logic is testable: the plain editor's extension list must
  not include the screenplay Pagination extension, and the sheet height must
  follow content rather than a page count.
- A short report at `superaudit/2026-08-02-plain-pagination-report.md`: what
  changed, what the sweep found, and what needs a human eye in a browser.

---

## Scope escalation: read every line of the document editor

Arjun's instruction after seeing the pagination: go through every line and
every scenario, not just the reported symptom. Two layout bugs have now
shipped in this editor, which means the reported bug is a symptom of the file
never having been read end to end.

So: read `components/PlainBody.tsx` line by line, top to bottom, and every
module it imports that is plain-document-specific
(`lib/editor/buildPlainExtensions.ts`, `lib/editor/smartCaps.ts`,
`lib/editor/plainDocUtils.ts`, `components/PlainToolbar.tsx`,
`lib/export/plainExport.ts`, and the `.pl-prose` block in `app/globals.css`).
For each, ask what happens when:

- the document is empty, one character, one very long paragraph, or 500 blocks
- the writer pastes rich text from a browser, from Word, or plain text with
  Windows line endings
- every block type appears adjacent to every other block type
- the caret is at the very start or very end of the document
- the writer holds Enter, or holds Backspace, through a list or a heading
- undo is pressed repeatedly after each of those
- the font and font size settings are at their extremes
- the document is opened, edited, and closed quickly enough that the debounced
  save has not fired

Fix everything real that this surfaces. Report anything found and deliberately
not fixed, with the reason. The bar is that a writer cannot produce a wrong
layout or lose a character by ordinary use of this editor.
