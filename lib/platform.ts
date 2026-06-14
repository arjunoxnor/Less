/**
 * Platform detection, used only for *displaying* the right shortcut hint.
 * The actual key handling uses ProseMirror's "Mod" token, which already maps
 * Cmd on macOS and Ctrl elsewhere — so this is purely cosmetic.
 */

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the modern API; fall back to the platform string.
  const platform =
    // @ts-expect-error - userAgentData is not in all lib.dom versions yet
    navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/** The label for the command modifier on this platform: "⌘" or "Ctrl". */
export function modKeyLabel(): string {
  return isMac() ? "⌘" : "Ctrl";
}
