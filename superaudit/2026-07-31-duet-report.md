# Duet stages 1 and 2 report

## What was built

### Stage 1

- A separate `less-duet` Worker in `duet/`, with its own Wrangler configuration and TypeScript configuration. The Pages Function, migrations, and root Wrangler file were not changed.
- A `DuetRoom` SQLite Durable Object using the hibernation WebSocket API.
- Standard y-websocket sync messages, including the server follow-up sync step that requests edits a client made while offline.
- A single binary Yjs snapshot in Durable Object storage. It loads before a room answers, writes after about two seconds of activity, and flushes when the final socket closes.
- Per-IP connection limiting at 30 room attempts per minute inside the Worker.
- Share links at `https://less.oxnorhub.com/#/duet/<token>`, with 256-bit URL-safe random tokens.
- A Share item in the screenplay overflow menu, a read-only link field, Copy, the required edit warning, and Stop sharing.
- Guest routing without sign-in or an account project row.
- Collaborative TipTap mode with no `content` option and no local UndoRedo extension. Content comes only from the shared Yjs fragment, and Yjs owns undo history.
- Owner-only, one-time seeding after the first successful provider sync. The client seeds only when the shared fragment and the Yjs state history are both genuinely empty.
- Yjs-driven localStorage mirroring for local and remote edits. The editor update handler does not compete with Yjs in collaborative mode.
- Complete suppression of the open document's LWW cloud reconcile, reads, writes, cross-tab replacement, snapshots, title pushes, flushes, and beacons while Duet is active.
- Connected, reconnecting, and offline status. After the first successful sync, editing remains enabled during a disconnect and Yjs merges on reconnect.
- Stop sharing revokes the old room, obtains its final server snapshot, saves that snapshot locally, marks the local document dirty so it wins the next LWW reconcile, and only then returns to the local editor.

### Stage 2

- Awareness-based presence that is relayed but never written to Durable Object storage.
- Owner names use the account name when available, otherwise `You`.
- Guests start as `Guest <suffix>` and can enter a name in the Share modal. A guest's chosen name is kept in a new additive localStorage key.
- Deterministic participant colours, collaborative carets and selections, and a top-bar list of the people currently in the script.
- Awareness cleanup on socket close, including hibernation-safe tracking of the client ids and clocks needed to announce departure.

## Deploy the Worker

From the repository root:

```bash
npx wrangler deploy --config duet/wrangler.jsonc
```

The first deploy applies migration tag `v1` and creates `DuetRoom` with the SQLite backend through `new_sqlite_classes`.

The client defaults to:

```text
wss://less-duet.oxnorhub.workers.dev/room
```

If Wrangler reports a different workers.dev subdomain, build the Pages site with the reported origin:

```bash
NEXT_PUBLIC_DUET_URL=wss://less-duet.<workers-subdomain>.workers.dev/room npm run build
```

`NEXT_PUBLIC_DUET_URL` is the y-websocket server base. The client appends `/<token>`.

## Automated validation completed

- `npx tsc --noEmit`: passed.
- `npx tsc --noEmit -p duet/tsconfig.json`: passed.
- `npm test`: passed, 21 test files and 200 tests.
- Existing undo integrity tests passed unchanged: 27 tests.
- Worker protocol tests cover an update relayed between two simulated clients, a late joiner receiving full state, an offline client's changes merging on reconnect, and a snapshot round-trip through storage.
- Client tests cover seeding an empty room, refusing to seed a room with content, never seeding twice, refusing to resurrect an intentionally cleared room from a stale local mirror, token length/randomness/URL safety, and collaborative extension selection without local UndoRedo.
- `npm run build`: attempted. It failed only because the sandbox could not fetch Jost and Montserrat from Google Fonts. This is the expected sandbox failure. `app/layout.tsx` was not changed.

## Requires two real browser windows

These behaviors depend on a deployed Worker and were not claimed as automated end-to-end coverage:

1. Start sharing from an owner window, open the copied link in a guest window, and confirm the existing script appears once in each window with no duplication.
2. Type from both windows, including simultaneous edits near the same line, and confirm both converge without missing text.
3. Confirm names, colours, carets, selections, and the top-bar presence list in both directions. Change the guest name and confirm it updates in the owner window.
4. Take one window offline after its first sync, keep typing, reconnect it, and confirm its offline text merges with text written in the other window.
5. Close both windows, reopen the link, and confirm the room restores from the Durable Object snapshot.
6. Confirm the owner status bar says cloud sync is off while shared and that the account cloud body does not replace the shared document.
7. Stop sharing while both windows are open. Confirm the owner keeps the final combined text, the guest is disconnected, and the old link no longer opens the room.
8. Share again and confirm a different token is created and the current local text seeds the new empty room exactly once.
9. Confirm a guest edit creates only a local safety mirror and no guest account library entry.

## Decisions the specification did not settle

- Revocation authorization uses a second 256-bit owner key stored only on the owner's device. The public share URL contains only the room token. This avoids giving ordinary guests the Stop sharing capability.
- Revocation keeps the room snapshot instead of deleting it. The room is marked revoked and becomes unreachable, but its last text remains recoverable in Durable Object storage. The Worker also returns that final snapshot to the owner before the editor leaves Duet mode.
- A visible empty fragment is not enough to permit seeding. A room with any Yjs state history is treated as previously used, which prevents a stale local copy from resurrecting text after collaborators intentionally cleared the document.
- The editor is read-only until the first server sync and guarded seed check finish. Once that initial sync has completed, it remains editable through later disconnects. This prevents an offline share start from replacing the owner's existing script with a new unsynced empty Yjs document.
- Guests mirror the Yjs body under a synthetic local project id but never add that id to the project index. That provides the required device-local safety copy without creating a library or account project before stage 3.
- The connection limiter is 30 attempts per IP per rolling minute. The spec required a limiter but did not choose a threshold.
- The client Worker URL is configurable through `NEXT_PUBLIC_DUET_URL`, with `less-duet.oxnorhub.workers.dev` as the fallback because the spec did not provide a workers.dev subdomain or a custom Worker domain.
