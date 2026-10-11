// ---------------------------------------------------------------------------
// SubJap — Subtitle module barrel export
// ---------------------------------------------------------------------------

export {
  decodeEntities,
  stripHtmlTags,
  stripAssOverrides,
  normalizeCueText,
} from "./normalize";
export { splitIntoSentences } from "./segment";
export { markParentheticalTokens } from "./parenthetical";
export {
  parseTimestamp,
  parseAssTimestamp,
  parseSRT,
  parseVTT,
  parseASS,
  parseTTML,
  detectFormat,
  parseSubtitleFile,
} from "./parse";
export {
  getLocalSubtitle,
  localSubtitleStorageKey,
  localSubtitleVideoId,
  netflixWatchId,
  parseLocalSubtitleCues,
  removeLocalSubtitle,
  saveLocalSubtitle,
  type LocalSubtitleRecord,
  type LocalSubtitleRole,
} from "./local-storage";
export type { SubtitleFormat } from "./parse";
