import path from "node:path";
import { defineConfig } from "vitest/config";

// The storage/sync tests are pure logic and run in node. The editor tests
// construct a real headless TipTap editor, and the cloud client tests need
// window/localStorage, so those two folders get the (heavier) jsdom
// environment.
export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" path alias.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environmentMatchGlobs: [
      ["lib/editor/**", "jsdom"],
      ["lib/cloud/**", "jsdom"],
    ],
  },
});
