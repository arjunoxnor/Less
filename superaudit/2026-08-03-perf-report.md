# Performance audit report: real scripts and libraries

Date: 2026-08-05

## Method

The retained regression suite is `lib/editor/performanceAudit.test.ts`. It uses
the production TipTap schema/plugins and the existing jsdom headless setup. A
synthetic page is 55 screenplay lines; pure recomputation is exercised at 10,
100, 120, 500, and 2,000 pages. Interactive/plugin measurements use a 120-page
(6,600-line) feature script. Find has 19,680 matches. Spell uses the real
`dictionary-en`/nspell engine plus 20,000 added personal words.

Measurements were taken on this arm64 macOS worktree with Node 25.8.2 and npm
11.11.1. Timings are wall-clock milliseconds and naturally move with jsdom GC;
the table uses exact representative runs, with ranges where repeated audit runs
showed meaningful variance. Regression ceilings are deliberately much wider
than the observed results.

## Before and after

| Measured path, 120 pages | Before | After | Result |
|---|---:|---:|---|
| Active Find, one edit, 19,680 matches | 133.68-224.34 ms | 7.22-10.98 ms | Match only changed lines, map all other matches, reuse mapped decorations. Complete match count remains available; visible marks are capped at 1,000 and the active result is always decorated. |
| Auto `(CONT'D)`, one edit | 39.07-63.38 ms | 1.50-3.09 ms | Recompute only from the preceding semantic reset through the next scene heading/transition. |
| Pagination DOM pass after an edit | 959.78 ms | 24.81-34.75 ms | Cache clean block geometry by immutable PM-node identity in a `WeakMap`; only changed nodes remeasure. Typing reflow is debounced by 80 ms with a 260 ms maximum wait. |
| Spell full pass, real nspell + 20,000 personal words | 305.10 ms | 15.71-27.34 ms | Cache repeated token answers within a pass and cap visible misspelling decorations at 500 instead of 2,000. |
| Spell pass after editing one line | 305.10 ms (formerly the same full pass) | 1.84-32.57 ms | Track mapped dirty ranges and rebuild only changed lines; a full pass is retained for toggles and actual character/location-name-set changes. |

The complete active-panel synchronous plugin stack measured 24.88-54.66 ms per
edit in repeated headless runs. Pagination and spelling are not included in that
synchronous number: they are deliberately deferred/debounced, measuring as
shown above when their work runs.

## Work measured and deliberately not changed

These paths did not show a whole-document per-key bug and were left alone:

| Path | Measured result | Decision |
|---|---:|---|
| AutoCaps | 24.06 ms baseline; 4.79-28.91 ms in later median runs | Already uses final changed ranges and changed top-level nodes. The remaining cost includes ProseMirror applying the typed transaction and the uppercase append transaction. |
| AutoElement | 0.47-7.02 ms | Reads only the selected current line. |
| Revision tracking | 7.77 ms for the first mark; ~0.20-2.81 ms steady-state | Already changed-range incremental. |
| Breakdown decorations | 0.49-2.66 ms | Already map the old decoration tree and rescan changed lines only. |
| Active element icon | 0.38-0.96 ms | Direct `nodeAt` lookup; no document walk. |
| Autocomplete candidate building | 1.52-14.21 ms | Reads the debounced outline snapshot and current line; it never receives or scans the document. |
| Outline rebuild, 120 pages | 2.28-2.80 ms | Total pass is already cheap and is debounced 120 ms, so incremental outline state would add complexity without a measured benefit. |
| Pure pagination plan, 120 pages | 0.74-0.94 ms | Total downstream planning is necessary because an early height change can move every later break; expensive DOM geometry is the part now cached. |
| Dual-dialogue normalization on an ordinary insertion | 0.12-0.44 ms | Its full normalization is guarded behind block deletion, not ordinary typing. |

The initial cold pagination DOM measurement remains a total pass because every
block needs first geometry. It measured 512.93-1,135.70 ms in jsdom (the original
cold baseline was 635.73 ms). It is intentionally left as one deferred startup,
width-change, or font-change pass; the measured typing regression was repeated
remeasurement, which the weak geometry cache removes. Virtualizing the editor
would be a materially different architecture and was not justified by the
feature-script typing measurements.

Opening Find still performs one complete query scan. It measured 18.91-59.37 ms
in isolated runs and 224.38 ms while four full-suite workers were contending.
That one-off scan is necessary to produce the complete count; subsequent edits
use the 7.22-10.98 ms incremental path, and rendering remains bounded.

## Scaling results

One retained representative run, in milliseconds:

| Pages | Outline total | Continuations pure pass | Find full query | Pagination pure plan |
|---:|---:|---:|---:|---:|
| 10 | 13.53 | 0.08 | 0.63 | 0.48 |
| 100 | 2.34 | 0.66 | 3.66 | 1.68 |
| 120 | 2.80 | 0.59 | 3.94 | 0.94 |
| 500 | 8.03 | 2.39 | 40.12 | 5.23 |
| 2,000 | 90.68 | 8.26 | 71.99 | 25.71 |

The 10-page outline point contains a small one-off runtime/allocation spike and
is not an algorithmic reversal; repeated 100/120-page results are consistently
about 2-3 ms. The 500/2,000-page stress points are far beyond a feature script
and remain below the generous regression ceilings.

## Memory and lifecycle

- Twelve editor open/destroy cycles added 36 relevant window scroll/resize
  listeners and removed the same 36.
- An explicit-GC audit created, switched, and destroyed three 120-page editors.
  The old document `WeakRef` cleared and post-GC heap delta was 7.63 MiB.
- Pagination geometry is held in a `WeakMap<PMNode, ...>`, so switching projects
  cannot make the cache retain old documents. Width/font invalidation replaces
  the weak map.
- Spell view callbacks use a `WeakMap<EditorView, ...>` and are deleted on
  destroy. Timers, RAF work, resize observers, scroll/resize listeners, and the
  outline/breakdown editor subscriptions all have teardown paths exercised or
  checked by tests.
- Find retains complete match positions proportional to the current query/doc,
  but bounds its rendered decoration tree at 1,000. Spell bounds rendered marks
  at 500, and its token memo is local to one scan.

## Gate

- `npx tsc --noEmit`: passed.
- `npm test`: passed — 40 test files, 380 tests.
