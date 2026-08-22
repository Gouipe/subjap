// ---------------------------------------------------------------------------
// Dictionary lookup candidates for tokenized subtitle words.
// ---------------------------------------------------------------------------

import type { DictionaryEntry, Token } from "@/core/types";

export type DictionaryLookup = (
  term: string,
) => DictionaryEntry | null | Promise<DictionaryEntry | null>;

/**
 * Return the lookup forms in the order most likely to identify the word.
 *
 * Kuromoji can produce a lemma whose orthography differs from JMdict's
 * headword (for example ケンカ vs 喧嘩), while the token reading is normalized
 * to hiragana. Keep all three forms as fallbacks and remove duplicates.
 */
export function getTokenLookupTerms(token: Token): string[] {
  return [...new Set([token.lemma, token.surface, token.reading].filter(Boolean))];
}

/** Look up a token locally first, then through the supplied remote lookup. */
export async function lookupTokenDictionaryEntry(
  token: Token,
  localLookup: DictionaryLookup,
  remoteLookup: DictionaryLookup,
): Promise<DictionaryEntry | null> {
  const terms = getTokenLookupTerms(token);

  for (const term of terms) {
    const entry = await localLookup(term);
    if (entry) return entry;
  }

  for (const term of terms) {
    const entry = await remoteLookup(term);
    if (entry) return entry;
  }

  return null;
}
