# Audit: the home, the chrome and the UI primitives

Scope, and nothing outside it: `components/ProjectsHome.tsx`,
`lib/storage/library.ts`, `lib/storage/libraryInteraction.ts`,
`components/chrome/**`, `components/ui/**`, `components/AppShell.tsx`,
`components/DocsPanel.tsx`. Do NOT touch `lib/editor/`, `lib/export/`,
`duet/`, `lib/collab/`, or the plain-document parts of `app/globals.css`:
other audits own those and their work would be clobbered.

House style: no em dashes, no emojis, no exclamation marks. Comments say why.

## What to look for

1. React correctness: stale closures in callbacks and effects, missing or
   wrong dependency arrays, state that disagrees with storage after an
   external change, listeners and timers never cleaned up, and any effect that
   writes on mount.
2. The library model against hostile data: a folder that is its own ancestor,
   a project pointing at a deleted folder, duplicate ids, thousands of
   folders, names that are empty, whitespace, or 10,000 characters, and
   folders nested twenty deep.
3. Drag and drop, every combination: dragging while a rename is open, while a
   menu is open, dropping outside any target, dropping on the thing being
   dragged, dropping during a re-render, two drags started in quick
   succession, and a drop after the target was deleted in another tab.
4. Keyboard and accessibility: every interactive element reachable and
   operable by keyboard, focus never lost or trapped, focus restored after a
   modal or menu closes, aria state that matches reality, and the Escape order
   when several layers are open.
5. Modals, menus and toasts: opening one from another, closing out of order,
   the hold-to-delete timer surviving an unmount, and a toast outliving the
   thing it describes.
6. Cross-tab: two tabs open on the home, one renames or deletes, the other
   must not show or act on stale data.

## Definition of done

Every real bug fixed with a regression test that fails before and passes
after. `npx tsc --noEmit && npm test` pass. Report at
`superaudit/2026-08-02-shell-audit-report.md` with one-line reproductions
ranked by how likely a real writer is to hit each one.
