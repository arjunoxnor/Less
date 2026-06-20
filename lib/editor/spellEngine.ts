import nspell, { type NSpell } from "nspell";
import { loadUserDictionary } from "./userDictionary";

/**
 * Lazily build one shared nspell checker from the en_US Hunspell data served
 * under /dict (copied there by the prebuild step). Everything is client-side and
 * offline once the two files are cached, so spell check needs no server and no
 * account. The promise is memoized; a failed build clears it so a later idle
 * tick can retry, and callers can fall back to native spellcheck.
 */

let spellerPromise: Promise<NSpell> | null = null;

async function build(): Promise<NSpell> {
  const [affRes, dicRes] = await Promise.all([
    fetch("/dict/en_US.aff"),
    fetch("/dict/en_US.dic"),
  ]);
  if (!affRes.ok || !dicRes.ok) {
    throw new Error("spell dictionary fetch failed");
  }
  const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
  const speller = nspell(aff, dic);
  // Seed the writer's personal words so they are never flagged.
  for (const word of loadUserDictionary()) speller.add(word);
  return speller;
}

export function getSpeller(): Promise<NSpell> {
  if (!spellerPromise) {
    spellerPromise = build().catch((e) => {
      spellerPromise = null; // allow a retry on the next request
      throw e;
    });
  }
  return spellerPromise;
}
