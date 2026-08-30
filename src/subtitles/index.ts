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
  netflixWatchId,
  removeLocalSubtitle,
  saveLocalSubtitle,
  type LocalSubtitleRecord,
} from "./local-storage";
export type { SubtitleFormat } from "./parse";
