# LESS — Last Ever Screenwriting Software

A free, fast, web-based screenwriting app that respects your time and never holds
your scripts hostage. Simple, reliable, the opposite of bloated subscription
software that crashes.

Live at [less.oxnorhub.com](https://less.oxnorhub.com). No account required to
start writing; an optional sign-in syncs across devices.

## What it does

- A full screenplay editor: the six standard elements, smart Enter / Tab /
  Cmd-number behavior, auto-uppercasing, real rule-aware pagination shown as
  live page sheets, dual dialogue, title page, scene numbers, and focus mode.
- Plain rich-text documents too (outlines, notes), alongside screenplays, filed
  into folders on a projects dashboard.
- Export to PDF, Fountain, and FDX; import from Fountain, FDX, and Word / ODT /
  RTF / Markdown / plain text (a prose file comes in as a plain document, a
  script as a screenplay).
- Navigation and production tools: scene navigator, character/location
  autocomplete, find & replace with rename-a-character, cast and location
  reports, revision marks, script notes, and a production breakdown.
- Local-first: every keystroke saves to your browser instantly. Signing in
  layers cloud sync on top so the same script follows you across devices.

## Tech

- **Next.js 16** (App Router), built as a static export.
- **TipTap 3** (ProseMirror) editor; ProseMirror JSON is the source of truth.
- **Cloudflare** for the backend: one Pages Function (`functions/api/[[path]].ts`)
  over a **D1** database, plus **Pages** hosting. Auth is Google sign-in (a
  verified ID token exchanged for a 30-day session) or a private sync code.
- Deployed by a GitHub Action on every push to `main`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000 (editor only; the API needs wrangler)
npm run typecheck  # type-check without building
npm run test       # unit tests (sync decision logic)
npm run build      # production build (static export)
```

`next dev` serves the app but not the `/api` layer. To exercise the full stack
(sign-in, cloud sync) locally, run it under `wrangler pages dev` so the Pages
Function and D1 binding are present.

## Where things live

| Area | Files |
| --- | --- |
| Element model (start here) | `lib/editor/elements.ts`, `lib/editor/screenplayLine.ts`, `lib/editor/keymap.ts` |
| Editor assembly | `lib/editor/buildExtensions.ts`, `components/ScreenplayBody.tsx`, `components/PlainBody.tsx` |
| Pagination | `lib/export/paginate.ts` + `layout.ts` (the rules and the PDF; Final Draft / Arc Studio format, checked page for page against a real Arc Studio export in `paginateArc.test.ts`), `lib/export/splitRules.ts` (speeches break only at a sentence end), `lib/editor/pagination.ts` (the same rules on screen, reflowed in the same frame as the keystroke with the caret held still) |
| Import / export | `lib/export/*` (fountain, fdx, pdf, docImport, flatten, titlePage) |
| Local storage | `lib/storage/projects.ts`, `lib/storage/localStore.ts`, `lib/storage/folders.ts` |
| Cloud sync | `lib/storage/useProjects.ts` (dashboard reconcile), `lib/storage/useCloudSync.ts` (open doc), `lib/storage/lww.ts` and `lib/storage/syncBaseline.ts` (tested decision logic: who wins between an open doc and a cloud copy written elsewhere), `lib/cloud/*` |
| Boards (images) | `lib/editor/boardNodes.ts` (image with caption, image grid, palette; board documents only), `components/BoardTools.tsx`, `lib/cloud/assets.ts` (shrink and upload), `lib/server/assets.ts` (the upload rules, tested), `migrations/d1/0005_assets.sql`, the `IMAGES` KV namespace |
| Outside edits | `tools/write/write.ts` (`npm run write`): how a Claude Code session reads and replaces a document body safely (guarded on the timestamp it read, both versions kept in History) |
| API | `functions/api/[[path]].ts`, `migrations/d1/*` |

## Keyboard

`Mod` = Cmd on Mac, Ctrl on Windows/Linux.

| Key | Action |
| --- | --- |
| `Enter` | New line; type follows the flow (after a Character cue, drop into Dialogue) |
| `Tab` / `Shift+Tab` | Cycle the current line's element type forward / back |
| `Mod+1` .. `Mod+6` | Scene heading, action, character, dialogue, parenthetical, transition |
| `Mod+E` | Open the line-type menu from the status bar |
| `Mod+D` | Toggle dual (side-by-side) dialogue |
| `Mod+F` | Find and replace (opens in the dock) |
| `Mod+K` | Command palette |
| `?` | Keyboard shortcuts overlay (outside text fields) |
| `Esc` | Close the open dock panel, then exit focus mode |

Focus mode extras: mouse to the top edge to peek the top bar; the
"Typewriter scrolling" toggle (overflow menu or palette) keeps the caret
line vertically centered while you write.

## Audits

Findings from the periodic superaudit live in `superaudit/`. The most recent
report is the ranked plan for what to fix next and why.
