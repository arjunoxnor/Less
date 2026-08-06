# Plain document pagination report

## Outcome

Plain documents now render on one continuous white sheet. The sheet keeps the
existing 8.5 inch width, 1 inch desktop text margins, mobile reflow, paper
color, and shadow. Its height comes from the editor content, with an 11 inch
minimum for an empty document. The plain editor no longer imports or installs
the screenplay Pagination extension and no longer tracks a page count.

The status bar still reports words, characters, and save state. It has no page
reporting. The screenplay PageBackdrop and screenplay paginator were not
changed.

## Bugs found and fixed

1. Screenplay pagination was installed in the plain editor. Reproduction: open
   a long document with paragraphs and headings and text could cross a sheet
   seam while another sheet retained a large empty area. Fixed by removing all
   pagination state and using a content-sized plain sheet.

2. Plain block types did not share one vertical rhythm. Reproduction: place a
   heading, list, blockquote, code block, or rule beside a paragraph and the gap
   changed by block type, while nested paragraphs could run together. Fixed by
   defining consistent top-level gaps and explicit nested-block spacing.

3. Long content could escape the sheet. Reproduction: paste an unbroken URL or
   token, especially inside a task item, and the flex child could retain its
   minimum content width beyond the paper. Fixed with anywhere wrapping,
   shrinkable prose and task-list children, and a contained scrolling code
   block.

4. Smart Caps missed hard-break line starts. Reproduction: create a hard break
   in a list item and type a lowercase first letter; it stayed lowercase. Fixed
   without deleting the hard-break node.

5. Smart Caps consumed Enter after a lowercase standalone pronoun.
   Reproduction: put the caret after `Maybe i` and press Enter; the input rule
   inserted raw newline text instead of splitting the paragraph. Fixed by
   excluding line endings from that input rule.

6. Smart Caps could fail to replace a selection. Reproduction: select text at
   the start of a line, after sentence punctuation, or after a lowercase
   standalone pronoun and type the trigger character; the old selection could
   survive or only its final character could be replaced. Fixed by applying the
   replacement across the live selection.

7. Smart Caps missed common pasted punctuation. Reproduction: type a sentence
   after a closing curly quote, such as `Done.” next`; `next` stayed lowercase.
   Fixed by recognizing curly closing quotes.

8. Automatic document titles invented spaces at rich-text mark boundaries.
   Reproduction: bold only the second half of `Notebook`; the derived title was
   `Note book`. Fixed by joining adjacent inline text directly while retaining
   structural separators between blocks and list items.

9. Automatic title truncation could split a Unicode character. Reproduction:
   put a two-code-unit character at the 80-character boundary; the title ended
   with a broken replacement character. Fixed by truncating complete Unicode
   characters.

10. Markdown and text export dropped document structure. Reproduction: export
    hard breaks, links, task lists, nested lists, non-default ordered-list
    starts, code blocks, multi-paragraph blockquotes, or a literal paragraph
    beginning with Markdown syntax; breaks and destinations disappeared, blocks
    were flattened, and literal text could be reinterpreted. Fixed with
    schema-aware Markdown and text serializers that preserve those structures
    and visible text.

11. A pending signed-out edit could be replaced before local autosave.
    Reproduction: type in one tab and let a sibling-tab save arrive inside the
    600 ms debounce window; the cross-tab handler saw no cloud dirty flag and
    loaded the sibling body over the pending characters. Fixed by exposing the
    plain editor's pending-local-edit ref to cross-tab and sign-in reconcile
    guards.

## Sweep coverage

Automated coverage now checks:

- absence of the screenplay pagination extension and paged backdrop;
- one intrinsic-height sheet with no page-count height calculation;
- rapid unmount before the local-save debounce and the sibling-tab race;
- empty-document and range formatting behavior;
- CRLF plain-text paste, rich HTML paste, marks, headings, and lists;
- a 500-block document edited and undone at its final caret position;
- hard-break, Enter, curly-quote, and range-selection Smart Caps paths;
- heading, list, task-list, blockquote, code, rule, and paragraph spacing;
- long-token, task-list, and code-block horizontal containment;
- title derivation across marks, list items, and Unicode truncation;
- Markdown and text export structure preservation.

## Deliberately not changed

No known functional bug from the audited scenarios was left unfixed.

Rich-text color, highlight, and alignment do not appear in Markdown or plain
text because those output formats have no reliable representation for them.
Unsupported non-text media remains outside the plain schema because the task
explicitly prohibits adding ProseMirror node types.

## Verification

- `npx tsc --noEmit && npm test`: passed.
- Full suite: 24 files and 222 tests passed.
- Screenplay pagination parity plus undo integrity: 45 tests passed unchanged.
- `npm run build` was not run because this sandbox has restricted network
  access and the known Google Font fetch is expected to fail offline.
- No development server was started, as instructed.

## Human browser review

Claude should visually check the continuous paper shadow and bottom padding at
desktop and narrow widths, focus-mode dimming, caret scrolling near the end of a
very long document, 11 px and 32 px font settings across every font family, and
the exact rhythm of every adjacent block combination. Actual paste from Word
and a browser should also receive one visual pass because jsdom verifies the
stored document structure but cannot measure browser layout.
