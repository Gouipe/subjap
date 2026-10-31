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
  return { ...candidate, language, sdh: SDH.test(candidate.label) };
}

/** Best track per language: dialogue-only first, SDH as a fallback. */
export function selectArtplayerSubtitleTracks(
  candidates: ArtplayerSubtitleCandidate[],
): Partial<Record<ArtplayerSubtitleLanguage, ArtplayerSubtitleTrack>> {
  const selected: Partial<Record<ArtplayerSubtitleLanguage, ArtplayerSubtitleTrack>> = {};
  for (const candidate of candidates) {
    const track = classifyArtplayerSubtitle(candidate);
    if (!track) continue;
    const current = selected[track.language];
    if (!current || (current.sdh && !track.sdh)) selected[track.language] = track;
  }
  return selected;
}
