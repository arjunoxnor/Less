# Audit: import and export round-trips against real-world files

A screenwriter's files come from Final Draft, Highland, Fade In, WriterDuet,
Word and Google Docs. If an import quietly changes a script, the writer loses
work without ever seeing an error. A previous audit fixed many of these; this
pass is the adversarial one.

Scope: `lib/export/**` only. Do not touch `lib/editor/`, `components/`,
`duet/`, `lib/collab/` or `lib/storage/`: other audits own those.

## Method

Build fixtures rather than reasoning abstractly. Write real Fountain, FDX,
DOCX, ODT and RTF payloads into test fixtures, including deliberately hostile
ones, and assert the round-trip.

## What must hold

1. Round-trip identity: doc -> export -> import -> doc must preserve every
   element type, every character, and every ordering decision. Where a format
   genuinely cannot carry something, the loss must be documented and tested,
   not accidental.
2. Hostile inputs must not crash, hang, or silently truncate: a 10MB script,
   50,000 lines, deeply nested FDX, malformed XML, mismatched tags, a DOCX
   with no styles.xml, an RTF with unbalanced braces, invalid UTF-8, a BOM,
   CRLF and lone CR line endings, and NUL bytes.
3. Unicode throughout: accented names, CJK, right-to-left text, emoji in
   dialogue, combining marks, and characters outside the basic plane, in
   scene headings, cues, dialogue and title pages.
4. Screenplay semantics: dual dialogue, (MORE) and (CONT'D), scene numbers,
   forced elements, notes, boneyard comments, sections and synopses, centered
   text, and page breaks.
5. The PDF: it is the deliverable. Assert its line data for a long speech
   split across pages, a transition at a page bottom, a title page with empty
   and with very long fields, and a script whose every line is at the column
   limit.
6. Fuzzing: generate thousands of random but schema-valid documents, round
   trip each through every format, and assert no crash and no content loss.

## Definition of done

Every real bug fixed with a regression test. `npx tsc --noEmit && npm test`
pass. Report at `superaudit/2026-08-03-roundtrip-report.md` with a one-line
reproduction per finding.
