# Duet audit report

Date: 2026-08-05

Scope: `duet/`, `lib/collab/`, `components/DuetShareModal.tsx`, and the Duet paths in `components/ScreenplayBody.tsx`, `components/AppShell.tsx`, and `components/chrome/TopBar.tsx`.

## Fixed bugs, ranked by severity

| Severity | One-line reproduction | Resolution |
| --- | --- | --- |
| Critical | Open two owner tabs against an empty room, let both finish sync, and each tab imports the local screenplay as a distinct Yjs history, duplicating the draft when the updates merge. | Replaced client-side seeding with an owner-authenticated seed frame serialized by the Durable Object; only the first seed against a document with no content or history is applied, persisted, acknowledged, and relayed. |
| Critical | Issue the room, then let a guest write in the interval before the owner's seed arrives, creating history that permanently blocks the owner draft from seeding. | Guest upgrades now receive a retryable 425 response until the owner seed or restored Yjs history has been durably stored. |
| Critical | Apply an update, return from the WebSocket event, and evict the Durable Object before the two-second JavaScript timer fires, losing the accepted text. | Removed timer-only persistence; every changed document is durably snapshotted before any reply or relay. |
| Critical | Let a delayed older snapshot and a last-client flush overlap so the older storage write finishes last and rolls the room back. | All document mutation, persistence, revocation, connection initialization, and close handling now share one serialized operation queue. |
| Critical | Type while offline, wait for the JSON mirror, reload before reconnecting, and let the new empty Y.Doc sync over the unsent edit. | Added per-session local Yjs snapshots that merge by CRDT identity before reconnecting; independent offline-tab snapshots are kept in separate keys and merge without duplicating text. |
| Critical | Start sharing while the same project is already open in another tab, leaving that tab's local LWW reconcile, pending push, title patch, or status patch active against the shared project. | Share-record events now move every open tab into Duet mode; the transition render disables LWW sync and changes its reconcile key before teardown, and shared title or status paths no longer call local cloud metadata writers. |
| High | Make the document storage write fail after applying an update, then let a later sync reply expose that in-memory update even though eviction would erase it. | A failed persistence resets the in-memory document to the last durable snapshot and closes every socket before any reply or relay can expose the failed state. |
| High | Revoke a room, evict the object, and deliver a queued message from a hibernating guest after the new instance has forgotten the in-memory `revoking` flag. | Every rehydrated message path checks the durable revoked marker inside the serialized room operation, and revocation closes all connected sockets after the marker is stored. |
| High | Send a framed but malformed Yjs update; `readSyncMessage` swallows the decode error and the Worker treats the frame as a valid changed document and relays it. | Sync subtypes, lengths, state vectors, trailing bytes, and Yjs update structure are validated before the live document is mutated. |
| High | Connect to any random 43-character room token with no owner credential and read or write the newly created empty room. | A room exists only after a valid owner credential issues it; correctly shaped but unissued guest tokens return 404. |
| High | Race two different first-owner credentials through separate fetches so both observe no stored owner and the last storage write silently changes room ownership. | Owner issuance is serialized with connection setup and becomes idempotent only for the stored credential. |
| High | Send awareness entries for many client ids, or for another socket's id, and grow the serialized attachment while impersonating peers. | Each connection declares one Yjs client id, duplicate live ids are rejected, and each awareness frame must contain exactly that one id. |
| High | Persist awareness clocks in WebSocket attachments, evict the object, and retain presence metadata even though awareness is meant to be ephemeral. | Awareness now lives only in a bounded in-memory `WeakMap`; hibernation attachments contain authorization and reconnect identity only. |
| High | Send awareness clock 1000 followed by clock 1, then disconnect, causing the low-clock removal to be ignored and leaving stale presence. | Backward awareness clocks close the socket while retaining the highest in-memory clock for disconnect removal. |
| High | Send a multi-megabyte update or oversized awareness payload and force unbounded protocol decoding and allocation. | Binary document frames are capped at 4 MiB, awareness frames at 16 KiB, and size checks run before decoding. |
| High | Spread connection attempts across Worker isolates to reset the module-level map, or exhaust 30 attempts and lock out the same provider's legitimate reconnect. | New-session limits are stored per room and IP in Durable Object storage, bounded to 256 IP records; a known session with the same Yjs client id reconnects without consuming another attempt. |
| Medium | Deliver a message after the close callback and let it recreate awareness or mutate the document for a socket that has already left. | Close state is serialized in the socket attachment and all later messages for that socket are ignored. |
| Medium | Revoke successfully while `localStorage.removeItem` throws, silently retain the owner share record, and reopen forever against a 410 room. | Share-record removal now throws a recoverable error and keeps the modal/session available for retry instead of reporting success. |

No confirmed Duet code bug remains unfixed.

## Regression coverage

The added tests cover simultaneous paragraph edits with duplicate delivery, offline merge, late join, single-winner owner seeding, guest admission during initialization, intentionally cleared history, persisted-before-relay ordering, delayed snapshot ordering, eviction restore, persistence failure recovery, revocation ordering and rehydration, post-close messages, malformed and oversized frames, awareness identity and clocks, unissued tokens, first-owner races, durable rate limits with reconnect grace, cross-tab share changes, cloud isolation decisions, and offline local Yjs cache merging.

Focused Duet result: 41 tests passed.

## Gate results

- `npx tsc --noEmit`: passed.
- `npx tsc --noEmit -p duet/tsconfig.json`: passed.
- `npm test -- --cache=false --maxWorkers=1 --minWorkers=1`: passed, 27 files and 254 tests.
- Literal `npm test`: Duet passed, but the command was not clean in this sandbox. Three out-of-scope `components/PlainBody.test.tsx` cases timed out only in the parallel full run and passed both alone and in the single-worker full run. Vitest also ended with `EPERM` while writing `node_modules/.vite/vitest/results.json` because `node_modules` points to a read-only checkout outside this worktree.
