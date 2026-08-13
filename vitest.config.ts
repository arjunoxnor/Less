import path from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

// The storage/sync tests are pure logic and run in node. The editor tests
// construct a real headless TipTap editor, and the cloud client tests need
// window/localStorage, so those two folders get the (heavier) jsdom
// environment.
export default defineConfig({
  // node_modules is a read-only symlink in worktrees, so Vitest's result cache
  // belongs in the writable worktree instead of beside the shared packages.
  cacheDir: path.join(tmpdir(), "less-pages-vitest-cache"),
  resolve: {
    // Mirror tsconfig's "@/*" path alias.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    minWorkers: 1,
    maxWorkers: 4,
    // Agent worktrees live at .claude/worktrees/* INSIDE the repo, so without
    // this Vitest collects every checkout's copy of every test: one run went
    // from 399 tests to 2333, with 650 "failures" that were only ever
    // resolution noise from a sibling checkout. That is worse than useless now
    // that CI gates deploys on the suite, since it turns an unrelated worktree
    // into a red build. Keep the default ignores and add ours.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/.claude/**",
    ],
    environmentMatchGlobs: [
      ["lib/editor/**", "jsdom"],
      ["lib/cloud/**", "jsdom"],
    ],
  },
});
