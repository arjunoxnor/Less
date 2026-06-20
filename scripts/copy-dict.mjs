// Copies the en_US Hunspell dictionary out of the dictionary-en package into
// public/dict so the static export serves it verbatim. Run as a prebuild step
// (locally and in the GitHub Action) so the assets exist before `next build`.
// The .dic is ~1MB raw; keeping it as a fetched static asset keeps it off the
// JS bundle and the first paint.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "dict");
const pkgDir = dirname(require.resolve("dictionary-en"));

await mkdir(outDir, { recursive: true });
await copyFile(join(pkgDir, "index.aff"), join(outDir, "en_US.aff"));
await copyFile(join(pkgDir, "index.dic"), join(outDir, "en_US.dic"));
console.log("copy-dict: wrote public/dict/en_US.aff and en_US.dic");
