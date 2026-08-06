# Line-by-line audit: the screenplay editor and everything it touches

The document editor was just audited end to end and yielded 13 real bugs,
including one where pressing Enter did nothing and one where a sibling tab
could overwrite unsaved edits. The screenplay editor is the larger and older
half of this app and has never had the same treatment. Do it now.

House style: no em dashes, no emojis, no exclamation marks, in code, copy or
comments. Comments say why, not what.

## Frozen contracts

- `functions/api/**`, `migrations/**`, the root `wrangler.toml` and `duet/`
  do not change.
- No existing localStorage key changes shape. Additive optional fields only.
- No new ProseMirror node types. One `screenplayLine` node with an `element`
  attribute stays the schema.
- `app/layout.tsx` loads Montserrat and Jost from next/font/google on purpose.
  An offline build failing on those fetches is expected. Do not change it.

## Method

Read each file completely, top to bottom, before changing anything in it. Do
not grep for the part you expect to change. For every function ask what
happens at the boundaries: empty document, single character, first line, last
line, a range selection spanning blocks, a dual-dialogue cluster, and while
the autocomplete menu is open.

## The surface, in priority order

1. `components/ScreenplayBody.tsx`. The largest file in the app. Every
   callback, every effect, every dependency array. Stale closures, effects
   that write on mount, listeners never removed, state that disagrees with the
   document after an undo.
2. `lib/editor/` in full: `keymap.ts`, `autoCaps.ts`, `autoElement.ts`,
   `autocomplete.ts`, `smarttype-catalogs.ts`, `contd.ts`, `revisions.ts`,
   `spellcheck.ts`, `spellEngine.ts`, `outline.ts`, `useOutline.ts`,
   `breakdown.ts`, `breakdownMarks.ts`, `useBreakdown.ts`, `findPlugin.ts`,
   `renameCharacter.ts`, `renameLocation.ts`, `pagination.ts`,
   `screenplayLine.ts`, `elements.ts`, `docUtils.ts`.
3. `lib/export/` in full, both directions: `paginate.ts`, `pdf.ts`,
   `fountain.ts`, `fdx.ts`, `docImport.ts`, `flatten.ts`, `layout.ts`,
   `pageLock.ts`, `titlePage.ts`, `index.ts`. Round-trip every format:
   export then import must not change the document.
4. `lib/storage/`: `projects.ts`, `useProjects.ts`, `useCloudSync.ts`,
   `lww.ts`, `localStore.ts`, `folders.ts`. Anything that can lose a
   character, drop a project, or resurrect a deleted one.
5. The panels: scene navigator, cast, reports, notes, breakdown, find and
   replace, history. Each against an empty document and a large one, and
   after the document changes underneath them.

## Scenarios that must not break anything

- Find and replace across every element, with a selection, with regex-looking
  text, replacing all in a 120-page script, then undo.
- Rename a character everywhere when the name is a substring of another name,
  appears in dialogue and in action, and has a (V.O.) extension.
- Revision marks on, edit, off, edit again, then export.
- Page locking, then inserting a scene mid-script, then exporting.
- Import a Fountain, FDX, Word and RTF file that was written elsewhere, then
  export it back out and compare.
- A 200-page script: typing latency, scrolling, the outline staying correct.
- Spell check with a large user dictionary and non-English characters.
- Every panel open in turn while typing continues.

## Definition of done

- Every real bug fixed with a regression test that fails before and passes
  after. Editor tests use the headless kit in `lib/editor/testKit.ts`.
- `npx tsc --noEmit && npm test` pass. The existing suites must all still
  pass, in particular pagination parity and undo integrity.
- A report at `superaudit/2026-08-02-screenplay-audit-report.md` listing every
  bug with a one-line reproduction, the fix, and the test, ranked by how
  likely a working writer is to hit it.
- Anything found and deliberately not fixed is listed with the reason.
