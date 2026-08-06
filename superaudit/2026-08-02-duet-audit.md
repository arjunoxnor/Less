# Audit: duet (link collaboration), client and worker

Duet shipped hours ago and has had one browser smoke test. It handles OTHER
PEOPLE'S text over a network, so a bug here can destroy work that is not even
the owner's. Read every line of it.

Scope, and nothing outside it: `duet/` (the Cloudflare Worker and its Durable
Object), `lib/collab/`, `components/DuetShareModal.tsx`, and only the duet
paths inside `components/ScreenplayBody.tsx`, `components/AppShell.tsx` and
`components/chrome/TopBar.tsx`.

House style: no em dashes, no emojis, no exclamation marks. Comments say why.

## What must be true

1. No sequence of events may lose or duplicate a writer's text. Two people
   typing in the same paragraph, one offline then reconnecting, a guest
   joining mid-edit, the owner reloading, both leaving and returning.
2. The document is seeded exactly once, by the owner, only into a room with no
   content AND no Yjs history. Verify the guard cannot be defeated by a race:
   two owner tabs opening at once, a slow sync, a reconnect mid-seed.
3. The local last-write-wins cloud sync stays completely inert for a shared
   document, on every path.
4. The room survives eviction. A hibernating Durable Object can be evicted
   between messages: prove the snapshot and restore path is correct, that a
   snapshot is never written from a partially-applied state, and that a debounced
   snapshot cannot be lost when the last client disconnects.
5. Awareness (presence) is never persisted and cannot grow without bound.
6. A revoked token cannot be used to read or write. An already-connected guest
   must be cut off, not merely blocked from reconnecting.
7. Protocol robustness: a malformed message, a truncated frame, an enormous
   update, a client sending awareness for another client id, and a token that
   is the right length but was never issued.
8. The connection rate limit cannot be trivially bypassed and does not lock
   out a legitimate reconnecting writer.

## Definition of done

Every real bug fixed with a regression test that fails before and passes
after. `npx tsc --noEmit && npm test` pass, and `duet/` typechecks with
`npx tsc --noEmit -p duet/tsconfig.json`. Report at
`superaudit/2026-08-02-duet-audit-report.md` with one-line reproductions
ranked by severity.
