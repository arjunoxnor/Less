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
    environmentMatchGlobs: [
      ["lib/editor/**", "jsdom"],
      ["lib/cloud/**", "jsdom"],
    ],
  },
});
