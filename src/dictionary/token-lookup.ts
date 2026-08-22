// ---------------------------------------------------------------------------
// Dictionary lookup candidates for tokenized subtitle words.
// ---------------------------------------------------------------------------

import { tokenLookupTerms, type DictionaryEntry, type Token } from "@/core/types";

export type DictionaryLookup = (
  term: string,
) => DictionaryEntry | null | Promise<DictionaryEntry | null>;

/**
 * Return the lookup forms in the order most likely to identify the word.
 *
 * UniDic exposes a natural orthographic form and a stable lexeme identity.
 * Keep both, plus surface/reading fallbacks, so aliases never dictate the
 * form shown in the overlay or written to Anki.
 */
export function getTokenLookupTerms(token: Token): string[] {
  return [...new Set([...tokenLookupTerms(token), token.surface, token.reading].filter(Boolean))];
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
