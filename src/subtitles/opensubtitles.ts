// ---------------------------------------------------------------------------
// SubJap — OpenSubtitles: API key and choice of the episode's translation
// ---------------------------------------------------------------------------

import { declinedVideos } from "./declined";

export const OPENSUBTITLES_API_KEY_STORAGE_KEY = "subjap_opensubtitles_api_key";
/** Videos whose OpenSubtitles translation the user removed: never installed again. */
export const OPENSUBTITLES_DECLINED_STORAGE_KEY = "subjap_opensubtitles_declined";
const declined = declinedVideos(OPENSUBTITLES_DECLINED_STORAGE_KEY);

export async function getOpenSubtitlesApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(OPENSUBTITLES_API_KEY_STORAGE_KEY);
  const key = stored[OPENSUBTITLES_API_KEY_STORAGE_KEY] as unknown;
  return typeof key === "string" ? key.trim() : "";
}

export async function saveOpenSubtitlesApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await chrome.storage.local.set({ [OPENSUBTITLES_API_KEY_STORAGE_KEY]: trimmed });
  else await chrome.storage.local.remove(OPENSUBTITLES_API_KEY_STORAGE_KEY);
}

export function isOpenSubtitlesDeclined(videoId: string): Promise<boolean> {
  return declined.has(videoId);
}

/** The user asks for OpenSubtitles again on a video whose translation they removed. */
export function undeclineOpenSubtitles(videoId: string): Promise<void> {
  return declined.remove(videoId);
}

export function declineOpenSubtitles(videoId: string): Promise<void> {
  return declined.add(videoId);
}

// ---------------------------------------------------------------------------
// File choice
// ---------------------------------------------------------------------------

export type TranslationLanguage = "fr" | "en";

/** A translation that can be installed: one file of an OpenSubtitles result. */
export interface OpenSubtitlesChoice {
  /** Name shown to the user. */
  name: string;
  fileId: number;
  language: TranslationLanguage;
}

export type OpenSubtitlesInstallResult =
  | { status: "no-key" }
  | { status: "bad-key" }
  | { status: "not-found" }
  | { status: "quota"; message: string }
  | { status: "installed"; fileName: string; language: TranslationLanguage; choices: OpenSubtitlesChoice[] }
  | { status: "error"; message: string };

/** One result of OpenSubtitles' subtitle search, as far as SubJap reads it. */
export interface OpenSubtitlesResult {
  attributes?: {
    language?: string;
    release?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    from_trusted?: boolean;
    foreign_parts_only?: boolean;
    machine_translated?: boolean;
    ai_translated?: boolean;
    feature_details?: { season_number?: number; episode_number?: number };
    files?: { file_id?: number; file_name?: string }[];
  };
}

/** Streaming releases: closest timing to what Netflix streams. */
const NETFLIX_SOURCE = /\b(?:nf|netflix)\b/i;
const WEB_SOURCE = /\b(?:web(?:-?dl|-?rip)?|amzn|cr|crunchyroll|dsnp|adn)\b/i;

function resultScore(result: OpenSubtitlesResult): number {
  const attributes = result.attributes ?? {};
  const release = attributes.release ?? "";
  let score = 0;
  if (NETFLIX_SOURCE.test(release)) score += 4;
  else if (WEB_SOURCE.test(release)) score += 2;
  if (attributes.from_trusted) score += 2;
  if (attributes.ai_translated) score -= 3;
  if (attributes.hearing_impaired) score -= 1;
  return score;
}

/**
 * Installable translations, best first: the preferred language first, then
 * streaming releases, trusted uploaders and downloads. Machine translations,
 * partial files (foreign parts only) and other episodes are left out.
 */
export function rankOpenSubtitlesResults(
  results: OpenSubtitlesResult[],
  languages: TranslationLanguage[],
  episode: { season: number | null; episode: number | null } | null,
): OpenSubtitlesChoice[] {
  const ranked = results
    .filter((result) => {
      const attributes = result.attributes;
      const language = attributes?.language?.toLowerCase();
      if (!attributes || !language || !languages.includes(language as TranslationLanguage)) return false;
      if (attributes.foreign_parts_only || attributes.machine_translated) return false;
      const details = attributes.feature_details;
      if (episode?.episode && details?.episode_number && details.episode_number !== episode.episode) return false;
      if (episode?.season && details?.season_number && details.season_number !== episode.season) return false;
      return typeof attributes.files?.[0]?.file_id === "number";
    })
    .sort((left, right) =>
      languages.indexOf(left.attributes?.language?.toLowerCase() as TranslationLanguage) -
        languages.indexOf(right.attributes?.language?.toLowerCase() as TranslationLanguage) ||
      resultScore(right) - resultScore(left) ||
      (right.attributes?.download_count ?? 0) - (left.attributes?.download_count ?? 0));
  const choices: OpenSubtitlesChoice[] = [];
  for (const result of ranked) {
    const attributes = result.attributes ?? {};
    const file = attributes.files?.[0];
    if (typeof file?.file_id !== "number" || choices.some((choice) => choice.fileId === file.file_id)) continue;
    choices.push({
      name: attributes.release?.trim() || file.file_name?.trim() || `OpenSubtitles ${file.file_id}`,
      fileId: file.file_id,
      language: attributes.language?.toLowerCase() as TranslationLanguage,
    });
  }
  return choices;
}

/** "fr" → "française", for the user's messages. */
export function translationLanguageName(language: TranslationLanguage): string {
  return language === "fr" ? "française" : "anglaise";
}
