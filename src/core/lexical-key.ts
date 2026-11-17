import { toHiragana } from "./kana";

// Small, explainable compatibility table for the orthographic variants that
// UniDic deliberately maps to one lexeme. This is identity resolution, not a
// second morphological dictionary.
const KNOWN_VARIANT_KEYS = new Map([
  ["こいつ", "此奴"],
  ["此奴", "此奴"],
]);

/**
 * UniDic glosses some lexemes after a hyphen: a loanword's origin
 * (テレビ-television, バイト-Arbeit) or the sense a homograph stands for
 * (君-代名詞, 中-中学校). The word itself is the identity, as for any
 * homograph (中 read なか or ちゅう). A Latin word (Wi-Fi) keeps its hyphen.
 */
const LEXEME_GLOSS = /^(.+?)-(?:\p{Script=Latin}[\p{Script=Latin}\p{N} .'&-]*|\p{Script=Han}+)$/u;
const LATIN_WORD = /^[\p{Script=Latin}\p{N} .'&-]+$/u;

export function stripLexemeGloss(lexeme: string): string {
  const word = LEXEME_GLOSS.exec(lexeme)?.[1];
  return word && !LATIN_WORD.test(word) ? word : lexeme;
}

/** Normalize user/imported vocabulary to the same identity as UniDic. */
export function canonicalizeLexicalKey(value: string): string {
  const normalized = stripLexemeGloss(value.normalize("NFC").trim());
  if (!normalized) return normalized;
  const hiragana = toHiragana(normalized.normalize("NFKC"));
  return KNOWN_VARIANT_KEYS.get(normalized) ?? KNOWN_VARIANT_KEYS.get(hiragana) ?? normalized;
}

/** Candidate keys used when reading states from multiple lexical forms. */
export function lexicalKeyCandidates(...values: string[]): string[] {
  // Values cross the extension message boundary; one malformed alias must not
  // make the whole subtitle batch lose its vocabulary states.
  const textValues = values.filter((value: unknown): value is string => typeof value === "string");
  const candidates = textValues.flatMap((value) => {
    const canonical = canonicalizeLexicalKey(value);
    const variants = canonical === "此奴" ? ["こいつ", "コイツ", "此奴"] : [canonical];
    return [canonical, ...variants];
  });
  return [...new Set(candidates.filter(Boolean))];
}
