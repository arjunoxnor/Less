# Films home: build spec (v5 design, approved 2026-07-21)

The approved design is the fifth-pass sketch (three altitudes). This spec maps
it onto the existing code and data. The data model, localStorage shapes, cloud
API, and sync are FROZEN: this is a reinterpretation layer plus new chrome.
The interactive sketch lives in the session scratchpad (less-desk-proposal.html)
and is the visual authority for both screens; app/tokens.css is the styling
authority. No em dashes, emojis, or exclamation marks anywhere.

## The reinterpretation (lib, pure functions, unit-tested)

New module `lib/storage/films.ts` (read-only selectors over existing data):

- A FILM is either:
  - a top-level folder (data unchanged: folders stay folders in storage/sync).
    Contents = every project whose effective folder chain roots at it (nested
    folders flatten into it, orphan-safe), or
  - an IMPLICIT film: a loose screenplay project (folderId null). One line on
    the home; no folder exists for it in data.
- Per film derive: currentDraft (most recently updated screenplay in it),
  earlierDrafts (other screenplays, updatedAt desc), documents (plain projects,
  updatedAt desc), lastTouched (max updatedAt), color (folder color, or the
  muted token for implicit films), status (currentDraft status, else "not_started").
- IDEAS = loose plain projects (folderId null), updatedAt desc.
- Films order: lastTouched desc. The first film is the LEAD.
- A folder containing zero screenplays is still a film (a film without a
  script yet); its page shows Documents plus a "Start the script" affordance.

Unit tests (vitest, node env) for the selectors: nesting flattens, orphan
folderIds are loose, implicit films, lead selection, empty-folder film,
ideas exclusion of filed docs.

## Altitude 1: the home (ProjectsHome.tsx rewritten in place)

Per the sketch: max-width 760px column on the desk background.

- Top bar unchanged in structure: wordmark, search ("Search everything"),
  overflow (theme radios), avatar menu, solid-ink New menu. New menu items:
  New script, New document, Import files. (Folders are never created by hand
  anymore; they materialize.)
- Band label FILMS, then one .film block per film:
  - lead film: "Now writing" eyebrow, name at 30px, state line with
    "Continue <draft title> on page <pageCount>" (bold, ink), the draft's
    first scene line in Courier 12px, relative time. Clicking anywhere on the
    lead opens the current draft in the editor.
  - other films: name 20px 700 with the color mark (18x4px radius 2), state
    line: status dot+word, pages of current draft, "N documents" (docs count,
    omit when 0), relative time. Click: folder films open the project page;
    implicit films open the editor directly.
  - film hover: surface wash; kebab on hover/focus: Rename, Color (folder
    films), Delete (hold pattern inside the existing confirm modal is fine),
    and for implicit films: Rename/Delete of the script itself.
- Band label IDEAS, then idea lines (title 15px 500, relative time right),
  draggable; kebab: Open, Make this a film, Delete.
  - The jot input (borderless, hairline underline): Enter creates a loose
    plain project with the typed text as its TITLE and an empty body, stays on
    the home, clears the input, no navigation. Toast none (the line appearing
    is the feedback).
- Drag and drop: an idea line dragged onto a film files it into that film's
  folder (implicit films MATERIALIZE: create a folder named after the script,
  file the script and the idea into it, reusing existing createFolder/
  updateFolder/setFolder handlers so clocks stamp correctly). Films accept the
  drop with the surface-2 wash + mark stretch from the sketch. No caret needed
  at the home altitude (order within a film is not set here).
- Search filters across films (name), drafts, documents, and ideas (titles);
  while searching show flat result lines (title + kind word + film name chip)
  and hide the bands.
- Empty states: no films and no ideas: the cold-visit seed already lands in
  the editor, so the home only ever shows with content; a films band with
  nothing shows nothing (no banner), ideas band always shows the jot line.
- Delete the sidebar, folder tree, folder cards, sort menu, and their CSS
  (grep-proven) once the new home lands. Relative times keep the 60s refresh.

## Altitude 2: the project page (new components/ProjectPage.tsx)

Route: #/f/<folderId> (AppShell view state + hash routing beside #/p/<id>).
Back chevron "Films" returns home. Guard: unknown folderId goes home.

- Header: color mark + FILM kicker (no kind taxonomy), name at 34px (inline
  rename committing through the existing folder rename), meta line:
  "Continue <draft> on page N" (bold, opens editor), status word, edited time.
- Band SCRIPT: the current draft line (title 17px 600, first scene line in
  Courier, status/pages/time right), then "Earlier drafts (N)" as a quiet
  line that expands in place to the older drafts. Band DOCUMENTS: doc lines
  (15px 500, time right). Every line opens its project in the editor. Kebabs
  reuse existing row actions (Rename, Duplicate, Export, Move to, Delete).
- "New draft" in the page's top bar: New menu scoped to this film (New draft
  = screenplay filed here; New document = plain doc filed here).
- A project-scoped jot: "Add a note to <name> and press Enter" creating a
  filed plain doc.
- Drag: reorder within bands via the existing order/reorder machinery with
  the caret-row drop indicator from the sketch (2px ink line). Dragging a doc
  out is not needed at v1 (Move to covers it).

## Altitude 3: the editor Documents panel

- New rail icon "Docs" (file glyph) between Scenes and Cast for SCREENPLAY
  editors whose project is in a folder (or implicit: show with just drafts).
  Panel lists the film's other items grouped Script drafts / Documents,
  current one marked; clicking saves-and-switches via the existing
  openProject flow (flush runs on unmount already). PlainBody gets the same
  panel so an outline can jump back to the draft.

## Migration and safety

- No data migration. Nested folders flatten only in the VIEW; data unchanged.
- Sync untouched: folders/projects push and pull exactly as today.
- The one write-path addition (materializing a folder for an implicit film)
  uses only existing handlers.
- Gate: tsc, ALL existing tests plus the new selector tests, build.

## Deploy for the rehearsal (do not touch main)

- Branch `films-home` from main; commit there.
- Deploy: `npx wrangler pages deploy --branch=films-home` after a fresh build
  with NEXT_PUBLIC_GOOGLE_CLIENT_ID exported (secrets/less-google.env maps
  GOOGLE_OAUTH_CLIENT_ID; next.config inlines it).
- Verify on the preview URL: app loads, /api/scripts returns 401 JSON (not a
  binding error) unauthenticated, sync-code linking works.
- Production main and less.oxnorhub.com stay untouched until Arjun approves
  the preview in use.
