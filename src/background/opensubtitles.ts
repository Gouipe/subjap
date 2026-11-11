// ---------------------------------------------------------------------------
// SubJap — Install an episode's translation from OpenSubtitles' API
// ---------------------------------------------------------------------------

import type { PageEpisode } from "@/core/episode";
import { getOptions } from "@/core/options";
import { parseSubtitleFile } from "@/subtitles/parse";
import { getLocalSubtitle, saveLocalSubtitle } from "@/subtitles/local-storage";
import {
  getOpenSubtitlesApiKey,
  rankOpenSubtitlesResults,
  type OpenSubtitlesChoice,
  type OpenSubtitlesInstallResult,
  type OpenSubtitlesResult,
  type TranslationLanguage,
} from "@/subtitles/opensubtitles";
import { decodeSubtitleText } from "@/subtitles/zip";

const API = "https://api.opensubtitles.com/api/v1";
const MAX_DOWNLOAD_SIZE = 5_000_000;

class OpenSubtitlesError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function headers(key: string): Record<string, string> {
  // OpenSubtitles refuses clients that do not name themselves; a browser
  // cannot set User-Agent, so the name also goes in X-User-Agent.
  const name = `SubJap v${chrome.runtime.getManifest().version}`;
  return { "Api-Key": key, "User-Agent": name, "X-User-Agent": name, Accept: "application/json" };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; errors?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.errors) && typeof body.errors[0] === "string") return body.errors[0];
  } catch {
    // No JSON body.
  }
  return `HTTP ${response.status}`;
}

async function api<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "omit",
    headers: { ...headers(key), ...(init.headers as Record<string, string> | undefined) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new OpenSubtitlesError(401, "Clé OpenSubtitles refusée.");
  }
  if (response.status === 406) {
    // Daily download quota: OpenSubtitles says when it renews.
    throw new OpenSubtitlesError(406, await readError(response));
  }
  if (response.status === 429) {
    throw new OpenSubtitlesError(429, "Trop de requêtes vers OpenSubtitles, réessayez dans un instant.");
  }
  if (!response.ok) {
    throw new OpenSubtitlesError(response.status, `OpenSubtitles indisponible (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

/** Query string with sorted keys: OpenSubtitles redirects other orders. */
function query(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null && entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) =>
      `${name}=${encodeURIComponent(String(value).toLowerCase()).replace(/%20/g, "+").replace(/%2C/g, ",")}`)
    .join("&");
}

/** Valid key: OpenSubtitles answers a title search with it. */
export async function checkOpenSubtitlesKey(key: string): Promise<boolean> {
  try {
    await api(`/features?${query({ query: "frieren", type: "tvshow" })}`, key.trim());
    return true;
  } catch (error) {
    if (error instanceof OpenSubtitlesError && error.status === 401) return false;
    throw error;
  }
}

interface Feature {
  attributes?: {
    title?: string;
    original_title?: string;
    title_aka?: string[];
    feature_id?: string | number;
  };
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The series or film named like the page's title; its translations also count. */
async function findFeature(episode: PageEpisode, key: string): Promise<number | null> {
  if (!episode.series || episode.series.length < 3) return null;
  const { data = [] } = await api<{ data?: Feature[] }>(`/features?${query({
    full_search: true,
    query: episode.series,
    type: episode.movie ? "movie" : "tvshow",
  })}`, key);
  const wanted = normalizeTitle(episode.series);
  const named = (feature: Feature): boolean => {
    const attributes = feature.attributes ?? {};
    return [attributes.title, attributes.original_title, ...(attributes.title_aka ?? [])]
      .some((title) => !!title && normalizeTitle(title) === wanted);
  };
  const feature = data.find(named) ?? data[0];
  const id = Number(feature?.attributes?.feature_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function search(
  episode: PageEpisode,
  languages: TranslationLanguage[],
  key: string,
): Promise<OpenSubtitlesChoice[]> {
  const position = episode.movie ? null : { season: episode.season ?? null, episode: episode.episode };
  const shared = { languages: [...languages].sort().join(",") };
  const featureId = await findFeature(episode, key);
  const attempts: Record<string, string | number | null | undefined>[] = [];
  if (featureId) {
    attempts.push(episode.movie
      ? { ...shared, id: featureId }
      : { ...shared, parent_feature_id: featureId, season_number: position?.season, episode_number: position?.episode });
  }
  // Without the series' id, or when it lists nothing: search by name.
  attempts.push(episode.movie
    ? { ...shared, query: episode.series, type: "movie" }
    : { ...shared, query: episode.series, type: "episode", season_number: position?.season, episode_number: position?.episode });
  for (const params of attempts) {
    const { data = [] } = await api<{ data?: OpenSubtitlesResult[] }>(`/subtitles?${query(params)}`, key);
    const choices = rankOpenSubtitlesResults(data, languages, position);
    if (choices.length) return choices;
  }
  return [];
}

async function download(choice: OpenSubtitlesChoice, key: string): Promise<string> {
  const { link } = await api<{ link?: unknown }>("/download", key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: choice.fileId, sub_format: "srt" }),
  });
  // The link comes from OpenSubtitles, but stay on its hosts all the same.
  const target = typeof link === "string" ? new URL(link) : null;
  if (!target || target.protocol !== "https:" || !/(?:^|\.)opensubtitles\.(?:com|org)$/i.test(target.hostname)) {
    throw new Error("Adresse de fichier OpenSubtitles inattendue.");
  }
  const response = await fetch(target, { credentials: "omit" });
  if (!response.ok) throw new Error(`Téléchargement OpenSubtitles impossible (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_SIZE) throw new Error("Fichier OpenSubtitles trop volumineux.");
  return decodeSubtitleText(bytes);
}

/** French then English, or the other way round, as the user prefers. */
async function preferredLanguages(): Promise<TranslationLanguage[]> {
  const preferred = (await getOptions()).secondarySubtitleLanguage;
  return preferred === "en" ? ["en", "fr"] : ["fr", "en"];
}

/**
 * Find the episode on OpenSubtitles and save its best translation as the
 * video's local translation. Each install costs one of the key's daily
 * downloads, so only one file is downloaded. `choice` installs another file
 * the user picked; `languages` narrows the search (French only, say).
 */
export async function installFromOpenSubtitles(
  videoId: string,
  episode: PageEpisode | null,
  { choice, languages }: { choice?: OpenSubtitlesChoice; languages?: TranslationLanguage[] } = {},
): Promise<OpenSubtitlesInstallResult> {
  const key = await getOpenSubtitlesApiKey();
  if (!key) return { status: "no-key" };
  try {
    let choices: OpenSubtitlesChoice[];
    if (choice) {
      // A file picked in the popup, among those listed at the first install.
      choices = (await getLocalSubtitle(videoId, "secondary"))?.openSubtitlesChoices ?? [choice];
    } else {
      if (!episode?.series) return { status: "not-found" };
      choices = await search(episode, languages ?? await preferredLanguages(), key);
    }
    const candidate = choice ?? choices[0];
    if (!candidate) return { status: "not-found" };
    const content = await download(candidate, key);
    if (parseSubtitleFile(`${candidate.name}.srt`, content).length === 0) {
      return { status: "error", message: "Fichier OpenSubtitles vide ou illisible." };
    }
    const fileName = /\.srt$/i.test(candidate.name) ? candidate.name : `${candidate.name}.srt`;
    await saveLocalSubtitle(videoId, {
      fileName,
      content,
      offsetSeconds: 0,
      updatedAt: Date.now(),
      openSubtitlesChoices: choices,
    }, "secondary");
    return { status: "installed", fileName, language: candidate.language, choices };
  } catch (error) {
    if (error instanceof OpenSubtitlesError && error.status === 401) return { status: "bad-key" };
    if (error instanceof OpenSubtitlesError && error.status === 406) {
      return { status: "quota", message: `Quota de téléchargements OpenSubtitles atteint pour aujourd’hui. ${error.message}` };
    }
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
