// ---------------------------------------------------------------------------
// Wording shared by the popup and the options: one setting, one name.
// ---------------------------------------------------------------------------

import type { KnownSentenceSubtitles, SecondarySubtitleLanguage } from "@/core/types";

export const SECONDARY_LANGUAGE_CHOICES: ReadonlyArray<{
  value: SecondarySubtitleLanguage;
  label: string;
}> = [
  { value: "none", label: "Aucune" },
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
];

export const KNOWN_SENTENCE_CHOICES: ReadonlyArray<{
  value: KnownSentenceSubtitles;
  label: string;
}> = [
  { value: "show", label: "Tout afficher" },
  { value: "hide-translation", label: "Masquer la traduction" },
  { value: "hide-all", label: "Tout masquer (écoute)" },
];

/** Pause at the end of a sentence hidden by « Phrases connues ». */
export const PAUSE_AFTER_HIDDEN_SENTENCE_LABEL = "Pause à la fin";
