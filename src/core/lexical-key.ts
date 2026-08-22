import { toHiragana } from "./kana";

// Small, explainable compatibility table for the orthographic variants that
// UniDic deliberately maps to one lexeme. This is identity resolution, not a
// second morphological dictionary.
const KNOWN_VARIANT_KEYS = new Map([
  ["こいつ", "此奴"],
  ["此奴", "此奴"],
]);

/** Normalize user/imported vocabulary to the same identity as UniDic. */
export function canonicalizeLexicalKey(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) return normalized;
  const hiragana = toHiragana(normalized.normalize("NFKC"));
  return KNOWN_VARIANT_KEYS.get(normalized) ?? KNOWN_VARIANT_KEYS.get(hiragana) ?? normalized;
}

/** Candidate keys used when reading states created before UniDic migration. */
export function lexicalKeyCandidates(value: string): string[] {
  const canonical = canonicalizeLexicalKey(value);
  const variants = canonical === "此奴" ? ["こいつ", "コイツ", "此奴"] : [canonical];
  return [...new Set([canonical, ...variants])];
}
