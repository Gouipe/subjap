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
 * (including an explicit Unignore) or an existing Anki card takes precedence.
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
 * A sentence is a good mining candidate when it has one useful frequency
 * hint and no distant (orange) unknown word competing for attention.
 * Punctuation and parenthetical tokens are represented as null and do not
 * participate in the decision.
 */
export function isSingleMiningCandidate(
  highlights: readonly (FrequencyHighlight | null)[],
): boolean {
  const wordHighlights = highlights.filter(
    (highlight): highlight is FrequencyHighlight => highlight !== null,
  );
  const candidateCount = wordHighlights.filter(
    (highlight) => highlight === "relevant" || highlight === "near",
  ).length;
  return candidateCount === 1 && !wordHighlights.includes("unknown");
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
