import { youtubeVideoId } from "@/core/youtube";
import type { SubtitleCue } from "@/core/types";
import { parseSubtitleFile } from "@/subtitles/parse";
import type { JimakuChoice } from "@/subtitles/jimaku";

export type LocalSubtitleRole = "primary" | "secondary";

/** From this time of the file on, its lines are shifted by `offset` seconds. */
export interface SyncSegment {
  from: number;
  offset: number;
}

export interface LocalSubtitleRecord {
  fileName: string;
  content: string;
  offsetSeconds: number;
  updatedAt: number;
  /**
   * The offset was set by the user, or already aligned automatically on the
   * player's translation: never shift it automatically again.
   */
  syncChecked?: boolean;
  /**
   * Automatic alignment on the player's translation, part by part, added to
   * `offsetSeconds` (which stays the user's own adjustment).
   */
  syncSegments?: SyncSegment[];
  /** Installed from Jimaku: every file of the episode, to pick another one. */
  jimakuChoices?: JimakuChoice[];
}

/** Shift of a line starting at `start` in the file, from the automatic alignment. */
export function syncSegmentOffset(segments: SyncSegment[] | undefined, start: number): number {
  let offset = segments?.[0]?.offset ?? 0;
  for (const segment of segments ?? []) {
    if (segment.from > start) break;
    offset = segment.offset;
  }
  return Number.isFinite(offset) ? offset : 0;
}

const STORAGE_PREFIX = "subjap_local_subtitle_watch_";

/** Keep existing Netflix keys intact; YouTube gets a separate namespace. */
export function localSubtitleVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
      const youtubeId = youtubeVideoId(url);
      return youtubeId ? `youtube:${youtubeId}` : null;
    }
    if (/(^|\.)netflix\.com$/i.test(parsed.hostname)) {
      return netflixWatchId(url);
    }
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.search = new URLSearchParams(
      [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
      ),
    ).toString();
    return `url:${hashVideoUrl(parsed.href)}`;
  } catch {
    return null;
  }
}

function hashVideoUrl(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
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

export function localSubtitleStorageKey(
  videoId: string,
  role: LocalSubtitleRole = "secondary",
): string {
  // Keep the original key for secondary tracks so existing imports remain available.
  return role === "secondary"
    ? `${STORAGE_PREFIX}${videoId}`
    : `${STORAGE_PREFIX}role:primary:${videoId}`;
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

export function parseLocalSubtitleCues(
  videoId: string,
  role: LocalSubtitleRole,
  record: LocalSubtitleRecord | null,
): SubtitleCue[] {
  if (!record) return [];
  const sessionId = `${videoId}:local:${role}:${record.updatedAt}:${record.fileName}`;
  return parseSubtitleFile(record.fileName, record.content).map((cue, index) => ({
    ...cue,
    id: `${sessionId}:${index}:${cue.id}`,
    start: cue.start + record.offsetSeconds + syncSegmentOffset(record.syncSegments, cue.start),
    end: cue.end + record.offsetSeconds + syncSegmentOffset(record.syncSegments, cue.start),
    language: role === "primary" ? "ja" : "local",
    source: {
      kind: "track" as const,
      sessionId,
      trackId: `local-${role}`,
      resourceId: record.fileName,
      segmentId: cue.id,
      startPrecision: "exact" as const,
    },
  }));
}

export async function getLocalSubtitle(
  videoId: string,
  role: LocalSubtitleRole = "secondary",
): Promise<LocalSubtitleRecord | null> {
  const key = localSubtitleStorageKey(videoId, role);
  const stored = await chrome.storage.local.get(key);
  return isLocalSubtitleRecord(stored[key]) ? stored[key] : null;
}

export async function saveLocalSubtitle(
  videoId: string,
  record: LocalSubtitleRecord,
  role: LocalSubtitleRole = "secondary",
): Promise<void> {
  await chrome.storage.local.set({
    [localSubtitleStorageKey(videoId, role)]: record,
  });
}

export async function removeLocalSubtitle(
  videoId: string,
  role: LocalSubtitleRole = "secondary",
): Promise<void> {
  await chrome.storage.local.remove(localSubtitleStorageKey(videoId, role));
}
