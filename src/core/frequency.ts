import type { SpanToken, Token, WordState } from "./types";

export const NEAR_FREQUENCY_WINDOW = 300;

export type FrequencyHighlight =
  | "known"
  | "ignored"
  | "learning"
  | "relevant"
  | "near"
  | "unknown";

// Punctuation, symbols, separators and a standalone long-vowel mark (ー, used
// as a dash in subtitles; inside a word it stays part of the lexeme).
const NON_LEXICAL_SURFACE = /^[\p{P}\p{S}\p{Z}\p{C}ー]+$/u;

/** Punctuation, symbols and whitespace do not count as words for subtitle modes. */
export function isNonLexicalToken(
  token: Pick<Token, "surface" | "partOfSpeech">,
): boolean {
  return (
    token.surface.trim().length === 0 ||
    token.partOfSpeech.includes("記号") ||
    token.partOfSpeech.includes("補助記号") ||
    NON_LEXICAL_SURFACE.test(token.surface)
  );
}

/** Separates a kanji spelling from its reading in a `frequency:batch` term. */
export const FREQUENCY_READING_SEPARATOR = "\t";

const HAS_KANJI = /\p{Script=Han}/u;

/**
 * Spellings whose UniDic reading is a fixed guess, not read from context:
 * 私 always comes out わたくし (3050th), though mostly heard わたし (32nd).
 */
const CONTEXT_FREE_READINGS = new Set(["私"]);

/** A kanji spelling is ranked under its reading: 未だ read いまだ is not まだ. */
function withReading(form: string, reading: string): string {
  return reading && HAS_KANJI.test(form) && !CONTEXT_FREE_READINGS.has(form)
    ? `${form}${FREQUENCY_READING_SEPARATOR}${reading}`
    : form;
}

/** ずる verb → its じる form (信ずる → 信じる, しんずる → しんじる). */
function jiruForm(form: string): string | null {
  return form.length > 2 && form.endsWith("ずる") ? `${form.slice(0, -2)}じる` : null;
}

type FrequencyToken = Pick<
  Token,
  "surface" | "reading" | "dictionaryReading" | "dictionaryForm" | "canonicalKey" | "lemma"
>;

/**
 * The terms a token's rank is looked up under. Lexical terms: its lexeme and
 * its written dictionary form, the latter with its reading, plus the じる form
 * of a ずる verb (UniDic gives 信ずる for 信じられない, the list ranks 信じる).
 * The reading belongs to the written form, so the lexeme goes without it
 * (UniDic files なれる under 成る). The surface form only stands in when no
 * lexical term is ranked.
 */
export function frequencyLookupTerms(token: FrequencyToken): {
  lexical: string[];
  surface: string;
} {
  const lexeme = token.canonicalKey ?? token.lemma;
  const dictionaryForm = token.dictionaryForm ?? token.lemma;
  // An uninflected word keeps the reading heard in the subtitle: UniDic's
  // dictionary reading of 私 is わたくし (3050th), not わたし (32nd).
  const reading =
    (token.surface === dictionaryForm ? token.reading : "") || token.dictionaryReading || "";
  const formTerm = withReading(dictionaryForm, reading);
  const lexical = lexeme === dictionaryForm ? [formTerm] : [lexeme, formTerm];
  for (const form of [lexeme, dictionaryForm]) {
    const jiru = jiruForm(form);
    if (jiru) lexical.push(withReading(jiru, jiruForm(reading) ?? reading));
  }
  return {
    lexical: [...new Set(lexical)],
    surface: withReading(token.surface, token.reading ?? ""),
  };
}

/**
 * A token's rank: the best of its lexical terms, since UniDic files a kana word
 * under kanji (いい → 良い: 139th, いい: 33rd), else its surface form's.
 */
export function bestFrequencyRank(
  ranks: Readonly<Record<string, number>>,
  token: FrequencyToken,
): number | undefined {
  const { lexical, surface } = frequencyLookupTerms(token);
  const found = lexical
    .map((term) => ranks[term])
    .filter((rank): rank is number => typeof rank === "number");
  return found.length > 0 ? Math.min(...found) : ranks[surface];
}

/**
 * Lone particles and auxiliaries (の, は, だ, です) are grammar, not words to
 * learn: they get no frequency rank, even though the list ranks them first.
 * A grouped verb (食べた) also carries 助動詞, but alongside its own head.
 */
export function isFunctionWordToken(token: Pick<Token, "partOfSpeech">): boolean {
  return (
    token.partOfSpeech.length > 0 &&
    token.partOfSpeech.every((pos) => pos === "助詞" || pos === "助動詞")
  );
}

/**
 * Interjections and fillers (んっ, えっ, ああ, えー) and grammar expressions
 * without a lexical head (じゃないです, なんだ) are not vocabulary to track.
 */
export function isDefaultIgnoredToken(
  token: Pick<Token, "partOfSpeech" | "grammarOnly">,
): boolean {
  return (
    token.grammarOnly === true ||
    token.partOfSpeech.includes("感動詞") ||
    token.partOfSpeech.includes("フィラー")
  );
}

/**
 * Apply the default "ignored" status to non-vocabulary units. Any stored state
 * (including an explicit « Ne plus ignorer ») or an existing Anki card takes precedence.
 */
export function effectiveWordState(
  token: Pick<Token, "partOfSpeech" | "grammarOnly" | "canonicalKey" | "lemma">,
  stored: WordState | null,
  ankiNoteCount: number,
): WordState | null {
  if (stored || ankiNoteCount > 0 || !isDefaultIgnoredToken(token)) return stored;
  return { key: token.canonicalKey ?? token.lemma, status: "ignored", source: "default" };
}

/** Return true when every lexical word is explicitly known or ignored. */
export function isAllKnownOrIgnored(spans: readonly SpanToken[]): boolean {
  const lexicalSpans = spans.filter(
    (span) => !span.isParenthetical && !isNonLexicalToken(span.token),
  );
  return (
    lexicalSpans.length > 0 &&
    lexicalSpans.every(
      (span) =>
        span.wordState?.status === "known" ||
        span.wordState?.status === "ignored",
    )
  );
}

/**
 * A sentence is a good mining candidate when exactly one word has a useful
 * frequency hint and every other word is known or ignored (white): a word
 * already in Anki or tagged LEARNING is not acquired yet, so it blocks too.
 * Punctuation and parenthetical tokens are represented as null and do not
 * participate in the decision.
 */
export function isSingleMiningCandidate(
  highlights: readonly (FrequencyHighlight | null)[],
): boolean {
  let candidateCount = 0;
  for (const highlight of highlights) {
    if (highlight === null || highlight === "known" || highlight === "ignored") continue;
    if (highlight !== "relevant" && highlight !== "near") return false;
    candidateCount++;
  }
  return candidateCount === 1;
}

/**
 * Classify a token for the subtitle overlay.
 *
 * Known words intentionally stay neutral/white: frequency colours are only
 * learning hints for words the learner has not marked as known. Existing
 * cards are highlighted separately so that a word already in Anki is never
 * mistaken for a high-priority word that still needs a card.
 */
export function getFrequencyHighlight(
  wordState: WordState | null,
  frequencyRank: number | undefined,
  knownWordCount: number,
  ankiNoteCount = 0,
): FrequencyHighlight {
  if (wordState?.status === "known") return "known";
  if (wordState?.status === "ignored") return "ignored";
  if (wordState?.status === "learning") return "learning";
  if (ankiNoteCount > 0) return "learning";
  if (
    frequencyRank == null ||
    !Number.isFinite(frequencyRank) ||
    frequencyRank < 1 ||
    !Number.isFinite(knownWordCount) ||
    knownWordCount < 0
  ) {
    return "unknown";
  }
  if (frequencyRank <= knownWordCount) return "relevant";
  if (frequencyRank <= knownWordCount + NEAR_FREQUENCY_WINDOW) return "near";
  return "unknown";
}
