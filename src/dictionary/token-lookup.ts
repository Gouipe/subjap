// ---------------------------------------------------------------------------
// Dictionary lookup candidates for tokenized subtitle words.
// ---------------------------------------------------------------------------

import { tokenLookupTerms, type DictionaryEntry, type Token } from "@/core/types";
import { toHiragana } from "@/core/kana";
import { lexicalHead, selectDictionaryEntry, type DictionaryLookupOptions } from "./match";

export type DictionaryLookup = (
  term: string,
  options?: DictionaryLookupOptions,
) =>
  DictionaryEntry | DictionaryEntry[] | null | Promise<DictionaryEntry | DictionaryEntry[] | null>;

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

/** Exhaust exact spellings before any reading fallback, then rank homographs
 * and homophones by the lexical head's POS and base reading. */
export async function lookupTokenDictionaryEntry(
  token: Token,
  localLookup: DictionaryLookup,
  remoteLookup: DictionaryLookup,
): Promise<DictionaryEntry | null> {
  const head = lexicalHead(token);
  // lookupTerms can contain phonetic fallbacks: these must not compete as
  // spellings against the dictionary form and canonical lexical identity.
  const orthographies = [
    ...new Set(
      [
        token.dictionaryForm ?? token.lemma,
        token.canonicalKey ?? token.lemma,
        token.surface.replace(/\n/gu, ""),
      ].filter(Boolean),
    ),
  ];
  const readingForms = head.dictionaryReading
    ? [head.dictionaryReading, ...orthographies.slice(0, 2)]
    : getTokenLookupTerms(token);
  const readings = [
    ...new Set(readingForms.filter(Boolean).map((term) => toHiragana(term.normalize("NFKC")))),
  ];

  for (const mode of ["orthography", "reading"] as const) {
    const terms = mode === "orthography" ? orthographies : readings;
    for (const lookup of [localLookup, remoteLookup]) {
      const results = await Promise.all(terms.map((term) => lookup(term, { mode })));
      const entries = results.flatMap((result) =>
        result == null ? [] : Array.isArray(result) ? result : [result],
      );
      const entry = selectDictionaryEntry(entries, terms, mode, token);
      if (entry) return entry;
    }
  }

  return null;
}
