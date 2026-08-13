# Panels, menus, and modals audit report

Audited against empty, one-line, long-document, live-update, stale-row, stacked-focus,
keyboard, and large-list cases. Findings are ranked by how often a writer is likely
to encounter them. Every confirmed issue below is fixed.

## High likelihood

1. **Fixed — title-page dialog focus and stacking:** Open Title page, Tab past its fields, then press Escape; focus could leave the dialog, the shell could also consume Escape, and close did not reliably restore the trigger.
2. **Fixed — authentication dialog focus and stacking:** Open Sign in, Tab through it, then stack another modal or press Escape; the legacy backdrop had no dialog semantics, focus trap, shared modal stack, or safe restoration.
3. **Fixed — whitespace-only find:** Enter only spaces in Find on a long script; the plugin enumerated ordinary document whitespace and enabled navigation/replacement instead of treating the query as empty.
4. **Fixed — rename preview rescanned on every key:** Open Rename in a 200-page script and type a new character name; every render synchronously walked the entire document for a preview.
5. **Fixed — report scene lookup was quadratic:** Open Reports on a script with thousands of scenes; every scene row performed another full scene-array search while rendering.
6. **Fixed — report rows rebuilt for each word-count tick:** Leave Reports open and type; the scene, cast, and location row trees were rebuilt just to update the word statistic.
7. **Fixed — page sheets rebuilt on unrelated typing:** Type in a 200-page document without changing its page count; every parent render recreated all 200 backdrop elements.
8. **Fixed — history previews flattened whole snapshots:** Open History with many long snapshots; producing each 70-character row preview traversed and concatenated the snapshot's entire document.
9. **Fixed — command active option became invalid:** Filter the palette, move to the last result, then let commands disappear; Enter or `aria-activedescendant` could still reference an out-of-range option.
10. **Fixed — command palette could steal focus from its result:** Run “Title page” from the palette; palette cleanup could restore the old editor focus after the new modal had focused its first field.
11. **Fixed — stale note position actions:** Keep a note-row DOM reference while live notes rerender with shifted positions, then activate it; Jump/Remove could apply the detached row's old absolute position.
12. **Fixed — stale scene/report positions:** Keep a scene or report row while scenes rerender after deletion/renumbering, then activate the old row; it could jump to the document content now occupying the old position.
13. **Fixed — stale cast/location positions and renames:** Rename or remove a cast/location entry while its old row is still interactive, then Jump or blur its rename input; the action could use the vanished source's position/name.

## Medium likelihood

14. **Fixed — note deletion lost keyboard focus:** Focus a note action and delete that note through the live document; focus fell to `body` instead of the next note action or note composer.
15. **Fixed — inline cast rename lost focus or committed after Escape:** Rename a cast row with the keyboard and press Enter/Escape; removal of the inline input lost focus, and a trailing blur could commit a cancelled edit.
16. **Fixed — stale breakdown actions:** Remove a tag or renumber scenes while Breakdown is open, then activate a retained old control; it could remove/jump using a result row no longer present in current props.
17. **Fixed — stale autocomplete index:** Change suggestions while retaining an old option, then activate it; the old numeric index could select a different current suggestion, and duplicate text keys could reuse the wrong row.
18. **Fixed — autocomplete pointer/assistive activation:** Focus or virtually activate a suggestion button; selection only existed on `mousedown`, so normal button `click` activation did nothing.
19. **Fixed — stale spelling replacement:** Edit the document after opening a spelling menu, then choose a suggestion; the saved `[from,to]` range could replace unrelated current text.
20. **Fixed — spelling keyboard and Escape order:** Open spelling suggestions, navigate without a mouse, or stack the command palette/modal and press Escape; options had no roving keyboard focus and the window-level shell could close underneath the popover.
21. **Fixed — plain-toolbar submenu Escape and ARIA:** Open Color, Highlight, or Link and press Escape while another layer is stacked; submenus lacked truthful popup state/roles and did not consistently close before shell layers.
22. **Fixed — history request races:** Change the history provider or close the panel while an older request is pending; its late resolve/reject could overwrite newer state or update an unmounted panel.

## Lower likelihood

23. **Fixed — storage warning missed startup failures:** Trigger `less:storagefull` during startup before passive effects mount; the persistent banner missed the only event and never appeared.
24. **Fixed — authentication async races and copy fallback:** Close Sign in while Google/link checks are pending, double-activate Link, or copy without Clipboard API; callbacks could update after close, launch duplicate links, or silently do nothing.
25. **Fixed — Duet stop-sharing races:** Double-activate Stop sharing or close while revocation rejects; duplicate requests or post-unmount state updates were possible.
26. **Fixed — history close button had no accessible name:** Navigate Version history with a screen reader; its glyph-only close control was announced without a useful name.
27. **Fixed — breakdown mode/remove ARIA was incomplete:** Toggle By category/By scene or reach a `×` remove button with assistive tech; current mode and removal target were not exposed clearly.
28. **Fixed — invalid page counts could create invalid sheet arrays:** Render PageBackdrop with a non-finite or fractional page count during transient pagination state; sheet generation was not normalized to a safe positive integer.

## Scenarios verified without changes

- Empty query and query longer than the document return no matches; a whitespace-only query is now normalized before reaching the plugin.
- Empty replacement remains enabled when matches exist, including Replace all.
- Replacement text containing the query advances past the inserted text instead of looping on the same match.
- Find searches the ProseMirror document rather than visibility-filtered DOM, so collapsed/hidden content remains searchable.
- Replace all applies matches last-to-first in one transaction, so one Undo restores the entire operation.
- Empty and one-item states remain explicit in scenes, cast, locations, reports, notes, breakdown, history, and palette results.
- Autocomplete remains bounded by its provider; spelling remains bounded to six suggestions; large panel lists no longer incur quadratic/full-snapshot work on unrelated renders.
- SessionExpiredBanner and DuetShareModal already used keyboard-reachable controls; DuetShareModal already inherited the shared focus trap and modal stack.

## Verification

- `npx tsc --noEmit`: passed.
- `npm test`: passed, 39 files / 372 tests.
- The user-mandated implementation scope allowed only the named component source files; no test source outside that scope was created or edited. The full existing test gate was used for regression verification.
