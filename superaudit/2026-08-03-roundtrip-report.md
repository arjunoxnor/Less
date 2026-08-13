# Adversarial import/export round-trip report

Date: 2026-08-05

Scope: `lib/export/**`, plus this required report. No git commands, network access,
or development server were used.

## Fixed findings

### High: silent content or semantic loss

1. **Fountain dialogue beginning with control syntax changed type or lost text.** Reproduction: export a cue whose dialogue starts with `.45`, `#tag`, `>there`, `@home`, `!bang`, `~hum`, or `=beat`, then import it. Fix: escape leading control syntax and unescape it only after element classification. Regression: `adversarialRoundtrip.test.ts` hostile Fountain round trip and deterministic fuzzing.

2. **Literal Fountain notes and boneyards were deleted from screenplay text and title fields.** Reproduction: export Action or a title containing `[[literal]]` or `/*literal*/`, then import it. Fix: protect exporter-authored openers while continuing to remove actual external notes and boneyards. Regression: hostile body and title round trips.

3. **A fully parenthesized spoken line came back as Parenthetical.** Reproduction: export Dialogue text `(this is spoken text)` beneath a cue, then import it. Fix: force ambiguous dialogue with the Fountain lyric marker and retain the active dual column. Regression: hostile Fountain round trip, including right-column dialogue.

4. **Empty Dialogue in a dual right column lost its dual flag.** Reproduction: export a dual cue followed by an empty Dialogue line, then import it. Fix: the empty-dialogue sentinel now inherits the active dual cluster. Regression: hostile Fountain round trip.

5. **Literal terminal cue carets changed dialogue into dual dialogue and lost the caret.** Reproduction: export Character text `@ÉLODIE ^` without the dual flag, then import it. Fix: escape terminal carets and recognize only an unescaped terminal caret as Fountain dual syntax. Regression: hostile Fountain round trip.

6. **Backslash-plus-caret and backslash-plus-angle text defeated the first terminal-marker escape.** Reproduction: export Character text `BACKSLASH \^` or Transition text ending `\<`, then import it. Fix: double literal backslashes before adding syntax escapes and decode the pairs afterward. Regression: hostile Fountain round trip and randomized backslash tokens.

7. **A Transition ending in `<` came back as centered Action.** Reproduction: export Transition text `END<`, then import it. Fix: escape a literal terminal angle bracket and test centered syntax for an unescaped terminator. Regression: hostile Fountain round trip.

8. **A leading Action that resembled title metadata was consumed as a title page.** Reproduction: export a script whose first Action is `Title: not metadata`, then import it. Fix: force recognized title-key Actions as body text. Regression: hostile Fountain round trip and seeded fuzzing.

9. **FDX body paragraphs lost leading and trailing whitespace.** Reproduction: round-trip FDX Action text `  spaces stay  ` or tab-delimited Dialogue. Fix: stop trimming Final Draft body `<Text>` runs. Regression: exact FDX whitespace test.

10. **FDX export silently deleted XML 1.0-forbidden characters.** Reproduction: export FDX Action text `before\0after`. Fix: reject controls and lone surrogates with a clear error instead of creating a different script. Regression: forbidden-character test.

11. **FDX scene numbers were silently discarded.** Reproduction: import `<Paragraph Type="Scene Heading" Number="A12">`, edit nothing, and export FDX or PDF. Fix: carry the number in Fountain's `#A12#` interchange suffix, restore the FDX `Number` attribute, and print `A12` in both PDF margins without printing the suffix in the heading. Regression: real nested FDX fixture and PDF margin-line test.

12. **Invalid UTF-8 was silently replaced with U+FFFD.** Reproduction: import a Fountain file or zipped DOCX XML containing byte sequence `C3 28`. Fix: use fatal UTF-8 decoding for text screenplay formats and ZIP XML. Regression: real invalid-byte Fountain and DOCX fixtures.

13. **NUL-bearing Fountain and RTF input could enter the document as invisible content.** Reproduction: import `INT. \0X` from a named Fountain or RTF file. Fix: reject NUL bytes with a specific safe-read error. Regression: real NUL fixture through the public importer plus direct parser checks.

14. **Unbalanced RTF groups could silently ignore or mis-scope the rest of the script.** Reproduction: import `{\rtf1 A\par {missing close`. Fix: detect unmatched opening and closing braces and reject the malformed RTF. Regression: real unbalanced RTF fixture.

15. **DOCX, ODT, and RTF import collapsed significant paragraph whitespace.** Reproduction: import styled Action text containing two spaces, a tab, NBSP, and a combining mark. Fix: normalize a copy only for heuristic classification while preserving the original paragraph value. Regression: real office-payload whitespace test.

### Medium: hostile structure, Unicode layout, and PDF boundaries

16. **Deep wrapper elements inside FDX Content silently hid valid Paragraphs.** Reproduction: place valid Paragraphs beneath 256 nested wrapper elements inside the body Content. Fix: walk body wrappers iteratively in document order and avoid recursive stack growth. Regression: real 256-level FDX fixture.

17. **Non-Final-Draft XML was accepted as an empty FDX document.** Reproduction: pass `<root><Content>...</Content></root>` to the FDX parser. Fix: require the root element to be `FinalDraft`. Regression: covered by malformed/hostile XML validation.

18. **A leading BOM could turn the first Fountain scene heading into Action.** Reproduction: parse `BOM + INT. ROOM - DAY` directly. Fix: strip one leading BOM before title and element detection. Regression: mixed-line-ending fixture plus direct BOM case.

19. **PDF wrapping could split a surrogate pair or combining sequence at a column boundary.** Reproduction: wrap a 35-column Dialogue word containing emoji or `e` plus a combining accent. Fix: wrap and align by grapheme clusters instead of UTF-16 code units. Regression: exact-column and long Unicode speech line-data tests.

20. **Long lower title-page fields could run below the page, and a long draft date was not wrapped.** Reproduction: export a title page with several hundred characters in Contact or Draft date. Fix: wrap all title fields, grow lower blocks upward from their final row, and expose pure title-page line data for boundary assertions. Regression: long-field line-data test and generated/reloaded PDF test.

21. **DOCX import inflated the same archive twice.** Reproduction: import a large DOCX and observe a full unzip for `document.xml` followed by another for `styles.xml`. Fix: unzip once and decode both requested entries from the same archive. Regression: the 1,000-document office fuzz pass exercises the shared path.

## Deliberate, tested limitations

1. **Fountain notes, boneyards, sections, synopses, and page breaks remain non-body data.** Reproduction: import `[[note]]`, `/* old */`, `# Section`, `= Synopsis`, or `===`. Not fixed because the frozen six-element screenplay schema has no node or attribute for these constructs; comments and outline controls are explicitly omitted, with the loss pinned by a regression test rather than occurring accidentally.

2. **Centered Fountain text maps to Action and does not retain a centered flag.** Reproduction: import `>CENTERED<`, export it, and compare the formatting marker. Not fixed because the frozen screenplay-line schema has no centered attribute; the visible text is preserved as Action.

3. **Fountain treats outer line whitespace as insignificant.** Reproduction: round-trip a cue or transition with leading or trailing ASCII spaces. Not fixed because those spaces participate in Fountain block syntax and are not portable screenplay content; significant internal whitespace is preserved, while FDX and office import now preserve paragraph whitespace exactly.

4. **Revision-pass flags are not portable in Fountain or FDX.** Reproduction: export a `revised: true` line to either text interchange format and import it. Not fixed because revision state is LESS production metadata, not one of the portable screenplay elements; PDF revision stars remain supported.

5. **External unlabeled FDX title pages are necessarily heuristic.** Reproduction: import an FDX title page containing several unlabeled centered paragraphs with no positional metadata. Not fixed because the file does not identify which paragraph is Author versus Credit or Source; LESS-authored FDX files use harmless `LESSField` metadata and round-trip every field exactly.

6. **The vendored Courier Prime font does not cover all CJK, RTL, or emoji glyphs.** Reproduction: export PDF dialogue containing a glyph absent from Courier Prime while the built-in fallback is active. Not fixed because adding a broad Unicode font asset is outside the `lib/export` scope; pagination and line data remain grapheme-safe, export never crashes, and unsupported fallback glyphs are represented by `?` rather than truncating the file.

7. **DOCX, ODT, and RTF have importers but no product exporters.** Reproduction: look for those choices in `ExportFormat`. Not a round-trip bug in an implemented pair; the audit uses real test writers to generate 1,000 schema-valid payloads per office-format pass and verifies lossless import.

## Fixture and stress coverage

- Real fixtures under `lib/export/fixtures/`: BOM plus mixed-CR Fountain, 256-level FDX, DOCX without `styles.xml`, ODT automatic styles, ANSI RTF Unicode escapes, malformed and mismatched XML, invalid UTF-8 text and ZIP XML, NUL text, and unbalanced RTF.
- Unicode coverage: accents, CJK, Hebrew and Arabic, emoji, combining marks, Deseret outside the BMP, smart punctuation, and alphanumeric scene numbers across headings, cues, dialogue, action, title metadata, and PDF line data.
- Scale coverage: a 10 MiB Fountain action and 50,000 ordered Fountain elements.
- Fuzz coverage: 2,000 seeded schema-valid documents through Fountain, FDX, and PDF pagination; 1,000 seeded styled Unicode documents through real DOCX, ODT, and RTF payloads.
- PDF coverage: multi-page speech with `(MORE)` and `(CONT'D)`, transition on the last printable baseline, empty and long title pages, scene-number margins, dual dialogue, and grapheme-safe exact-column wrapping.

## Gate

- `npx tsc --noEmit`: passed.
- `npm test`: passed, 40 files and 397 tests.
- Exact combined command `npx tsc --noEmit && npm test`: passed.
