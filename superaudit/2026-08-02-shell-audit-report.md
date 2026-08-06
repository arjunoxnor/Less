# Shell audit report

All confirmed defects in the named shell scope are fixed and covered by regression tests. Findings are ranked by how likely a writer is to encounter them.

## Findings

| Rank | One-line reproduction | Result |
| ---: | --- | --- |
| 1 | Focus a project row's actions button and press Enter; the project opened behind the actions interaction. | Fixed by ignoring keyboard activation that originates from a nested control. |
| 2 | Click an open menu's trigger to close it; the outside-mousedown handler closed and the following click reopened it. | Fixed by excluding the opener from outside-click dismissal. |
| 3 | Close a dock from its own Close button or with Escape; focus fell back to the document body. | Fixed by restoring focus to the matching rail button, or the compact rail toggle on small screens. |
| 4 | Choose a modal-opening action from a menu; the menu cleanup restored its trigger after the modal focused its field. | Fixed by restoring menu focus during layout cleanup before the modal takes focus. |
| 5 | Edit the top-bar title and press Escape while a dock or focus mode is active; Escape changed the shell layer and could commit the unwanted title. | Fixed by canceling the title edit, suppressing blur commit, and stopping Escape at the input. |
| 6 | Press Ctrl/Cmd+E in the title field or a modal field; the line-type menu opened behind the field. | Fixed by ignoring the shortcut from form fields and dialogs. |
| 7 | Open the compact panel rail in focus mode and press Escape; focus mode exited while the rail state remained open. | Fixed by closing the rail first and clearing it on focus-mode entry. |
| 8 | Open two modals and press Escape; both window listeners could run and close the wrong layer. | Fixed with a shared modal stack in which only the top modal owns Escape. |
| 9 | Close an underlying modal while another modal remains open; body scrolling unlocked and focus could leave the top modal. | Fixed with stack-counted scroll locking and top-only focus restoration. |
| 10 | Press Tab in a modal while background keyboard handlers are installed; the key could propagate behind the dialog. | Fixed by moving focus explicitly within the top modal and stopping the native key event. |
| 11 | Open Move to and choose the item's current folder; the app wrote the same placement and stamped its ordering clock. | Fixed by treating current-location choices as close-only no-ops and exposing `aria-current`. |
| 12 | Fold a shelf that contains a deeper folder; the deeper folder stayed visible through its closed parent. | Fixed by deriving shelf visibility from every open ancestor. |
| 13 | Create a card containing only empty subfolders; the card said Empty and provided no way to reveal them. | Fixed by treating descendant folders as card contents and giving parent shelves a caret. |
| 14 | Leave a delete, move, color, rename, or actions layer open while another tab deletes its target; the stale layer remained actionable. | Fixed by reconciling every open layer against live project and folder maps and restoring safe focus. |
| 15 | Leave a delete or move modal open while another tab renames its target; the modal kept the old name. | Fixed by replacing stored modal snapshots with the latest live entity on every library update. |
| 16 | Keep the Docs panel open while a project or folder is renamed; the panel kept its mount-time storage snapshot. | Fixed by rebuilding its library view on every shell render. |
| 17 | Open two tabs and change preferences in one; the other stayed stale, and effect-based writeback could echo storage-derived state. | Fixed by writing only inside explicit preference changes and adopting storage events without writeback. |
| 18 | Fold a home folder in one tab; another open home tab kept the old fold state. | Fixed by adopting fold storage events, including storage clears. |
| 19 | Start a drag while a rename, menu, modal, or code-import layer is open; the library could move while a conflicting interaction still owned focus. | Fixed by refusing drag start while any transient library layer is active. |
| 20 | Start a second drag before the first dragend arrives; the old dragend cleared the new drag. | Fixed by assigning each `DataTransfer` an independent drag-session number. |
| 21 | Drag over one list and drop on another after a rerender; the stale caret could file the project into the first list. | Fixed by requiring the drop caret to belong to the receiving live container and revalidating source and target. |
| 22 | Drop into a card gap after a sibling was deleted or duplicated in stale render data; the reorder write retained invalid sibling ids. | Fixed by rebuilding the plan from unique live siblings and translating the old slot to the live list. |
| 23 | Delete a folder participating in a parent cycle; its child could be moved under itself and its projects could keep a deleted folder id. | Fixed by moving contents to a parent only when that ancestry is live and acyclic, otherwise to the top level. |
| 24 | Load duplicate project or folder ids; duplicate React keys and ambiguous reorder writes appeared. | Fixed by selecting the first live id deterministically and rejecting reorder lists with duplicate ids. |
| 25 | Load an empty, whitespace-only, or 10,000-character title or folder name; controls became blank or the layout became unusable. | Fixed with trimmed fallbacks and a 200-character display and edit bound. |
| 26 | Load thousands of folders or a very deep hierarchy; repeated ancestor walks became quadratic and recursive shelf or move walks could overflow. | Fixed with cached ancestry classification and iterative depth-first walks. |
| 27 | Drag across a library with thousands of folders; every dragover rebuilt full source and target scans. | Fixed by using memoized live id maps for dragover validation and reserving full validation for the final drop. |
| 28 | Fire two pointer-down events on Hold to delete and unmount; the first overwritten timer could still delete after unmount. | Fixed with one guarded timer, complete cleanup, and a current confirmation callback ref. |
| 29 | Reach Hold to delete by keyboard; Enter and Space could not perform the hold gesture. | Fixed with repeat-safe key-down start and key-up or blur cancellation. |
| 30 | Type past the hint card's auto-dismiss threshold; every later key created another untracked timeout. | Fixed with a single guarded dismiss timer that is cleared on close and unmount. |
| 31 | Dismiss the hint card in another tab; the current tab kept showing it. | Fixed by adopting the dismissal storage event. |
| 32 | Start an import or sync and leave the home before it finishes; its result toast appeared in the next surface and state updated after unmount. | Fixed with mounted-operation guards and no completion toast outside the initiating home. |
| 33 | Emit a toast without a host, or remount the host after expiry; the old toast appeared again with a fresh lifetime. | Fixed by timestamping toasts, clearing manager state on expiry and unmount, and honoring remaining lifetime. |
| 34 | Show a danger toast; assistive technology received the same polite status semantics as routine feedback. | Fixed by announcing danger variants as alerts. |
| 35 | Navigate a menu with arrow keys; visual selection changed without an announced active descendant. | Fixed with stable item ids, `aria-activedescendant`, and active-item reconciliation. |
| 36 | Open home actions, the New menu, the account menu, or the compact rail; their triggers did not expose current expanded state. | Fixed with live `aria-expanded` state on every relevant trigger. |
| 37 | Wrap a control that already has `aria-describedby` in a tooltip; the original description disappeared. | Fixed by composing the existing description id with the tooltip id. |
| 38 | Visit a malformed percent-encoded project hash; `decodeURIComponent` threw during shell mount. | Fixed by treating decoding failure as an invalid route and returning home. |

## Gate

- `npx tsc --noEmit`: passed.
- `npm test -- --cache=false --testTimeout=60000`: passed, 27 test files and 263 tests.
- Vitest cache was disabled because this worktree's `node_modules/.vite` resolves through a read-only symlink.
- The first default-timeout run reached 259 passing tests before the out-of-scope `components/PlainBody.test.tsx` TipTap mount exceeded Vitest's 5-second timeout. That file passed all 3 tests both in isolation and in the complete run with a 60-second runner timeout, and it was not modified.
