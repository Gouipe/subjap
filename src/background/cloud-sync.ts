// ---------------------------------------------------------------------------
// SubJap — Google account sync of manual decisions, sorting progress, display
// ---------------------------------------------------------------------------
//
// The account copy (`chrome.storage.sync`) is the shared truth once a PC has
// merged into it: local changes are queued and sent a moment later, changes
// from another PC are applied to IndexedDB as they arrive. The first time a
// PC syncs, its existing decisions are merged rather than replaced, so words
// marked before sync existed are kept (most recent decision wins).
//
// Every step runs on one promise chain: the queue, the sends and the remote
// changes never interleave inside this service worker.

import { db } from "@/core/db";
import {
  ALL_BUCKET_KEYS,
  bucketOf,
  dayStart,
  decodeBucket,
  describeSyncError,
  encodeBucket,
  isBucketKey,
  isSyncableKey,
  stableJson,
  stateDay,
  SYNC_ERROR_STORAGE_KEY,
  SYNC_MERGED_STORAGE_KEY,
  SYNC_OPTIONS_KEY,
  SYNC_PENDING_STORAGE_KEY,
  SYNC_TRIAGE_KEY,
  WORD_STATES_REVISION_STORAGE_KEY,
  type SyncedWord,
} from "@/core/cloud-sync";
import { OPTIONS_STORAGE_KEY } from "@/core/options";
import type { MessageResult, WordState } from "@/core/types";
import { setTriagedRank, triagedRank } from "./known-triage";

const FLUSH_DELAY_MS = 2_000;
const RETRY_DELAY_MS = 60_000;

interface PendingSync {
  /** Word keys whose local manual state (or its absence) must reach the account. */
  words: string[];
  triage?: boolean;
  options?: boolean;
}

let chain: Promise<unknown> = Promise.resolve();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch((err: unknown) => {
    console.warn("[SubJap] Account sync step failed:", err);
  });
  return run;
}

async function readPending(): Promise<PendingSync> {
  const stored = (await chrome.storage.local.get(SYNC_PENDING_STORAGE_KEY))[
    SYNC_PENDING_STORAGE_KEY
  ] as Partial<PendingSync> | undefined;
  return {
    words: Array.isArray(stored?.words) ? stored.words.filter((key) => typeof key === "string") : [],
    triage: stored?.triage === true,
    options: stored?.options === true,
  };
}

function isPendingEmpty(pending: PendingSync): boolean {
  return pending.words.length === 0 && !pending.triage && !pending.options;
}

async function writePending(pending: PendingSync): Promise<void> {
  if (isPendingEmpty(pending)) await chrome.storage.local.remove(SYNC_PENDING_STORAGE_KEY);
  else await chrome.storage.local.set({ [SYNC_PENDING_STORAGE_KEY]: pending });
}

async function isMerged(): Promise<boolean> {
  return (await chrome.storage.local.get(SYNC_MERGED_STORAGE_KEY))[SYNC_MERGED_STORAGE_KEY] === true;
}

async function readLocalOptions(): Promise<unknown> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(OPTIONS_STORAGE_KEY);
  return stored[OPTIONS_STORAGE_KEY];
}

/** Content scripts drop their cached word states when this changes. */
async function announceWordStatesChanged(): Promise<void> {
  await chrome.storage.local.set({ [WORD_STATES_REVISION_STORAGE_KEY]: Date.now() });
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void serial(flush);
  }, delay);
}

function manualFromAccount(key: string, word: SyncedWord, local?: WordState): WordState {
  const at = dayStart(word.day);
  return {
    key,
    status: word.status,
    source: "manual",
    ...(word.status === "known" ? { knownAt: local?.knownAt ?? at } : {}),
    updatedAt: at,
  };
}

// ── Queue ─────────────────────────────────────────────────────────────────

function enqueue(change: Partial<PendingSync>): void {
  void serial(async () => {
    const pending = await readPending();
    const words = new Set(pending.words);
    for (const key of change.words ?? []) if (isSyncableKey(key)) words.add(key);
    await writePending({
      words: [...words],
      triage: pending.triage || change.triage,
      options: pending.options || change.options,
    });
  });
  scheduleFlush();
}

/** Send these words' local manual decisions (or their withdrawal) to the account. */
export function queueWordSync(keys: string[]): void {
  if (keys.length > 0) enqueue({ words: keys });
}

export function queueTriageSync(): void {
  enqueue({ triage: true });
}

// ── First merge of this PC ───────────────────────────────────────────────

async function mergeIntoAccount(): Promise<void> {
  const account: Record<string, unknown> = await chrome.storage.sync.get(null);
  const remote = new Map<string, SyncedWord>();
  for (const [key, value] of Object.entries(account)) {
    if (isBucketKey(key)) for (const [word, state] of decodeBucket(value)) remote.set(word, state);
  }

  const manual = await db.wordStates.where("source").equals("manual").toArray();
  const manualByKey = new Map(manual.map((state) => [state.key, state]));
  const toSend: string[] = [];
  const toAdopt: WordState[] = [];
  for (const local of manual) {
    const shared = remote.get(local.key);
    if (!shared) toSend.push(local.key);
    else if (shared.status !== local.status) {
      // Same day or older here: the account copy wins.
      if (stateDay(local) > shared.day) toSend.push(local.key);
      else toAdopt.push(manualFromAccount(local.key, shared, local));
    }
  }
  for (const [key, shared] of remote) {
    if (!manualByKey.has(key)) toAdopt.push(manualFromAccount(key, shared));
  }
  if (toAdopt.length > 0) {
    await db.wordStates.bulkPut(toAdopt);
    await announceWordStatesChanged();
  }

  const pending = await readPending();
  const remoteRank = typeof account[SYNC_TRIAGE_KEY] === "number" ? account[SYNC_TRIAGE_KEY] : 0;
  const localRank = await triagedRank();
  if (remoteRank > localRank) await setTriagedRank(remoteRank);
  else if (localRank > remoteRank) pending.triage = true;

  // Display settings: the account copy wins, a PC alone shares its own.
  const remoteOptions = account[SYNC_OPTIONS_KEY];
  const localOptions = await readLocalOptions();
  if (remoteOptions && typeof remoteOptions === "object") {
    if (stableJson(remoteOptions) !== stableJson(localOptions)) {
      await chrome.storage.local.set({ [OPTIONS_STORAGE_KEY]: remoteOptions });
    }
  } else if (localOptions !== undefined) {
    pending.options = true;
  }

  pending.words = [...new Set([...pending.words, ...toSend.filter(isSyncableKey)])];
  await writePending(pending);
  await chrome.storage.local.set({ [SYNC_MERGED_STORAGE_KEY]: true });
  if (!isPendingEmpty(pending)) scheduleFlush();
}

// ── Send ──────────────────────────────────────────────────────────────────

async function flush(): Promise<void> {
  if (!(await isMerged())) await mergeIntoAccount();
  const pending = await readPending();
  if (isPendingEmpty(pending)) return;

  const buckets = [...new Set(pending.words.map(bucketOf))];
  const account: Record<string, unknown> = await chrome.storage.sync.get([
    ...buckets,
    SYNC_TRIAGE_KEY,
    SYNC_OPTIONS_KEY,
  ]);
  const locals = await db.wordStates.bulkGet(pending.words);
  const localByKey = new Map(pending.words.map((key, index) => [key, locals[index]]));

  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];
  for (const bucket of buckets) {
    const words = decodeBucket(account[bucket]);
    for (const key of pending.words) {
      if (bucketOf(key) !== bucket) continue;
      const local = localByKey.get(key);
      if (local?.source === "manual") words.set(key, { status: local.status, day: stateDay(local) });
      else words.delete(key);
    }
    const encoded = encodeBucket(words);
    if (encoded === (account[bucket] ?? "")) continue;
    if (encoded) toSet[bucket] = encoded;
    else toRemove.push(bucket);
  }

  if (pending.triage) {
    const localRank = await triagedRank();
    const remoteRank = typeof account[SYNC_TRIAGE_KEY] === "number" ? account[SYNC_TRIAGE_KEY] : 0;
    if (localRank > remoteRank) toSet[SYNC_TRIAGE_KEY] = localRank;
  }

  if (pending.options) {
    // A local removal (« Relancer l’assistant », reset) stays local: only
    // « Tout effacer » erases the account copy, explicitly.
    const localOptions = await readLocalOptions();
    if (
      localOptions !== undefined &&
      stableJson(localOptions) !== stableJson(account[SYNC_OPTIONS_KEY])
    ) {
      toSet[SYNC_OPTIONS_KEY] = localOptions;
    }
  }

  try {
    if (Object.keys(toSet).length > 0) await chrome.storage.sync.set(toSet);
    if (toRemove.length > 0) await chrome.storage.sync.remove(toRemove);
    await writePending({ words: [] });
    await chrome.storage.local.remove(SYNC_ERROR_STORAGE_KEY);
  } catch (err) {
    // The queue stays: the next change, restart or retry sends it again.
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[SubJap] Account sync send failed:", message);
    await chrome.storage.local.set({ [SYNC_ERROR_STORAGE_KEY]: describeSyncError(message) });
    scheduleFlush(RETRY_DELAY_MS);
  }
}

// ── Receive ───────────────────────────────────────────────────────────────

async function applyAccountChanges(
  changes: Record<string, chrome.storage.StorageChange>,
): Promise<void> {
  // Not merged yet: merging reads the whole account copy, this change included.
  if (!(await isMerged())) {
    await mergeIntoAccount();
    return;
  }

  const pending = new Set((await readPending()).words);
  const changedBuckets = Object.keys(changes).filter(isBucketKey);
  if (changedBuckets.length > 0) {
    const bucketSet = new Set(changedBuckets);
    const remote = new Map<string, SyncedWord>();
    for (const bucket of changedBuckets) {
      for (const [key, word] of decodeBucket(changes[bucket]?.newValue)) remote.set(key, word);
    }
    const manual = (await db.wordStates.where("source").equals("manual").toArray()).filter(
      (state) => bucketSet.has(bucketOf(state.key)) && !pending.has(state.key),
    );
    const manualByKey = new Map(manual.map((state) => [state.key, state]));
    const upserts: WordState[] = [];
    for (const [key, word] of remote) {
      if (pending.has(key)) continue;
      const local = manualByKey.get(key);
      if (local?.status !== word.status) upserts.push(manualFromAccount(key, word, local));
    }
    const removals = manual
      .filter((state) => isSyncableKey(state.key) && !remote.has(state.key))
      .map((state) => state.key);
    if (upserts.length > 0 || removals.length > 0) {
      await db.transaction("rw", db.wordStates, async () => {
        if (removals.length > 0) await db.wordStates.bulkDelete(removals);
        if (upserts.length > 0) await db.wordStates.bulkPut(upserts);
      });
      await announceWordStatesChanged();
    }
  }

  const triage = changes[SYNC_TRIAGE_KEY];
  if (triage) {
    const rank = typeof triage.newValue === "number" ? triage.newValue : 0;
    if (rank === 0 || rank > (await triagedRank())) await setTriagedRank(rank);
  }

  const options = changes[SYNC_OPTIONS_KEY];
  if (options) {
    const localOptions = await readLocalOptions();
    const remoteOptions: unknown = options.newValue;
    if (remoteOptions === undefined) {
      if (localOptions !== undefined) await chrome.storage.local.remove(OPTIONS_STORAGE_KEY);
    } else if (stableJson(remoteOptions) !== stableJson(localOptions)) {
      await chrome.storage.local.set({ [OPTIONS_STORAGE_KEY]: remoteOptions });
    }
  }
}

// ── Reset, status, startup ────────────────────────────────────────────────

/**
 * Run a local wipe, then forget the queue. "device" merges again, which
 * reloads the account copy; "everywhere" erases that copy too.
 */
export function resetSyncedData(
  scope: "device" | "everywhere",
  wipeLocal: () => Promise<void>,
): Promise<void> {
  return serial(async () => {
    await wipeLocal();
    await writePending({ words: [] });
    await chrome.storage.local.remove(SYNC_ERROR_STORAGE_KEY);
    if (scope === "everywhere") {
      await chrome.storage.sync.remove([...ALL_BUCKET_KEYS, SYNC_TRIAGE_KEY, SYNC_OPTIONS_KEY]);
      await chrome.storage.local.set({ [SYNC_MERGED_STORAGE_KEY]: true });
    } else {
      await chrome.storage.local.set({ [SYNC_MERGED_STORAGE_KEY]: false });
      await mergeIntoAccount();
    }
  });
}

export async function syncStatus(): Promise<MessageResult<"sync:status">> {
  const [account, bytesInUse, stored] = await Promise.all([
    chrome.storage.sync.get(ALL_BUCKET_KEYS),
    chrome.storage.sync.getBytesInUse(null),
    chrome.storage.local.get(SYNC_ERROR_STORAGE_KEY),
  ]);
  const words = Object.values(account).reduce<number>(
    (total, value) => total + decodeBucket(value).size,
    0,
  );
  const error: unknown = (stored as Record<string, unknown>)[SYNC_ERROR_STORAGE_KEY];
  return {
    words,
    bytesInUse,
    quotaBytes: chrome.storage.sync.QUOTA_BYTES,
    error: typeof error === "string" ? error : null,
  };
}

/** Call once at service worker start, at top level so events wake it. */
export function registerCloudSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      void serial(() => applyAccountChanges(changes));
    } else if (areaName === "local" && changes[OPTIONS_STORAGE_KEY]) {
      enqueue({ options: true });
    }
  });

  void serial(async () => {
    if (!(await isMerged())) await mergeIntoAccount();
    else if (!isPendingEmpty(await readPending())) scheduleFlush();
  });
}
