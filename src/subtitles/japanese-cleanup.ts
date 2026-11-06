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

/** Text of a Japanese line without any bracketed annotation, nested ones included. */
function japaneseDialogueText(text: string): string {
  let cleaned = text;
  for (let previous = ""; previous !== cleaned;) {
    previous = cleaned;
    cleaned = cleaned.replace(PARENTHETICAL, "");
  }
  return cleanJapaneseSubtitleText(cleaned, false);
}

/** Same input cue, same output object: callers compare cues by identity. */
const dialogueCueCache = new WeakMap<SubtitleCue, SubtitleCue | null>();
const dialogueTimelineCache = new WeakMap<SubtitleCue[], SubtitleCue[]>();

/**
 * The cue as SubJap shows it: speaker names, sound cues and other text in
 * parentheses or brackets are hearing-impaired annotations, not dialogue.
 * Null when nothing else is left.
 */
export function japaneseDialogueCue(cue: SubtitleCue): SubtitleCue | null {
  const cached = dialogueCueCache.get(cue);
  if (cached !== undefined) return cached;
  const text = japaneseDialogueText(cue.text);
  const result = normalizeCueText(text) === ""
    ? null
    : text === cue.text ? cue : { ...cue, text };
  dialogueCueCache.set(cue, result);
  return result;
}

/** A Japanese timeline without its annotation-only lines; stable for a stable input. */
export function japaneseDialogueCues(cues: SubtitleCue[]): SubtitleCue[] {
  const cached = dialogueTimelineCache.get(cues);
  if (cached) return cached;
  const result = cues.flatMap((cue) => japaneseDialogueCue(cue) ?? []);
  dialogueTimelineCache.set(cues, result);
  return result;
}
