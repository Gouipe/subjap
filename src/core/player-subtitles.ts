// ---------------------------------------------------------------------------
// SubJap — Subtitle choices among a player's own files (Artplayer, Vidstack)
// ---------------------------------------------------------------------------

/** One subtitle file offered by a player, as listed by the page bridge. */
export interface PlayerSubtitleCandidate {
  label: string;
  url: string;
  /** Language code the player gives the track (Vidstack); Artplayer only has labels. */
  language?: string;
}

export type PlayerSubtitleLanguage = "ja" | "fr" | "en";

export interface PlayerSubtitleTrack extends PlayerSubtitleCandidate {
  language: PlayerSubtitleLanguage;
  /** Subtitles for the deaf and hard of hearing: speaker names and sound cues. */
  sdh: boolean;
  /** Pictures (Blu-ray PGS): only their timing can be read. */
  image: boolean;
}

/** Partial tracks are not a translation of the dialogue. */
const EXCLUDED = /forced|dubtitle|\bai\b|\bsigns?\b|\bsongs?\b|commentary|commentaire/i;
const SDH = /\bsdh\b|\bcc\b|hearing|malentendant/i;

const LABEL_LANGUAGES: [PlayerSubtitleLanguage, RegExp][] = [
  ["ja", /japanese|japonais|日本語|\bjpn?\b/i],
  ["fr", /french|fran[cç]ais|\bfre\b|\bfra\b/i],
  ["en", /english|anglais|\beng\b/i],
];

/** Start of a file name or of a language code ("fr-CA", "en_US"). */
const CODE_LANGUAGES: [PlayerSubtitleLanguage, RegExp][] = [
  ["ja", /^(?:ja|jp|jpn)(?:[-_.]|$)/i],
  ["fr", /^(?:fr|fre|fra)(?:[-_.]|$)/i],
  ["en", /^(?:en|eng)(?:[-_.]|$)/i],
];

export function playerSubtitleFileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

/** Language and SDH flag of a candidate, or null when it is not usable. */
export function classifyPlayerSubtitle(
  candidate: PlayerSubtitleCandidate,
): PlayerSubtitleTrack | null {
  if (EXCLUDED.test(candidate.label)) return null;
  const fileName = playerSubtitleFileName(candidate.url);
  const fromCode = (code: string): PlayerSubtitleLanguage | undefined =>
    CODE_LANGUAGES.find(([, pattern]) => pattern.test(code))?.[0];
  // A language code is the player's own word; a label such as "English
  // (Arabic)" would name the wrong one.
  const language = candidate.language
    ? fromCode(candidate.language)
    : LABEL_LANGUAGES.find(([, pattern]) => pattern.test(candidate.label))?.[0] ?? fromCode(fileName);
  if (!language) return null;
  return {
    ...candidate,
    language,
    sdh: SDH.test(candidate.label),
    image: /\.sup$/i.test(fileName),
  };
}

/** Plain text formats carry only dialogue; ASS fansubs also typeset signs and karaoke. */
function isPlainTextTrack(track: PlayerSubtitleTrack): boolean {
  return /\.(?:srt|vtt|webvtt)$/i.test(playerSubtitleFileName(track.url));
}

/** Best track per language: dialogue-only first, SDH as a fallback; plain text preferred. */
export function selectPlayerSubtitleTracks(
  candidates: PlayerSubtitleCandidate[],
): Partial<Record<PlayerSubtitleLanguage, PlayerSubtitleTrack>> {
  const selected: Partial<Record<PlayerSubtitleLanguage, PlayerSubtitleTrack>> = {};
  const rank = (track: PlayerSubtitleTrack): number =>
    (track.sdh ? 0 : 2) + (isPlainTextTrack(track) ? 1 : 0);
  for (const candidate of candidates) {
    const track = classifyPlayerSubtitle(candidate);
    if (!track || track.image) continue;
    const current = selected[track.language];
    if (!current || rank(track) > rank(current)) selected[track.language] = track;
  }
  return selected;
}

/**
 * Without a translation in text, the player's translation in pictures, whose
 * timing still tells when its lines start: a reference to align on.
 */
export function selectPlayerTimingTrack(
  candidates: PlayerSubtitleCandidate[],
): PlayerSubtitleTrack | null {
  let selected: PlayerSubtitleTrack | null = null;
  for (const candidate of candidates) {
    const track = classifyPlayerSubtitle(candidate);
    if (!track?.image || track.language === "ja") continue;
    if (!selected || (selected.sdh && !track.sdh)) selected = track;
  }
  return selected;
}
