// ---------------------------------------------------------------------------
// SubJap — Artplayer subtitle choices
// ---------------------------------------------------------------------------

/** One subtitle file offered by an Artplayer instance, as listed by the page bridge. */
export interface ArtplayerSubtitleCandidate {
  label: string;
  url: string;
}

export type ArtplayerSubtitleLanguage = "ja" | "fr" | "en";

export interface ArtplayerSubtitleTrack extends ArtplayerSubtitleCandidate {
  language: ArtplayerSubtitleLanguage;
  /** Subtitles for the deaf and hard of hearing: speaker names and sound cues. */
  sdh: boolean;
  /** Pictures (Blu-ray PGS): only their timing can be read. */
  image: boolean;
}

/** Partial tracks are not a translation of the dialogue. */
const EXCLUDED = /forced|dubtitle|\bai\b|\bsigns?\b|\bsongs?\b|commentary|commentaire/i;
const SDH = /\bsdh\b|\bcc\b|hearing|malentendant/i;

const LABEL_LANGUAGES: [ArtplayerSubtitleLanguage, RegExp][] = [
  ["ja", /japanese|japonais|日本語|\bjpn?\b/i],
  ["fr", /french|fran[cç]ais|\bfre\b|\bfra\b/i],
  ["en", /english|anglais|\beng\b/i],
];

const FILE_LANGUAGES: [ArtplayerSubtitleLanguage, RegExp][] = [
  ["ja", /^(?:ja|jp|jpn)(?:[-_.]|$)/i],
  ["fr", /^(?:fr|fre|fra)(?:[-_.]|$)/i],
  ["en", /^(?:en|eng)(?:[-_.]|$)/i],
];

export function artplayerSubtitleFileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

/** Language and SDH flag of a candidate, or null when it is not usable. */
export function classifyArtplayerSubtitle(
  candidate: ArtplayerSubtitleCandidate,
): ArtplayerSubtitleTrack | null {
  if (EXCLUDED.test(candidate.label)) return null;
  const fileName = artplayerSubtitleFileName(candidate.url);
  const language =
    LABEL_LANGUAGES.find(([, pattern]) => pattern.test(candidate.label))?.[0] ??
    FILE_LANGUAGES.find(([, pattern]) => pattern.test(fileName))?.[0];
  if (!language) return null;
  return {
    ...candidate,
    language,
    sdh: SDH.test(candidate.label),
    image: /\.sup$/i.test(fileName),
  };
}

/** Plain text formats carry only dialogue; ASS fansubs also typeset signs and karaoke. */
function isPlainTextTrack(track: ArtplayerSubtitleTrack): boolean {
  return /\.(?:srt|vtt|webvtt)$/i.test(artplayerSubtitleFileName(track.url));
}

/** Best track per language: dialogue-only first, SDH as a fallback; plain text preferred. */
export function selectArtplayerSubtitleTracks(
  candidates: ArtplayerSubtitleCandidate[],
): Partial<Record<ArtplayerSubtitleLanguage, ArtplayerSubtitleTrack>> {
  const selected: Partial<Record<ArtplayerSubtitleLanguage, ArtplayerSubtitleTrack>> = {};
  const rank = (track: ArtplayerSubtitleTrack): number =>
    (track.sdh ? 0 : 2) + (isPlainTextTrack(track) ? 1 : 0);
  for (const candidate of candidates) {
    const track = classifyArtplayerSubtitle(candidate);
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
export function selectArtplayerTimingTrack(
  candidates: ArtplayerSubtitleCandidate[],
): ArtplayerSubtitleTrack | null {
  let selected: ArtplayerSubtitleTrack | null = null;
  for (const candidate of candidates) {
    const track = classifyArtplayerSubtitle(candidate);
    if (!track?.image || track.language === "ja") continue;
    if (!selected || (selected.sdh && !track.sdh)) selected = track;
  }
  return selected;
}
