// Minimal module declaration for nspell (no bundled or community types). Covers
// only the surface LESS uses: correct(), suggest(), add(), personal().
declare module "nspell" {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
    personal(dic: string): NSpell;
    spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean };
  }
  type Dict = string | Buffer | Uint8Array;
  function nspell(
    aff: Dict | { aff: Dict; dic: Dict },
    dic?: Dict
  ): NSpell;
  export default nspell;
}
