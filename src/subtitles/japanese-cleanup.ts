// ---------------------------------------------------------------------------
// SubJap — Japanese text cleanup for plain-text subtitle files
// ---------------------------------------------------------------------------
//
// Netflix-derived SRT files flatten ruby to `小雪(こゆき)`, and their SDH
// variant adds speaker names and sound descriptions in parentheses. SubJap
// shows its own readings, and neither annotation is dialogue.

import type { SubtitleCue } from "@/core/types";
import { normalizeCueText } from "./normalize";

const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const FLATTENED_RUBY =
  /([㐀-䶿一-鿿豈-﫿々〆ヵヶ])[(（][ぁ-ゖァ-ヺー]+[)）]/g;
const PARENTHETICAL = /[(（][^()（）\n]*[)）]|[[［][^\][［］\n]*[\]］]/g;

/** Remove flattened furigana and, for SDH files, speaker names and sound cues. */
export function cleanJapaneseSubtitleText(text: string, sdh: boolean): string {
  let cleaned = text.replace(DIRECTION_MARKS, "").replace(FLATTENED_RUBY, "$1");
  if (sdh) cleaned = cleaned.replace(PARENTHETICAL, "");
  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => normalizeCueText(line) !== "")
    .join("\n");
}

/** Clean every cue and drop those left without dialogue. */
export function cleanJapaneseSubtitleCues(cues: SubtitleCue[], sdh: boolean): SubtitleCue[] {
  return cues
    .map((cue) => ({ ...cue, text: cleanJapaneseSubtitleText(cue.text, sdh) }))
    .filter((cue) => normalizeCueText(cue.text) !== "");
}
