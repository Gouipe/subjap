// ---------------------------------------------------------------------------
// SubJap — Install an episode's Japanese subtitles from Jimaku's API
// ---------------------------------------------------------------------------

import type { PageEpisode } from "@/core/episode";
import { parseSubtitleFile } from "@/subtitles/parse";
import { getLocalSubtitle, saveLocalSubtitle } from "@/subtitles/local-storage";
import { estimateSubtitleSync } from "@/subtitles/auto-sync";
import {
  getJimakuApiKey,
  jimakuArchives,
  rankJimakuFiles,
  rankSubtitleFiles,
  type JimakuChoice,
  type JimakuFile,
  type JimakuInstallResult,
} from "@/subtitles/jimaku";
import { decodeSubtitleText, readZipEntries } from "@/subtitles/zip";

const API = "https://jimaku.cc/api";
const MAX_DOWNLOAD_SIZE = 30_000_000;
/** Few archives per episode: each one is a download. */
const MAX_ARCHIVES = 2;

class JimakuError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface JimakuEntry {
  id: number;
  name: string;
  anilist_id?: number | null;
}

async function api<T>(path: string, key: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: "omit",
    // Jimaku asks clients that cannot set a User-Agent to name themselves.
    headers: { Authorization: key, "X-Client-Id": "SubJap" },
  });
  if (response.status === 401 || response.status === 403) throw new JimakuError(401, "Clé Jimaku refusée.");
  if (response.status === 429) throw new JimakuError(429, "Trop de requêtes vers Jimaku, réessayez dans un instant.");
  if (!response.ok) throw new JimakuError(response.status, `Jimaku indisponible (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(new URL(url, "https://jimaku.cc/"), { credentials: "omit" });
  if (!response.ok) throw new JimakuError(response.status, `Téléchargement Jimaku impossible (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_SIZE) throw new Error("Fichier Jimaku trop volumineux.");
  return bytes;
}

/** Valid key: Jimaku answers a search with it. */
export async function checkJimakuKey(key: string): Promise<boolean> {
  try {
    await api<JimakuEntry[]>("/entries/search?anime=true&anilist_id=1", key.trim());
    return true;
  } catch (error) {
    if (error instanceof JimakuError && error.status === 401) return false;
    throw error;
  }
}

async function findEntry(episode: PageEpisode, key: string): Promise<JimakuEntry | null> {
  if (episode.anilistId) {
    const entries = await api<JimakuEntry[]>(
      `/entries/search?anime=true&anilist_id=${episode.anilistId}`, key);
    if (entries[0]) return entries[0];
  }
  if (!episode.series) return null;
  const entries = await api<JimakuEntry[]>(
    `/entries/search?anime=true&query=${encodeURIComponent(episode.series)}`, key);
  return entries[0] ?? null;
}

/** Subtitles of the episode found in the entry's season archives. */
async function archiveChoices(files: JimakuFile[], episode: number | null): Promise<JimakuChoice[]> {
  const choices: JimakuChoice[] = [];
  for (const archive of jimakuArchives(files, episode).slice(0, MAX_ARCHIVES)) {
    try {
      const entries = readZipEntries(await download(archive.url));
      for (const entry of rankSubtitleFiles(entries, episode)) {
        choices.push({ name: entry.name.split("/").pop() ?? entry.name, url: archive.url, inner: entry.name });
      }
    } catch (error) {
      console.warn("[SubJap] Archive Jimaku illisible:", archive.name, error);
    }
    if (choices.length) break;
  }
  return choices;
}

async function episodeChoices(entryId: number, episode: number | null, key: string): Promise<JimakuChoice[]> {
  // Jimaku's own episode filter guesses from names too; ours also reads
  // archives, so list everything once.
  const files = await api<JimakuFile[]>(`/entries/${entryId}/files`, key);
  const direct = rankJimakuFiles(files, episode);
  return direct.length ? direct : archiveChoices(files, episode);
}

async function readChoice(
  choice: JimakuChoice,
  downloads = new Map<string, Promise<Uint8Array>>(),
): Promise<string> {
  // Several choices can sit in the same archive: download it once.
  let pending = downloads.get(choice.url);
  if (!pending) {
    pending = download(choice.url);
    downloads.set(choice.url, pending);
  }
  const bytes = await pending;
  if (!choice.inner) return decodeSubtitleText(bytes);
  const entry = readZipEntries(bytes).find((candidate) => candidate.name === choice.inner);
  if (!entry) throw new Error("Fichier absent de l’archive Jimaku.");
  return decodeSubtitleText(await entry.read());
}

/**
 * Find the episode on Jimaku and save its best Japanese file as the video's
 * local primary track. `choice` installs another file the user picked.
 */
export async function installFromJimaku(
  videoId: string,
  episode: PageEpisode | null,
  choice?: JimakuChoice,
): Promise<JimakuInstallResult> {
  const key = await getJimakuApiKey();
  if (!key) return { status: "no-key" };
  try {
    if (!episode || (!episode.anilistId && !episode.series)) return { status: "not-found", entryUrl: null };
    const entry = await findEntry(episode, key);
    if (!entry) return { status: "not-found", entryUrl: null };
    const entryUrl = `https://jimaku.cc/entry/${entry.id}`;
    const choices = await episodeChoices(entry.id, episode.episode, key);
    const ordered = choice
      ? [choice, ...choices.filter((item) => item.url !== choice.url || item.inner !== choice.inner)]
      : choices;
    // A file can be empty or in an unknown format: try the next one.
    for (const candidate of ordered.slice(0, 3)) {
      const content = await readChoice(candidate);
      if (parseSubtitleFile(candidate.name, content).length === 0) continue;
      await saveLocalSubtitle(videoId, {
        fileName: candidate.name,
        content,
        offsetSeconds: 0,
        updatedAt: Date.now(),
        jimakuChoices: choices,
        jimakuAutomatic: !choice,
      }, "primary");
      return { status: "installed", fileName: candidate.name, entryUrl, choices };
    }
    return { status: "not-found", entryUrl };
  } catch (error) {
    if (error instanceof JimakuError && error.status === 401) return { status: "bad-key" };
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Other files tried when the installed one is not in time: each is a download. */
const MAX_SYNC_ALTERNATIVES = 4;

/**
 * The automatically installed file is not in time with the player's
 * translation (another cut of the episode): install the first other file of
 * the episode already in time. When none is, a file that matches nothing is
 * replaced by the first that aligns once shifted; a file that aligns once
 * shifted stays. Either way the choice is made once.
 */
export async function pickSyncedJimakuFile(
  videoId: string,
  referenceStarts: number[],
  currentAligns: boolean,
): Promise<boolean> {
  const record = await getLocalSubtitle(videoId, "primary");
  if (!record?.jimakuAutomatic) return false;
  const downloads = new Map<string, Promise<Uint8Array>>();
  const alternatives = (record.jimakuChoices ?? [])
    .filter((choice) => choice.name !== record.fileName)
    .slice(0, MAX_SYNC_ALTERNATIVES);
  let pick: { choice: JimakuChoice; content: string } | null = null;
  let fallback: { choice: JimakuChoice; content: string } | null = null;
  for (const choice of alternatives) {
    try {
      const content = await readChoice(choice, downloads);
      const cues = parseSubtitleFile(choice.name, content);
      const sync = estimateSubtitleSync(cues.map((cue) => cue.start), referenceStarts);
      if (sync === "synced") {
        pick = { choice, content };
        break;
      }
      if (sync && !currentAligns) fallback ??= { choice, content };
    } catch (error) {
      console.warn("[SubJap] Fichier Jimaku illisible:", choice.name, error);
    }
  }
  pick ??= fallback;
  // The user may have picked or set something meanwhile.
  const current = await getLocalSubtitle(videoId, "primary");
  if (current?.updatedAt !== record.updatedAt || !current.jimakuAutomatic) return false;
  if (!pick) {
    await saveLocalSubtitle(videoId, { ...current, jimakuAutomatic: false }, "primary");
    return false;
  }
  await saveLocalSubtitle(videoId, {
    fileName: pick.choice.name,
    content: pick.content,
    offsetSeconds: 0,
    updatedAt: Date.now(),
    jimakuChoices: record.jimakuChoices,
  }, "primary");
  console.info("[SubJap] Fichier Jimaku remplacé par une version en phase avec la traduction:", pick.choice.name);
  return true;
}
