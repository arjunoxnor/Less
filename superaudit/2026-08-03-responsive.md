# Audit: small screens, zoom, print and visual correctness

Scope: `app/globals.css`, `app/tokens.css`, and the RENDERING of existing
components only. Do not change component logic, `lib/`, or `duet/`: other
audits own those. If a visual defect requires a logic change, report it rather
than making it.

## What to check

1. Every screen at 320, 375, 768, 1024, 1440 and 2560 CSS pixels wide, in both
   themes: the home, the editor with and without a panel, the document editor,
   every modal, every menu, the share dialog, and the status bar. Nothing may
   overflow horizontally, overlap, or become unreachable.
2. Browser zoom at 50%, 200% and 400%, and the OS text-size setting increased.
   Layout must reflow rather than clip. At 400% the app must still be usable,
   which is a WCAG requirement.
3. Touch: every control at least 44 by 44 CSS pixels or given adequate
   padding, no hover-only affordance that a touch user cannot reach, and drag
   and drop either working by touch or having a documented menu alternative.
4. Print: the screenplay page sheets and the document sheets must print
   sensibly, with no chrome, no dark background burning ink, and page breaks
   at the sheet boundaries.
5. Reduced motion, forced colours and high contrast: honour
   prefers-reduced-motion, and do not rely on colour alone to convey state.
6. Contrast: every text and icon colour against its real background in both
   themes must meet WCAG AA. Report anything that fails with the measured
   ratio.
7. Dead CSS: rules whose selectors match nothing, and duplicated or
   contradictory declarations. Remove them, proving each is unused.

## Definition of done

`npx tsc --noEmit && npm test` pass. Report at
`superaudit/2026-08-03-responsive-report.md` listing every fix, and every
measured contrast failure with its ratio.
