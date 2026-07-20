# F16 in-browser acceptance run (Task 14 monologue E2E)

Date: 2026-07-20. Environment: `next dev` on localhost:3000, Chromium via the
Claude browser pane, viewport 1280x720, macOS. This records the DOM half of the
F16 acceptance criterion that the jsdom parity suite
(`lib/export/paginateParity.test.ts`) cannot cover: Range.getClientRects line
boxes, the caret-coordinate binary search, and the widget decorations. The
staged design and criterion are in `superaudit/2026-07-01.md` ("F16 staged").

## Monologue acceptance (the staged criterion)

Document under test, seeded through the app's own storage key
(`less:project:<id>:doc`) and opened from the dashboard:

    scene_heading  INT. LECTURE HALL - NIGHT
    action         10 ten-char words  (2 rendered rows)
    character      PROFESSOR VANCE
    dialogue       180 ten-char words (60 rendered rows)
    scene_heading  INT. CORRIDOR - NIGHT
    action         5 ten-char words   (1 row)
    character      PROFESSOR VANCE
    dialogue       30 ten-char words  (10 rows)

Observed on screen:

- Status bar: "Page 1 of 2". Exactly one `.pm-split` widget, hosted inside the
  60-row dialogue block, children in order: `.pm-split-more` = "(MORE)",
  `.pm-split-gap` (the page gap), `.pm-split-contd` = "PROFESSOR VANCE
  (CONT'D)". Page 1 ends with (MORE) at the dialogue indent; page 2 opens with
  the cue-indented PROFESSOR VANCE (CONT'D) and the continuation lines.
- Caret page indicator flips to "Page 2 of 2" when the caret sits in the
  continuation below the split.

Exported PDF for the same lines, generated through the production pipeline
(`exportPdf` in `lib/export/pdf.ts`, page count read back with
`PDFDocument.load`): **2 pages**, one "(MORE)" op and one "PROFESSOR VANCE
(CONT'D)" op. Screen and PDF agree: 2 pages each. Criterion met.

## Boundary typing (no flicker)

With the caret in the dialogue just above the split: single keystrokes and a
5-character burst were typed while a 50ms DOM sampler counted `.pm-split`
nodes and a MutationObserver counted widget insert/remove churn.

- The split widget was present in every sample (never disappeared between
  passes; no visual flicker at the boundary).
- The 5-character burst coalesced into a single recompute (2 widget redraw
  cycles total: one from ProseMirror redrawing the edited block, one from the
  single decoration dispatch). Under the pre-fix signature-order bug the same
  burst produced a dispatch per convergence pass (the passes cap) every
  keystroke; the canonicalized signature (`joinSig`, pinned by
  `lib/editor/paginationSig.test.ts`) settles it in one dispatch plus one
  confirming pass.
- Page pill stayed at "Page 1 of 2" throughout. No console errors.

## Wrapped-transition flow split (parity fix, task 14 follow-up)

Seeded a 50-row action followed by a 73-char transition (wraps to 2 rows) so
the transition straddles the page bottom:

- Screen: one `.pm-split` widget (gap only, no MORE/CONT'D) hosted inside the
  `.sp-transition` block. Page 1 ends with the transition's first row "SMASH
  CUT TO THE LONGEST AFTERMATH ANYONE IN TOWN EVER" right-aligned at the page
  bottom; page 2 opens with "REMEMBERS SEEING:". Status bar "Page 1 of 2".
- Export engine for the same lines: pageCount 2, startLines [0, 2], page 1's
  last op and page 2's first op are those exact rows. Row-for-row agreement.

## Not covered here

Arrow-key caret travel across the widget could not be driven by this harness
(synthetic key events do not move the caret); it was exercised by hand in the
review session of 2026-07-19 (arrow navigation crosses the
(MORE)/gap/(CONT'D) widget cleanly in both directions, no stalls). The
Playwright version of this run is scheduled with the Phase 5 task 16 E2E
suite.

Test data was removed after the run (the app re-seeds its sample script on the
next visit).
