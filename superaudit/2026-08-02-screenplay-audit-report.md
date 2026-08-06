# Screenplay editor line-by-line audit report

Date completed: 2026-08-05

## Scope and method

The full priority surface in the audit specification was read top to bottom. This included `ScreenplayBody`, the screenplay editor extensions and supporting helpers, every screenplay export and import path, project and cloud storage, and all screenplay dock panels. Supporting files reached by those paths were also read where their behavior affected the required scenarios.

The baseline passed 24 test files and 222 tests. The completed audit passes 32 test files and 285 tests. No server was started, no git command was run, and no frozen API, migration, Duet, root Wrangler, schema-node, or layout contract was changed.

## Fixed bugs, ranked by writer impact

### Critical: work loss, project resurrection, or destructive sync behavior

1. **A sibling tab could overwrite the screenplay's newest pre-debounce keystrokes.** Reproduction: type in a screenplay and let a sibling save the same project inside the 600 ms local-save window. Fix: expose `unsavedRef` to the cloud and sibling-adoption guard. Regression: `components/ScreenplayBodyWiring.test.ts`.

2. **A device-wide dirty key was incorrectly treated as this tab's dirty state.** Reproduction: edit in tab A while tab B is clean and signed in; tab B refuses A's broadcast because A set their shared dirty key, then can later save stale content. Fix: track body and title-page ownership in per-tab refs while retaining the persisted device-wide safety flags. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

3. **An older cloud request could clear a sibling tab's newer dirty state.** Reproduction: tab B saves locally while tab A's earlier cloud request is in flight; A completes and clears the shared dirty flag. Fix: completion now compares both the live editor and the latest localStorage document/title page with the sent snapshots before clearing anything. Regression: `lib/storage/syncSafety.test.ts` and `lib/storage/useCloudSyncWiring.test.ts`.

4. **Sibling adoption could rebroadcast forever between clean tabs.** Reproduction: tab A saves, tab B adopts with `emitUpdate: false`, then the pull effect saves and broadcasts the same body back to A. Fix: report the original local-write result through `pulledSaveOk` and never re-save a sibling adoption. Regression: `components/ScreenplayBodyWiring.test.ts` and `lib/storage/useCloudSyncWiring.test.ts`.

5. **Title-page edits did not propagate between tabs.** Reproduction: edit the title page in tab A, then edit and save the stale title page still displayed in tab B. Fix: add a title-page broadcast and adopt it unless that tab owns a pending title-page edit. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

6. **Typing during a reconcile save was marked clean when the older request returned.** Reproduction: open a dirty project, type while its reconcile PATCH is in flight, then let the old PATCH finish. Fix: snapshot and recheck the editor, local body, and title page before clearing dirty state. Regression: `lib/storage/syncSafety.test.ts` and `lib/storage/useCloudSyncWiring.test.ts`.

7. **Editing a title page during a body save could be cleared by the older save.** Reproduction: change the title page while a body PATCH is in flight. Fix: independently snapshot title-page memory and storage, and clear only the exact value sent. Regression: `lib/storage/syncSafety.test.ts` and `lib/storage/useCloudSyncWiring.test.ts`.

8. **An ordinary body save could overwrite a newer remote title page with a stale cached copy.** Reproduction: change a title page on device A, then type body text in an already-open device B. Fix: body saves omit `title_page` unless this tab actually edited it. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

9. **A failed reconcile save could still end in the `synced` state.** Reproduction: make `saveScript` return null during open-time reconcile. Fix: return immediately after the error and retain dirty state. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

10. **A null title-save response was treated as a non-error.** Reproduction: let the title endpoint return null after a body save. Fix: throw into the sync error path and retain title dirty state. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

11. **An older title request could clear a newer rename.** Reproduction: rename twice before the first title PATCH resolves. Fix: compare the requested title with the current stored project title before clearing its dirty flag or clock. Regression: `lib/storage/useProjects.test.tsx` and `lib/storage/syncSafety.test.ts`.

12. **First cloud creation could clear body or title-page edits made in flight.** Reproduction: type or edit the title page while a local project's initial POST is pending. Fix: snapshot all created values and finalize only exact matches. Regression: `lib/storage/useCloudSyncWiring.test.ts` and `lib/storage/syncSafety.test.ts`.

13. **Creating an exact title in the first cloud row left title dirty forever.** Reproduction: rename a local project, sign in, and create its cloud row with that title. Fix: clear title dirty when the created title still matches current storage. Regression: `lib/storage/useCloudSyncWiring.test.ts`.

14. **Signing out after a failed or offline flush deleted unsynced cloud-backed local work.** Reproduction: edit offline, choose Sign out, and let identity cleanup drop cloud projects. Fix: block sign-out while any cloud-backed body, title page, title, or status is unconfirmed. Regression: `lib/storage/signOutSafety.test.ts`.

15. **Signing out during a project's first cloud insert could orphan the successful row.** Reproduction: create a project while signed in and sign out before its POST resolves. Fix: persist an additive `cloudCreatePending` flag and include it in the sign-out guard. Regression: `lib/storage/signOutSafety.test.ts`.

16. **An online project delete that resolved false was never queued for retry.** Reproduction: delete a cloud project while the endpoint returns false rather than throwing. Fix: create a project tombstone on both false and rejection. Regression: `lib/storage/useProjects.test.tsx`.

17. **An online folder delete that resolved false discarded its tombstone.** Reproduction: delete a folder during a 401-shaped false response. Fix: clear the folder tombstone only after a true server confirmation. Regression: `lib/storage/useProjects.test.tsx`.

18. **Reconnect pulled a project before flushing its pending delete.** Reproduction: delete a project offline, reconnect, and receive the still-present cloud row. Fix: skip cloud rows named by local project tombstones before any metadata pull. Regression: `lib/storage/useProjects.test.tsx`.

19. **Reconcile could clear a newer title or status after an older metadata request.** Reproduction: change title or status again while reconcile is awaiting its first PATCH. Fix: re-read the field and finalize only the value actually requested. Regression: `lib/storage/useProjects.test.tsx` and `lib/storage/syncSafety.test.ts`.

### High: normal screenplay editing and navigation

20. **Revision mode missed edits in a one-line screenplay.** Reproduction: enable revisions and type in the only line. Fix: replace the document-size heuristic with mapped changed ranges. Regression: `lib/editor/screenplayAudit.test.ts`.

21. **AutoElement's appended formatting transaction could hide the user's edit from revision tracking.** Reproduction: type a slug opener that converts Action to Scene Heading while revisions are on. Fix: filter only the synthetic transaction, retain and map the user's changed range. Regression: `lib/editor/screenplayAudit.test.ts`.

22. **Undo could create a new revision mark.** Reproduction: edit with revisions on, clear revisions, then undo the edit. Fix: ignore ProseMirror history transactions in the revision tracker. Regression: `lib/editor/screenplayAudit.test.ts`.

23. **AutoCaps could mutate a historical state during undo.** Reproduction: replace lowercase text stored in a caps-format element, then undo. Fix: skip AutoCaps on history transactions so undo restores the exact recorded state. Regression: `lib/editor/screenplayAudit.test.ts` and `lib/editor/undoIntegrity.test.ts`.

24. **AutoCaps uppercased untouched lines after an unrelated later edit.** Reproduction: leave lowercase text in a caps-format line, then type elsewhere. Fix: uppercase only top-level lines intersecting mapped changed ranges. Regression: `lib/editor/autoCaps.test.ts`.

25. **AutoCaps and revision mode walked every line on every keystroke.** Reproduction: type at the end of a 200-page script with either feature enabled. Fix: resolve only changed top-level nodes rather than scanning the document. Regression: `lib/editor/pluginLifecycle.test.ts` plus the editor behavior suites.

26. **A third consecutive speaker could become another right-column cue.** Reproduction: toggle dual dialogue on the third cue after an existing left/right pair. Fix: require the previous cue to be non-dual. Regression: `lib/editor/screenplayAudit.test.ts`.

27. **Deleting the left half of dual dialogue left an orphaned right column.** Reproduction: select and delete the left cue cluster while preserving the right one. Fix: normalize dual flags after block removal and keep the normalization in the same undo event. Regression: `lib/editor/screenplayAudit.test.ts`, `lib/editor/setElement.test.ts`, and `lib/editor/enterFlow.test.ts`.

28. **Replace all silently stopped after 5,000 matches.** Reproduction: search for a common token in a very long script and choose Replace all. Fix: retain the complete match list while capping only rendered decorations. Regression: `lib/editor/screenplayAudit.test.ts`.

29. **Whole-word find used ASCII boundaries.** Reproduction: whole-word search for Greek `α` in `αβ α`. Fix: use Unicode letter and number boundaries. Regression: `lib/editor/screenplayAudit.test.ts`.

30. **Global rename lowercased later words in a proper name.** Reproduction: rename title-cased `Al` to `Jo Stone` in action prose. Fix: case-match each Unicode word rather than lowercasing the replacement tail. Regression: `lib/editor/screenplayAudit.test.ts`.

31. **A learned sub-location was unavailable unless its parent had appeared alone.** Reproduction: write `HOUSE - KITCHEN`, then later type `HOUSE - K`. Fix: derive immediate child suggestions from every learned location path. Regression: `lib/editor/screenplayAudit.test.ts`.

32. **Breakdown word boundaries treated non-ASCII letters as punctuation.** Reproduction: tag `café` in a script containing only `caféine`. Fix: use Unicode letters and numbers for both tag boundaries. Regression: `lib/editor/screenplayAudit.test.ts`.

33. **Breakdown persistence ran inside React state updater callbacks.** Reproduction: add or remove a breakdown item under Strict Mode updater replay. Fix: compute from the live ref, update the ref and state once, then persist outside the updater. Regression: `components/ScreenplayBodyWiring.test.ts`.

34. **Breakdown highlights rebuilt the whole document synchronously on every key.** Reproduction: type in a 200-page tagged script with highlights enabled. Fix: map existing decorations and rescan only changed lines. Regression: `lib/editor/pluginLifecycle.test.ts` and `lib/editor/screenplayAudit.test.ts`.

35. **Breakdown occurrences before scene 1 had a dead Jump button.** Reproduction: tag an item in opening material before the first slugline and click scene 0. Fix: map scene 0 to the document start. Regression: `components/ScreenplayBodyWiring.test.ts`.

36. **Reports counted a cue with no dialogue as a speaking character.** Reproduction: add an abandoned character cue and open Reports. Fix: report only cast entries with at least one dialogue line. Regression: `lib/editor/screenplayAudit.test.ts`.

37. **Auto CONT'D followed a cue that never spoke.** Reproduction: write a cue, action, and the same cue without any dialogue after the first cue. Fix: require dialogue in the prior speaker block before marking the next cue. Regression: `lib/editor/screenplayAudit.test.ts`.

38. **Scene and report page badges used a rough 55-line estimate.** Reproduction: open a wrapped script whose page boundaries differ from the estimate. Fix: replace panel scene pages with `pageAtPos` from the actual visual pagination decorations, including a layout callback when boundaries move but page count does not. Regression: `components/ScreenplayBodyWiring.test.ts`.

39. **A lazy spell dictionary could dispatch after its editor view was destroyed.** Reproduction: close the editor before the dictionary Promise resolves. Fix: guard the Promise, scheduler, and scan with a destroyed flag. Regression: `lib/editor/pluginLifecycle.test.ts`.

40. **Font-ready pagination could schedule work after view destruction.** Reproduction: close the editor before `document.fonts.ready` resolves. Fix: guard font completion, RAF work, and timers with a destroyed flag. Regression: `lib/editor/pluginLifecycle.test.ts`.

### Medium: export, import, locking, and history fidelity

41. **Dual-dialogue revision marks were absent from PDF output.** Reproduction: revise either column of dual dialogue and export PDF. Fix: carry row revision state and draw the right-margin asterisk. Regression: `lib/export/exportEdges.test.ts`.

42. **The flat document bridge dropped the `revised` attribute.** Reproduction: convert revised `ScriptLine` data to a document and back. Fix: preserve the attribute in `linesToDoc`. Regression: `lib/export/exportEdges.test.ts`.

43. **Orphan Fountain dialogue re-imported as Action.** Reproduction: export a dialogue line with no cue, then parse the Fountain file. Fix: force orphan dialogue with Fountain's lyric marker and map it back to Dialogue. Regression: `lib/export/exportEdges.test.ts`.

44. **Empty Action lines disappeared in Fountain round trips.** Reproduction: export and import an explicitly empty Action element. Fix: emit a forced empty Action marker. Regression: `lib/export/exportEdges.test.ts`.

45. **Empty Dialogue inside a cue cluster disappeared in Fountain round trips.** Reproduction: export a cue followed by an empty Dialogue element. Fix: emit a forced empty dialogue marker inside the cluster. Regression: `lib/export/exportEdges.test.ts`.

46. **A whitespace-only title-page separator could consume the Fountain body.** Reproduction: import a title block followed by a line containing spaces before the first scene. Fix: terminate the title block on any visually blank line. Regression: `lib/export/exportEdges.test.ts`.

47. **Forced scene headings beginning with a non-ASCII letter re-imported as Action.** Reproduction: round-trip `.ÉTAGE SUPÉRIEUR`. Fix: recognize a single leading period as the force marker independently of ASCII. Regression: `lib/export/exportEdges.test.ts`.

48. **Fountain caps detection missed cues made only of non-ASCII cased letters.** Reproduction: round-trip a cue named `É`. Fix: detect cased Unicode through upper/lower transformations rather than `[A-Za-z]`. Regression: `lib/export/exportEdges.test.ts`.

49. **Exporter-authored empty FDX paragraphs were discarded by the importer.** Reproduction: round-trip an empty Action or Dialogue paragraph through FDX. Fix: add and honor a harmless `LESSPreserveEmpty` paragraph attribute while still dropping external spacing paragraphs. Regression: `lib/export/exportEdges.test.ts`.

50. **Page-lock resynchronization stopped after four missing locked pages.** Reproduction: cut five or more locked pages before a surviving anchor. Fix: search all remaining monotonic anchors. Regression: `lib/export/exportEdges.test.ts`.

51. **Repeated page-opening lines could match the wrong locked page.** Reproduction: lock two pages that both start with `SAME`, cut the first, and relabel. Fix: store an additive short context signature and prefer its exact match. Regression: `lib/export/exportEdges.test.ts`.

52. **External Word screenplay styles were read as opaque style IDs.** Reproduction: import a DOCX paragraph styled `P42` where `styles.xml` names `P42` as `Scene Heading`. Fix: resolve Word style IDs through `styles.xml`. Regression: `lib/export/exportEdges.test.ts`.

53. **OpenDocument automatic styles were not resolved through their parent screenplay style.** Reproduction: import an ODT `P1` paragraph whose parent style is `Scene Heading`. Fix: map automatic style names to display or parent names before classification. Regression: `lib/export/exportEdges.test.ts`.

54. **RTF paragraph alignment was discarded before classification.** Reproduction: import a centered all-caps cue followed by all-caps dialogue. Fix: retain `qc`, `qr`, and paragraph alignment resets in the parsed paragraph stream. Regression: `lib/export/exportEdges.test.ts`.

55. **Restoring a version with no title page failed to clear the current title page.** Reproduction: restore a history row whose `title_page` is explicitly null. Fix: preserve null instead of converting it to undefined in both the panel and confirmation flow. Regression: `components/HistoryPanel.test.tsx` and `components/ScreenplayBodyWiring.test.ts`.

56. **History restore copy hid its destructive title-page behavior.** Reproduction: restore a no-title-page version while the current screenplay has one. Fix: state clearly in both tooltip and confirmation that title-page metadata is replaced or removed. Regression: `components/HistoryPanel.test.tsx` and `components/ScreenplayBodyWiring.test.ts`.

## Required scenario coverage

- Find and replace covers every element, regex-looking literal text, Unicode whole words, more than 5,000 matches, a feature-length replacement batch, and one-step undo.
- Character rename covers substring neighbors, cue extensions, action and dialogue mentions, multiword replacement casing, and one-step undo. Location rename covers exact location spans and substring neighbors.
- Revision coverage includes mode on/off, AutoElement batches, undo, flat conversion, ordinary PDF rows, and dual-dialogue PDF rows.
- Page locking covers mid-script A-page insertion, deletion of more than four anchors, repeated openings, and export labels.
- Fountain and FDX are round-tripped for all six element types, dual dialogue, empty meaningful elements, Unicode cues/headings, and title-page metadata. Word, OpenDocument, and RTF external-style cases are imported and classified.
- Long-script paths cover complete find results with bounded decorations and changed-line-only AutoCaps, revisions, and breakdown highlighting.
- Spell and pagination asynchronous teardown are guarded.
- Empty-state behavior was checked across the screenplay panels; live panel derivations update from the document, and scene page badges now use actual visual pagination.

## Deliberately left limitations

1. **On-screen dual dialogue remains staggered rather than equal-height side by side.** The PDF is correctly side by side, but equal-height editor columns need a structural NodeView or equivalent grouping. That is a layout redesign under the frozen one-node schema, not a safe audit patch. The existing dual cluster remains editable, normalized, unsplittable on screen, and correct in export.

2. **Page locks cannot distinguish pages whose opening line and first four context lines are all identical.** The audit fixed the common repeated-opening case, but a perfect solution requires persistent per-line identity. Adding that identity would change the persisted editor model beyond the frozen contract.

3. **Fountain and FDX do not carry LESS-only line notes or revision-pass metadata as portable screenplay semantics.** Notes are explicitly non-exporting annotations, and revision stars belong to the PDF production artifact. Text, element type, meaningful empty elements, dual structure, title-page data, and Unicode content do round-trip.

## Gate

- `npx tsc --noEmit`: passed.
- `npm test`: passed, 32 files and 285 tests.
- `npm run build`: not run. The specification says its offline Google Fonts fetch can fail and the required gate does not include it.
