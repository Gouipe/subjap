// ---------------------------------------------------------------------------
// SubJap — Google account sync: storage keys and compact word codec
// ---------------------------------------------------------------------------
//
// Manual word decisions travel through `chrome.storage.sync` (about 100 KB in
// all, 8 KB per item). They are spread over fixed hash buckets so one change
// rewrites a few hundred bytes, and two PCs editing different words rarely
// touch the same item. One entry is `<status><day><key>`: a status letter,
// the decision day in three base-36 digits, then the lexical key.

import type { WordState, WordStatus } from "@/core/types";

export const SYNC_BUCKET_COUNT = 32;
export const SYNC_BUCKET_PREFIX = "sjw_";
/** Highest frequency rank already sorted in « Mots déjà connus ». */
export const SYNC_TRIAGE_KEY = "sj_triage";
/** Overlay display options (`OverlayOptions`). */
export const SYNC_OPTIONS_KEY = "sj_options";

/** Local flag: this PC's own decisions were merged with the account once. */
export const SYNC_MERGED_STORAGE_KEY = "subjap_sync_merged";
/** Local queue of changes not sent to the account yet. */
export const SYNC_PENDING_STORAGE_KEY = "subjap_sync_pending";
/** Local copy of the last failed send, shown in the options. */
export const SYNC_ERROR_STORAGE_KEY = "subjap_sync_error";
/** Bumped when decisions from another PC land locally: content scripts reload states. */
export const WORD_STATES_REVISION_STORAGE_KEY = "subjap_word_states_revision";

/** Share of the quota from which the options warn that space runs low. */
export const SYNC_QUOTA_WARNING_RATIO = 0.8;

const DAY_MS = 86_400_000;
const DAY_DIGITS = 3;

const STATUS_CODE: Record<WordStatus, string> = {
  known: "k",
  ignored: "i",
  unknown: "u",
  learning: "l",
};
const CODE_STATUS = new Map(
  Object.entries(STATUS_CODE).map(([status, code]) => [code, status as WordStatus]),
);

export interface SyncedWord {
  status: WordStatus;
  /** Day of the decision (days since 1970), for « most recent wins ». */
  day: number;
}

export function bucketKey(index: number): string {
  return `${SYNC_BUCKET_PREFIX}${String(index).padStart(2, "0")}`;
}

export function isBucketKey(key: string): boolean {
  return key.startsWith(SYNC_BUCKET_PREFIX);
}

export const ALL_BUCKET_KEYS = Array.from({ length: SYNC_BUCKET_COUNT }, (_, index) =>
  bucketKey(index),
);

/** FNV-1a over UTF-16 code units: stable across PCs and builds. */
export function bucketOf(wordKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < wordKey.length; index += 1) {
    hash ^= wordKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return bucketKey((hash >>> 0) % SYNC_BUCKET_COUNT);
}

/** Keys with a line break would split their entry; lexical keys never have one. */
export function isSyncableKey(wordKey: string): boolean {
  return wordKey.length > 0 && !/[\r\n]/.test(wordKey);
}

export function dayOf(ms: number | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(36 ** DAY_DIGITS - 1, Math.floor(ms / DAY_MS));
}

export function dayStart(day: number): number {
  return day * DAY_MS;
}

/** When a local manual decision was made, as precisely as the state tells. */
export function stateDay(state: WordState): number {
  return dayOf(state.updatedAt ?? state.knownAt);
}

export function decodeBucket(value: unknown): Map<string, SyncedWord> {
  const words = new Map<string, SyncedWord>();
  if (typeof value !== "string") return words;
  for (const line of value.split("\n")) {
    const status = CODE_STATUS.get(line.charAt(0));
    const day = Number.parseInt(line.slice(1, 1 + DAY_DIGITS), 36);
    const wordKey = line.slice(1 + DAY_DIGITS);
    if (!status || !Number.isFinite(day) || !wordKey) continue;
    words.set(wordKey, { status, day });
  }
  return words;
}

/** Sorted, so an unchanged bucket encodes identically and is not rewritten. */
export function encodeBucket(words: Map<string, SyncedWord>): string {
  return [...words.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([wordKey, word]) => {
      return `${STATUS_CODE[word.status]}${word.day.toString(36).padStart(DAY_DIGITS, "0")}${wordKey}`;
    })
    .join("\n");
}

/** JSON with sorted keys: two equal option objects compare equal. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/** Plain-language reason for a failed send, written for the options page. */
export function describeSyncError(message: string): string {
  if (/QUOTA_BYTES/.test(message)) {
    return "Espace plein : les nouvelles décisions restent sur ce PC.";
  }
  if (/MAX_WRITE_OPERATIONS|MAX_SUSTAINED/.test(message)) {
    return "Chrome limite le nombre d’envois : nouvel essai dans une minute.";
  }
  return `Envoi impossible : ${message}`;
}
