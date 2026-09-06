import { youtubeVideoId } from "@/core/youtube";

export interface LocalSubtitleRecord {
  fileName: string;
  content: string;
  offsetSeconds: number;
  updatedAt: number;
}

const STORAGE_PREFIX = "subjap_local_subtitle_watch_";

/** Keep existing Netflix keys intact; YouTube gets a separate namespace. */
export function localSubtitleVideoId(url: string): string | null {
  const youtubeId = youtubeVideoId(url);
  return youtubeId ? `youtube:${youtubeId}` : netflixWatchId(url);
}

export function netflixWatchId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)netflix\.com$/i.test(parsed.hostname)) return null;
    return parsed.pathname.match(/^\/watch\/([^/?#]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function localSubtitleStorageKey(watchId: string): string {
  return `${STORAGE_PREFIX}${watchId}`;
}

function isLocalSubtitleRecord(value: unknown): value is LocalSubtitleRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LocalSubtitleRecord>;
  return (
    typeof record.fileName === "string" &&
    typeof record.content === "string" &&
    typeof record.offsetSeconds === "number" &&
    Number.isFinite(record.offsetSeconds) &&
    typeof record.updatedAt === "number"
  );
}

export async function getLocalSubtitle(watchId: string): Promise<LocalSubtitleRecord | null> {
  const key = localSubtitleStorageKey(watchId);
  const stored = await chrome.storage.local.get(key);
  return isLocalSubtitleRecord(stored[key]) ? stored[key] : null;
}

export async function saveLocalSubtitle(
  watchId: string,
  record: LocalSubtitleRecord,
): Promise<void> {
  await chrome.storage.local.set({
    [localSubtitleStorageKey(watchId)]: record,
  });
}

export async function removeLocalSubtitle(watchId: string): Promise<void> {
  await chrome.storage.local.remove(localSubtitleStorageKey(watchId));
}
