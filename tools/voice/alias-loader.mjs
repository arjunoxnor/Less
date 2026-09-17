// Lets plain Node run the app's own modules, so the worker uses the same
// Fountain parser and document builder the browser does instead of a second
// copy that would drift. Two things a bundler does that Node ESM will not:
//   1. the "@/..." alias from tsconfig paths
//   2. extensionless relative imports ("./flatten" meaning ./flatten.ts)
// Registered by register.mjs via --import.
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const isFile = (p) => existsSync(p) && statSync(p).isFile();
const probe = (base) =>
  [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = probe(resolvePath(root, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const hit = probe(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
