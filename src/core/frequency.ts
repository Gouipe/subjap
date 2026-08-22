import type { WordState } from "./types";

export const NEAR_FREQUENCY_WINDOW = 300;

export type FrequencyHighlight =
  | "known"
  | "ignored"
  | "learning"
  | "relevant"
  | "near"
  | "unknown";

/**
 * Classify a token for the subtitle overlay.
 *
 * Known words intentionally stay neutral/white: frequency colours are only
 * learning hints for words the learner has not marked as known. The mere
 * presence of an Anki card is not a learning state; its count is displayed in
 * the popover separately.
 */
export function getFrequencyHighlight(
  wordState: WordState | null,
  frequencyRank: number | undefined,
  knownWordCount: number,
): FrequencyHighlight {
  if (wordState?.status === "known") return "known";
  if (wordState?.status === "ignored") return "ignored";
  if (wordState?.status === "learning") return "learning";
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
