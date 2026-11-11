// ---------------------------------------------------------------------------
// SubJap — Jimaku: API key and choice of the episode's subtitle file
// ---------------------------------------------------------------------------

import { declinedVideos } from "./declined";

export const JIMAKU_API_KEY_STORAGE_KEY = "subjap_jimaku_api_key";
/** Videos whose Jimaku file the user removed: never installed again. */
export const JIMAKU_DECLINED_STORAGE_KEY = "subjap_jimaku_declined";
const declined = declinedVideos(JIMAKU_DECLINED_STORAGE_KEY);

export async function getJimakuApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(JIMAKU_API_KEY_STORAGE_KEY);
  const key = stored[JIMAKU_API_KEY_STORAGE_KEY] as unknown;
  return typeof key === "string" ? key.trim() : "";
}

export async function saveJimakuApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await chrome.storage.local.set({ [JIMAKU_API_KEY_STORAGE_KEY]: trimmed });
  else await chrome.storage.local.remove(JIMAKU_API_KEY_STORAGE_KEY);
}

export function isJimakuDeclined(videoId: string): Promise<boolean> {
  return declined.has(videoId);
}

/** The user asks for Jimaku again on a video whose file they removed. */
export function undeclineJimaku(videoId: string): Promise<void> {
  return declined.remove(videoId);
}

export function declineJimaku(videoId: string): Promise<void> {
  return declined.add(videoId);
}

// ---------------------------------------------------------------------------
// Entry choice
// ---------------------------------------------------------------------------

/** A Jimaku entry, as its search lists it. */
export interface JimakuEntry {
  id: number;
  name: string;
  english_name?: string | null;
  japanese_name?: string | null;
  anilist_id?: number | null;
}

const ROMAN_SEASONS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Season an entry's names announce: "Season 2", "2nd Season", "第2期", "II"; 1 when none. */
export function entrySeason(entry: JimakuEntry): number {
  for (const name of [entry.name, entry.english_name, entry.japanese_name]) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const match = /\bseason\s*(\d{1,2})\b/i.exec(trimmed) ??
      /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(trimmed) ??
      /第(\d{1,2})期/.exec(trimmed) ??
      /\sS(\d{1,2})$/i.exec(trimmed);
    if (match) return Number(match[1]);
    // "Mushoku Tensei II: …"; a bare number ("Kaiju No. 8") is part of the name.
    const roman = /\s([IVX]{1,4})(?::|$)/.exec(trimmed)?.[1];
    if (roman && ROMAN_SEASONS.includes(roman)) return ROMAN_SEASONS.indexOf(roman);
  }
  return 1;
}

/**
 * Jimaku has one entry per season, like AniList: for a site that numbers
 * episodes per season (Netflix), the entry of that season, otherwise the
 * best match of the search.
 */
export function pickJimakuEntry(entries: JimakuEntry[], season: number | null | undefined): JimakuEntry | null {
  if (!season || season === 1) return entries.find((entry) => entrySeason(entry) === 1) ?? entries[0] ?? null;
  return entries.find((entry) => entrySeason(entry) === season) ?? null;
}

// ---------------------------------------------------------------------------
// File choice
// ---------------------------------------------------------------------------

/** One file of a Jimaku entry, as listed by its API. */
export interface JimakuFile {
  name: string;
  url: string;
  size: number;
  last_modified: string;
}

/** A subtitle that can be installed: a file, or one file inside a ZIP. */
export interface JimakuChoice {
  /** Name shown to the user and kept as the local file name. */
  name: string;
  url: string;
  /** Path of the subtitle inside the ZIP at `url`. */
  inner?: string;
}

export type JimakuInstallResult =
  | { status: "no-key" }
  | { status: "bad-key" }
  | { status: "not-found"; entryUrl: string | null }
  | { status: "installed"; fileName: string; entryUrl: string; choices: JimakuChoice[] }
  | { status: "error"; message: string };

const SUBTITLE_EXTENSION = /\.(?:srt|ass|ssa|vtt)$/i;
const ZIP_EXTENSION = /\.zip$/i;
/** Chinese, or Chinese and Japanese mixed on each line. */
const CHINESE = /\b(?:chs|cht|sc|tc|gb|big5|zh(?:-\w+)?)\b|简|繁|中文|中日/i;
/** Streaming sources: closest timing to what an anime site streams. */
const WEB_SOURCE = /\b(?:web(?:-?dl|-?rip)?|cr|nf|amzn|netflix|abema|b-?global|adn|dsnp|hidive|u-next|crunchyroll)\b/i;
const DISC_SOURCE = /\b(?:bd|bdrip|blu-?ray|bdmv|dvd)\b/i;
const JAPANESE_MARKER = /\b(?:jpn?|ja|japanese)\b|日本語/i;

/** Episode number written in a file name, or null when it names none. */
export function episodeNumberInName(name: string): number | null {
  const base = name.split("/").pop()?.replace(/\.[a-z0-9]{2,4}$/i, "") ?? "";
  // 第965話 counts from the first episode, like AniList and anime sites; a
  // season number such as S25E01 restarts at each season.
  const patterns = [
    /第(\d{1,4})[話话]/,
    /S\d{1,2}[ ._-]?E(\d{1,4})(?!\d)/i,
    /(?:^|[\s._\-[(])(?:E|EP|Ep|Episode)[ ._-]?(\d{1,4})(?!\d)/i,
    /\s-\s(\d{1,4})(?:v\d)?(?=$|[\s._\-[(])/,
    /\[(\d{1,4})(?:v\d)?\]/,
    /#(\d{1,4})(?!\d)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(base);
    if (match) return Number(match[1]);
  }
  // Last resort: a lone number once tags, resolutions and codecs are removed.
  const stripped = base
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(?:\d{3,4}p|[xh][ .]?26[45]|10-?bit|\d+(?:\.\d+)?ch|ddp?\d(?:\.\d)?|aac\d?(?:\.\d)?)\b/gi, " ");
  const numbers = [...stripped.matchAll(/(?:^|[\s._-])(\d{1,3})(?:v\d)?(?=$|[\s._-])/g)]
    .map((match) => Number(match[1]));
  return numbers.length ? numbers[numbers.length - 1] ?? null : null;
}

function choiceScore(name: string): number {
  let score = 0;
  if (WEB_SOURCE.test(name)) score += 3;
  if (DISC_SOURCE.test(name)) score -= 1;
  if (JAPANESE_MARKER.test(name)) score += 1;
  if (/\.(?:srt|vtt)$/i.test(name)) score += 1;
  return score;
}

function isUsableSubtitle(name: string): boolean {
  return SUBTITLE_EXTENSION.test(name) && !CHINESE.test(name);
}

/** Best first. Unknown episode (a film): every subtitle file. */
export function rankSubtitleFiles<T extends { name: string; modified?: number }>(
  files: T[],
  episode: number | null,
): T[] {
  return files
    .filter((file) => isUsableSubtitle(file.name))
    .filter((file) => episode === null || episodeNumberInName(file.name) === episode)
    .sort((left, right) =>
      choiceScore(right.name) - choiceScore(left.name) ||
      (right.modified ?? 0) - (left.modified ?? 0) ||
      left.name.localeCompare(right.name));
}

/** Direct subtitle files of the episode, best first. */
export function rankJimakuFiles(files: JimakuFile[], episode: number | null): JimakuChoice[] {
  return rankSubtitleFiles(
    files.map((file) => ({ ...file, modified: Date.parse(file.last_modified) || 0 })),
    episode,
  ).map((file) => ({ name: file.name, url: file.url }));
}

/** ZIP archives that may hold the episode: season packs, or this very episode. */
export function jimakuArchives(files: JimakuFile[], episode: number | null): JimakuFile[] {
  return files
    .filter((file) => ZIP_EXTENSION.test(file.name) && !CHINESE.test(file.name))
    .filter((file) => {
      const named = episodeNumberInName(file.name);
      // "01-12" names a range: its last number is not a single episode.
      return episode === null || named === null || named === episode || /\d\s*[-~]\s*\d/.test(file.name);
    })
    .sort((left, right) => choiceScore(right.name) - choiceScore(left.name));
}
