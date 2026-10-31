import { api } from "./client";
import { addWordsToSpeller } from "@/lib/editor/spellEngine";
import { mergeDictionary } from "@/lib/editor/dictionaryWords";
import { loadUserDictionary, saveUserDictionary } from "@/lib/editor/userDictionary";

/**
 * The spelling dictionary across computers: fetch the account's words, keep
 * both sides' (nothing is ever lost, since words are only added), and send up
 * any the server lacks. Quietly does nothing offline or on an older server.
 */
export async function syncDictionary(): Promise<void> {
  const remote = await api<{ words: string[] }>("settings/dictionary").catch(() => null);
  if (!remote) return;
  const local = loadUserDictionary();
  const merged = mergeDictionary(local, remote.words);
  if (merged.length !== local.length) {
    saveUserDictionary(merged);
    addWordsToSpeller(merged.slice(local.length));
  }
  if (merged.length !== remote.words.length) {
    await api("settings/dictionary", { method: "PUT", body: { words: merged } }).catch(() => null);
  }
}

/** Keep it in sync while signed in: now, and soon after any word is added. */
export function startDictionarySync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncDictionary(), 1500);
  };
  void syncDictionary();
  window.addEventListener("less:dictionarychange", later);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("less:dictionarychange", later);
  };
}
