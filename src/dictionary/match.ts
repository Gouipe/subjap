import type { DictionaryEntry, Token } from "@/core/types";
import { tokenDictionaryForm } from "@/core/types";
import { toHiragana } from "@/core/kana";

export type DictionaryMatchMode = "orthography" | "reading";
export interface DictionaryLookupOptions {
  mode: DictionaryMatchMode;
}

/** Grammar expressions do not inherit the identity of their first morpheme. */
export function lexicalHead(token: Token): Token {
  const base = token.components?.[0];
  return base && tokenDictionaryForm(token) === tokenDictionaryForm(base) ? base : token;
}

const isKana = (text: string): boolean =>
  /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u.test(text);
const normalizeReading = (text: string): string => toHiragana(text.normalize("NFKC"));

/** Legacy packs mixed spellings and readings in aliases. Do not let kana
 * readings of a kanji headword masquerade as exact orthographic matches. */
export function entrySpellings(entry: DictionaryEntry): string[] {
  return (
    entry.spellings ?? [
      entry.headword,
      ...(entry.aliases ?? []).filter((alias) => !isKana(alias) || isKana(entry.headword)),
    ]
  );
}

export function entryReadings(entry: DictionaryEntry): string[] {
  return entry.readings ?? [entry.reading, ...(entry.aliases ?? []).filter(isKana)];
}

export function matchesDictionaryEntry(
  entry: DictionaryEntry,
  term: string,
  mode: DictionaryMatchMode,
): boolean {
  return mode === "orthography"
    ? entrySpellings(entry).includes(term)
    : entryReadings(entry).some((reading) => normalizeReading(reading) === normalizeReading(term));
}

function posFamilies(tags: readonly string[]): Set<string> {
  const families = new Set<string>();
  for (const tag of tags) {
    if (tag === "動詞" || /^v(?:1|2|4|5|k|s|z)/u.test(tag) || /\bverb\b/iu.test(tag))
      families.add("verb");
    if (tag === "形容詞" || /^adj-i/u.test(tag) || /adjective \(keiyoushi\)/iu.test(tag))
      families.add("i-adjective");
    if (tag === "形状詞" || tag === "adj-na" || /adjectival nouns|na-adjective/iu.test(tag))
      families.add("na-adjective");
    if (tag === "名詞" || /^n(?:$|-)/u.test(tag) || /\bnoun\b/iu.test(tag)) families.add("noun");
    if (tag === "代名詞" || tag === "pn" || /pronoun/iu.test(tag)) families.add("pronoun");
    if (tag === "副詞" || /^adv/u.test(tag) || /adverb/iu.test(tag)) families.add("adverb");
    if (tag === "助詞" || tag === "prt" || tag === "particle") families.add("particle");
    if (tag === "助動詞" || /^aux/u.test(tag) || /auxiliary|copula/iu.test(tag))
      families.add("auxiliary");
    if (tag === "感動詞" || tag === "int" || /interjection/iu.test(tag))
      families.add("interjection");
  }
  return families;
}

/** Rank only within a match tier: orthography always wins over a reading. */
export function selectDictionaryEntry(
  entries: DictionaryEntry[],
  terms: string[],
  mode: DictionaryMatchMode,
  token?: Token,
): DictionaryEntry | null {
  const head = token ? lexicalHead(token) : undefined;
  const expectedPos = posFamilies(head?.partOfSpeech ?? []);
  const expectedReading = head?.dictionaryReading;
  const scored = entries.flatMap((entry, index) => {
    const termIndex = terms.findIndex((term) => matchesDictionaryEntry(entry, term, mode));
    if (termIndex < 0) return [];
    const entryPos = posFamilies(entry.partOfSpeech);
    const compatible = [...expectedPos].some((pos) => entryPos.has(pos));
    const posScore = compatible ? 30 : expectedPos.size && entryPos.size ? -30 : 0;
    const readingScore =
      expectedReading &&
      entryReadings(entry).some(
        (reading) => normalizeReading(reading) === normalizeReading(expectedReading),
      )
        ? 15
        : 0;
    return [
      { entry, index, score: posScore + readingScore - termIndex * 2 + (entry.common ? 1 : 0) },
    ];
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.entry ?? null;
}

/** Prefer a dictionary-supported base reading; never use the whole auxiliary
 * chain to pronounce a mined lemma when the base reading is available. */
export function dictionaryReadingForToken(token: Token, entry?: DictionaryEntry | null): string {
  const reading = lexicalHead(token).dictionaryReading;
  if (entry) {
    const matched =
      reading &&
      entryReadings(entry).find(
        (candidate) => normalizeReading(candidate) === normalizeReading(reading),
      );
    return toHiragana(matched || entry.reading);
  }
  return reading || token.reading;
}
