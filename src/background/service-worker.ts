// ---------------------------------------------------------------------------
// SubJap — Background service worker
// ---------------------------------------------------------------------------

import { db } from "@/core/db";
import { AI_SETTINGS_STORAGE_KEY } from "@/core/ai-settings";
import { ENABLED_STORAGE_KEY, isEnabledValue, isSubJapEnabled } from "@/core/enabled";
import { onMessage } from "@/core/messaging";
import { canonicalizeLexicalKey, lexicalKeyCandidates } from "@/core/lexical-key";
import { fetchJmdictTgz, JMDICT_DEFAULT_URL } from "@/dictionary/jmdict";
import { entrySpellings, selectDictionaryEntry } from "@/dictionary/match";
import { toHiragana } from "@/core/kana";
import {
  fetchJapaneseFrequencyRanks,
  FREQUENCY_DATA_VERSION,
  type FrequencyEntry,
} from "@/dictionary/frequency";
import { markDictionaryLoaded } from "@/onboarding";
import { fetchNetflixTimedText } from "./netflix-timed-text";
import {
  countAnkiWordPresenceChanges,
  extractAnkiWordPresences,
  extractAnkiWordStates,
  planImportedStateReconciliation,
  WORD_STATUS_PRIORITY,
} from "./anki-known";
import { prepareAiEnrichmentCandidates } from "./ai-enrichment";
import {
  ANKI_COMPREHENSION_DECK,
  ANKI_PRODUCTION_DECK,
  ANKI_PRODUCTION_REQUEST_TAG,
  ANKI_VOCABULARY_PARENT_DECK,
  MIGAKU_BACK_BODY,
  MIGAKU_BACK_TEMPLATE,
  MIGAKU_COMPREHENSION_TEMPLATE_NAME,
  MIGAKU_CSS,
  MIGAKU_FIELDS,
  MIGAKU_FRONT_TEMPLATE,
  MIGAKU_LEGACY_BACK_BODY,
  MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT,
  MIGAKU_PRODUCTION_BACK_TEMPLATE,
  MIGAKU_PRODUCTION_FRONT_TEMPLATE,
  MIGAKU_PRODUCTION_TEMPLATE_NAME,
  MIGAKU_AUDIO_CONTROLS_FRAGMENT,
  MIGAKU_REVIEW_SHORTCUTS_FRAGMENT,
  MIGAKU_TEMPLATE_MARKER,
  MIGAKU_TEMPLATE_MARKER_V2,
  MIGAKU_TEMPLATE_MARKER_V3,
  MIGAKU_TEMPLATE_MARKER_V4,
  MIGAKU_TEMPLATE_MARKER_V5,
  MIGAKU_TEMPLATE_MARKER_V6,
  MIGAKU_TEMPLATE_MARKER_V7,
  MIGAKU_TEMPLATE_MARKER_V8,
  MIGAKU_TEMPLATE_MARKER_V9,
  MIGAKU_TEMPLATE_MARKER_V10,
  MIGAKU_TEMPLATE_MARKER_V11,
  MIGAKU_TEMPLATE_MARKER_V12,
  MIGAKU_TEMPLATE_MARKER_V13,
} from "./anki-presentation";
import type { MineCard, SrsState, WordState } from "@/core/types";

// ---------------------------------------------------------------------------
// First-install: open the options page so the onboarding wizard can run.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if ((details.reason as string) === "install") {
    void chrome.runtime.openOptionsPage();
  }
  void ensureFrequencyRanks();
  void scheduleProductionReleaseAlarm();
  void isSubJapEnabled().then(updateEnabledBadge);
});

chrome.runtime.onStartup.addListener(() => {
  void isSubJapEnabled().then(updateEnabledBadge);
  void ensureFrequencyRanks();
  void scheduleProductionReleaseAlarm();
  void maintainProductionCards().catch((err) => {
    console.info("[SubJap] Pending production release unavailable:", err);
  });
});

// ---------------------------------------------------------------------------
// Global on/off switch: the action badge shows "OFF" while SubJap is off.
// ---------------------------------------------------------------------------

const DISABLED_BADGE_COLOR = "#343842";
const DISABLED_BADGE_TEXT_COLOR = "#f4f1ea";
const CAPTURE_BADGE_COLOR = "#78d6a3";

async function updateEnabledBadge(enabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: DISABLED_BADGE_COLOR });
  await chrome.action.setBadgeTextColor({ color: DISABLED_BADGE_TEXT_COLOR });
  // The tab audio capture sets an "ON" badge on its tab, which would
  // otherwise hide the global state there.
  const capturedTabs = await new Promise<chrome.tabCapture.CaptureInfo[]>((resolve) => {
    chrome.tabCapture.getCapturedTabs(resolve);
  });
  for (const { tabId, status } of capturedTabs) {
    if (status !== "active") continue;
    await chrome.action.setBadgeText({ tabId, text: enabled ? "ON" : "OFF" });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: enabled ? CAPTURE_BADGE_COLOR : DISABLED_BADGE_COLOR,
    });
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[ENABLED_STORAGE_KEY];
  if (areaName !== "local" || !change) return;
  void updateEnabledBadge(isEnabledValue(change.newValue)).catch((err: unknown) => {
    console.warn("[SubJap] Badge update failed:", err);
  });
});

// ---------------------------------------------------------------------------
// AnkiConnect helpers
// ---------------------------------------------------------------------------

const ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = import.meta.env.VITE_SUBJAP_AI_ENDPOINT?.trim() ?? "";
const GEMINI_TIMEOUT_MS = 15_000;

interface AnkiRequest {
  action: string;
  version: number;
  params: Record<string, unknown>;
}

interface AnkiResponse<T = unknown> {
  result: T | null;
  error: string | null;
}

async function ankiInvoke<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const body: AnkiRequest = { action, version: 6, params };
  const response = await fetch(ANKI_CONNECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as AnkiResponse<T>;

  if (data.error) {
    throw new Error(`AnkiConnect error (${action}): ${data.error}`);
  }

  return data.result as T;
}

// ---------------------------------------------------------------------------
// Default SRS state for new cards
// ---------------------------------------------------------------------------

function defaultSrsState(): SrsState {
  return {
    state: "new",
    intervalDays: 0,
    ease: 2.5,
    due: Date.now(),
    reps: 0,
    lapses: 0,
  };
}

// ---------------------------------------------------------------------------
// Initialize the database on service worker startup
// ---------------------------------------------------------------------------

db.open().catch((err) => {
  console.error("[SubJap] Failed to open database:", err);
});

// Frequency data is loaded lazily so existing installations receive the new
// highlighting without needing to reinstall their dictionary manually.
let frequencyLoadPromise: Promise<void> | null = null;
const FREQUENCY_VERSION_SETTING_KEY = "frequencyDataVersion";
const FREQUENCY_BATCH_SIZE = 10_000;

async function replaceFrequencyRanks(entries: FrequencyEntry[]): Promise<void> {
  await db.transaction("rw", db.frequencyEntries, db.settings, async () => {
    await db.frequencyEntries.clear();
    for (let i = 0; i < entries.length; i += FREQUENCY_BATCH_SIZE) {
      await db.frequencyEntries.bulkPut(
        entries.slice(i, i + FREQUENCY_BATCH_SIZE),
      );
    }
    await db.settings.put({
      key: FREQUENCY_VERSION_SETTING_KEY,
      value: FREQUENCY_DATA_VERSION,
    });
  });
}

async function ensureFrequencyRanks(): Promise<void> {
  const [entryCount, versionSetting] = await Promise.all([
    db.frequencyEntries.count(),
    db.settings.get(FREQUENCY_VERSION_SETTING_KEY),
  ]);
  if (
    entryCount > 0 &&
    versionSetting?.value === FREQUENCY_DATA_VERSION
  ) {
    return;
  }
  if (frequencyLoadPromise) return frequencyLoadPromise;

  frequencyLoadPromise = fetchJapaneseFrequencyRanks()
    .then(replaceFrequencyRanks)
    .catch((err: unknown) => {
      console.warn("[SubJap] Japanese frequency list unavailable:", err);
    })
    .finally(() => {
      frequencyLoadPromise = null;
    });

  return frequencyLoadPromise;
}

// ---------------------------------------------------------------------------
// Message handler registration
// ---------------------------------------------------------------------------

onMessage("netflix:timedTextFetch", fetchNetflixTimedText);

// ── dict:lookup ───────────────────────────────────────────────────────────

onMessage("dict:lookup", async ({ lemma, mode }) => {
  const hiragana = toHiragana(lemma.normalize("NFKC"));
  const katakana = Array.from(hiragana, (char) => {
    const point = char.codePointAt(0)!;
    return point >= 0x3041 && point <= 0x3096 ? String.fromCodePoint(point + 0x60) : char;
  }).join("");
  const terms = mode === "reading" ? [...new Set([lemma, hiragana, katakana])] : [lemma];
  const matches = await Promise.all([
    db.dictionaryEntries.where("headword").anyOf(terms).toArray(),
    db.dictionaryEntries.where("aliases").anyOf(terms).toArray(),
    db.dictionaryEntries.where("reading").anyOf(terms).toArray(),
  ]);
  const entries = matches.flat();
  const entry = mode
    ? selectDictionaryEntry(entries, [lemma], mode)
    : selectDictionaryEntry(entries, [lemma], "orthography") ??
      selectDictionaryEntry(entries, [lemma], "reading");
  return { entry, ...(mode ? { entries } : {}) };
});

onMessage("dict:lookupBatch", async ({ terms }) => {
  const uniqueTerms = [...new Set(terms.filter(Boolean))].slice(0, 512);
  if (uniqueTerms.length === 0) return { entriesByTerm: {} };

  const [headwordMatches, aliasMatches] = await Promise.all([
    db.dictionaryEntries.where("headword").anyOf(uniqueTerms).toArray(),
    db.dictionaryEntries.where("aliases").anyOf(uniqueTerms).toArray(),
  ]);
  const candidates = [...new Set([...headwordMatches, ...aliasMatches])];
  const entriesByTerm: Record<string, (typeof candidates)[number][]> = Object.fromEntries(
    uniqueTerms.map((term) => [term, []]),
  );

  for (const entry of candidates) {
    for (const spelling of entrySpellings(entry)) {
      const entries = entriesByTerm[spelling];
      if (entries) entries.push(entry);
    }
  }

  return { entriesByTerm };
});

// ── dict:status ───────────────────────────────────────────────────────────

onMessage("dict:status", async () => {
  const count = await db.dictionaryEntries.count();
  return { count, installed: count > 0 };
});

// ── dict:download ─────────────────────────────────────────────────────────

onMessage("dict:download", async ({ url }) => {
  const [entries, frequencyRanks] = await Promise.all([
    fetchJmdictTgz(url ?? JMDICT_DEFAULT_URL),
    fetchJapaneseFrequencyRanks().catch((err: unknown) => {
      console.warn("[SubJap] Could not refresh frequency list:", err);
      return null;
    }),
  ]);

  // Replace any previous dictionary data, then bulk-insert in batches to
  // avoid oversized IndexedDB transactions.
  await db.dictionaryEntries.clear();
  const BATCH_SIZE = 10000;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    await db.dictionaryEntries.bulkPut(entries.slice(i, i + BATCH_SIZE));
  }

  if (frequencyRanks) {
    await replaceFrequencyRanks(frequencyRanks);
  }

  // Persist the "loaded" flag so popup/options/onboarding can detect it
  // without counting the table every time.
  await markDictionaryLoaded();

  return { count: entries.length };
});

// ── word:get ──────────────────────────────────────────────────────────────
function chooseWordState(states: Array<WordState | undefined>): WordState | null {
  return (
    states
      .filter((state): state is WordState => state !== undefined)
      .sort((left, right) => {
        const leftSource = left.source === "manual" ? 2 : 1;
        const rightSource = right.source === "manual" ? 2 : 1;
        return (
          rightSource - leftSource ||
          WORD_STATUS_PRIORITY[right.status] - WORD_STATUS_PRIORITY[left.status]
        );
      })[0] ?? null
  );
}

onMessage("word:get", async ({ key, aliases = [] }) => {
  const keys = lexicalKeyCandidates(key, ...aliases);
  const [states, ankiWords] = await Promise.all([
    Promise.all(keys.map((candidate) => db.wordStates.get(candidate))),
    Promise.all(keys.map((candidate) => db.ankiWords.get(candidate))),
  ]);
  const state = chooseWordState(states);
  const ankiNoteCount = ankiWords.reduce(
    (total, candidate) => total + (candidate?.noteCount ?? 0),
    0,
  );
  return { state, ankiNoteCount };
});

// Resolve all words needed by one subtitle in a single MV3 round trip. The
// individual lexical aliases are flattened into two IndexedDB bulk reads so a
// new cue never waits on one extension message per token.
onMessage("word:getBatch", async ({ items }) => {
  const requests = items.map(({ key, aliases = [] }) => ({
    key,
    candidates: lexicalKeyCandidates(key, ...aliases),
  }));
  const candidates = [...new Set(requests.flatMap((request) => request.candidates))];
  const [states, ankiWords] = await Promise.all([
    db.wordStates.bulkGet(candidates),
    db.ankiWords.bulkGet(candidates),
  ]);
  const stateByKey = new Map(candidates.map((candidate, index) => [candidate, states[index]]));
  const ankiByKey = new Map(candidates.map((candidate, index) => [candidate, ankiWords[index]]));

  return {
    items: requests.map(({ key, candidates: requestCandidates }) => ({
      key,
      state: chooseWordState(requestCandidates.map((candidate) => stateByKey.get(candidate))),
      ankiNoteCount: requestCandidates.reduce(
        (total, candidate) => total + (ankiByKey.get(candidate)?.noteCount ?? 0),
        0,
      ),
    })),
  };
});

// ── word:set ──────────────────────────────────────────────────────────────

onMessage("word:set", async (payload) => {
  await db.wordStates.put({ ...payload, key: canonicalizeLexicalKey(payload.key) });
});

// ── word:unset ────────────────────────────────────────────────────────────
// A stored manual state outranks Anki forever, so withdrawing Known/Ignore by
// writing a manual "unknown" would freeze the word even after it is learned in
// Anki. Delete the manual decision instead, and keep an explicit "unknown"
// only when Anki or the default would restore the withdrawn status.

onMessage("word:unset", async ({ key, aliases = [], status, defaultStatus }) => {
  const keys = lexicalKeyCandidates(key, ...aliases);
  const states = await db.wordStates.bulkGet(keys);
  await db.wordStates.bulkDelete(keys.filter((_, index) => states[index]?.source === "manual"));

  const fallback = chooseWordState(states.filter((state) => state?.source !== "manual"));
  if ((fallback?.status ?? defaultStatus) !== status) return { state: fallback };

  const override: WordState = {
    key: canonicalizeLexicalKey(key),
    status: "unknown",
    source: "manual",
  };
  await db.wordStates.put(override);
  return { state: override };
});

// ── word:batch ────────────────────────────────────────────────────────────

onMessage("word:batch", async (payload) => {
  await db.wordStates.bulkPut(
    payload.map((state) => ({ ...state, key: canonicalizeLexicalKey(state.key) })),
  );
});

// ── frequency:batch ──────────────────────────────────────────────────────

onMessage("frequency:batch", async ({ terms }) => {
  await ensureFrequencyRanks();
  const uniqueTerms = [...new Set(terms.filter((term) => term.length > 0))];
  const entries = await db.frequencyEntries.bulkGet(uniqueTerms);
  const ranks: Record<string, number> = {};

  uniqueTerms.forEach((term, index) => {
    const rank = entries[index]?.rank;
    if (rank != null) ranks[term] = rank;
  });

  return { ranks };
});

// ── mine:create ───────────────────────────────────────────────────────────

/** Convert a base64 data URL to a Blob (for IndexedDB storage). */
function dataUrlToBlob(dataUrl: string): Blob | undefined {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return undefined;
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return undefined;
  }
}

onMessage("mine:create", async (payload) => {
  const id = crypto.randomUUID();
  const now = Date.now();

  const { screenshotDataUrl, audioDataUrl, ...rest } = payload;
  const card: MineCard = {
    ...rest,
    id,
    createdAt: now,
    srs: rest.srs ?? defaultSrsState(),
    screenshot: screenshotDataUrl ? dataUrlToBlob(screenshotDataUrl) : undefined,
    audio: audioDataUrl ? dataUrlToBlob(audioDataUrl) : undefined,
  };

  await db.mineCards.put(card);

  return { id };
});

onMessage("mine:updateNotes", async ({ id, notes }) => {
  await db.mineCards.update(id, { notes });
});

onMessage("ai:prepareEnrichment", async ({ targetWord }) => ({
  kanji: await prepareAiEnrichmentCandidates(targetWord),
}));

interface GeminiEndpointResponse {
  text?: string;
  model?: string;
  error?: string | { message?: string };
}

onMessage("ai:generateEnrichment", async ({ prompt, responseSchema }) => {
  if (!GEMINI_ENDPOINT) {
    throw new Error(
      "Endpoint Gemini non configuré. Définis VITE_SUBJAP_AI_ENDPOINT puis reconstruis l’extension.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, responseSchema }),
      signal: controller.signal,
    });

    const data = (await response.json()) as GeminiEndpointResponse;
    if (!response.ok) {
      const errorMessage = typeof data.error === "string" ? data.error : data.error?.message;
      throw new Error(errorMessage ?? `Endpoint Gemini HTTP ${response.status}.`);
    }

    if (!data.text) throw new Error("Gemini n’a renvoyé aucun enrichissement.");
    return { text: data.text, model: data.model ?? GEMINI_MODEL };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("La génération Gemini a dépassé 15 secondes.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
});

// ── stats:get ─────────────────────────────────────────────────────────────

onMessage("stats:get", async () => {
  const knownWords = await db.wordStates.where("status").equals("known").count();

  const totalCards = await db.mineCards.count();

  const now = Date.now();
  const cardsDue = await db.mineCards.where("srs.due").belowOrEqual(now).count();

  return { knownWords, totalCards, cardsDue };
});

// ── data:reset ────────────────────────────────────────────────────────────
// Wipe all local learning data (word states, mine cards, dictionary) plus the
// overlay options. Keeps the onboarding state so the user isn't forced back
// through the wizard; the options page exposes a separate "re-run onboarding"
// control for that.

onMessage("data:reset", async () => {
  await db.ankiWords.clear();
  await db.wordStates.clear();
  await db.mineCards.clear();
  await db.dictionaryEntries.clear();
  await db.frequencyEntries.clear();
  await db.settings.clear();
  await chrome.storage.local.remove("subjap_options");
  await chrome.storage.local.remove(AI_SETTINGS_STORAGE_KEY);
  await chrome.storage.local.remove("subjap_dictionary_loaded");
});

// ── tts:speak ─────────────────────────────────────────────────────────────

onMessage("tts:speak", ({ text }) => {
  // speechSynthesis is only available in foreground contexts (content script,
  // popup, options page). The background service worker cannot speak directly.
  // The caller (e.g., a content script) should handle TTS locally after
  // receiving confirmation, or we forward to the active tab's content script.
  //
  // For now we log and return — a content script can listen for this message
  // type and call speechSynthesis.speak() itself.
  console.log("[SubJap] TTS requested for:", text, "(foreground-only; no-op in SW)");
});

onMessage("screenshot:capture", async (_payload, sender) => {
  const windowId = sender.tab?.windowId;
  if (windowId == null) throw new Error("No browser window associated with the tab");

  return {
    dataUrl: await chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
  };
});

async function getTabCaptureStreamId(
  tabId: number,
  consumerTabId?: number,
): Promise<string> {
  const streamId = await new Promise<string>((resolve, reject) => {
    const options: chrome.tabCapture.GetMediaStreamOptions = { targetTabId: tabId };
    if (consumerTabId != null) options.consumerTabId = consumerTabId;
    chrome.tabCapture.getMediaStreamId(
      options,
      (id) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(id);
      },
    );
  });
  return streamId;
}

onMessage("tabCapture:streamId", async (_payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) throw new Error("No tab available for tab capture");
  return { streamId: await getTabCaptureStreamId(tabId, tabId) };
});

// Kept as a typed fallback for extension pages that cannot call tabCapture
// directly. The popup activation normally calls the API in its foreground
// context so Chrome associates it with the explicit activation click.
onMessage("tabCapture:prepare", async ({ tabId }) => {
  const streamId = await getTabCaptureStreamId(tabId, tabId);
  await chrome.tabs.sendMessage(tabId, { type: "tabCapture:stream", streamId });
  return { ready: true };
});

async function ensureAudioOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: "src/offscreen/index.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Route the captured Netflix audio back to the speakers.",
  });
}

onMessage("tabCapture:offscreen", async ({ streamId }) => {
  await ensureAudioOffscreen();
  await chrome.runtime.sendMessage({ type: "tabCapture:offscreenStream", streamId });
  return { ready: true };
});

onMessage("tabCapture:status", async (_payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) throw new Error("No tab available for tab capture");

  const capturedTabs = await new Promise<chrome.tabCapture.CaptureInfo[]>((resolve) => {
    chrome.tabCapture.getCapturedTabs(resolve);
  });
  return {
    active: capturedTabs.some(
      (capture) => capture.tabId === tabId && capture.status === "active",
    ),
  };
});

onMessage("tabCapture:phraseStart", async () => {
  await ensureAudioOffscreen();
  return chrome.runtime.sendMessage({ type: "tabCapture:offscreenPhraseStart" });
});

onMessage("tabCapture:phraseStop", async () => {
  await ensureAudioOffscreen();
  return chrome.runtime.sendMessage({ type: "tabCapture:offscreenPhraseStop" });
});

// ── anki:status ───────────────────────────────────────────────────────────

onMessage("anki:status", async () => {
  try {
    const deckNames = await ankiInvoke<string[]>("deckNames");
    return { connected: true, deckNames };
  } catch (err) {
    console.warn("[SubJap] AnkiConnect not reachable:", err);
    return { connected: false, deckNames: [] };
  }
});

// ── anki:syncKnown ────────────────────────────────────────────────────────

interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  fields: Record<string, { value: string }>;
  tags: string[];
}

/** Combine global status tags with acquired comprehension vocabulary in 日本語. */
onMessage("anki:syncKnown", async () => {
  await maintainProductionCards();
  // Anki's is:review includes relearning after a lapse, plus suspended/buried
  // reviews. Production progress must never qualify its comprehension sibling.
  const [noteIds, learnedNoteIds] = await Promise.all([
    ankiInvoke<number[]>("findNotes", { query: "Mot:*" }),
    ankiInvoke<number[]>("findNotes", {
      query: `Mot:* "deck:日本語" "card:${MIGAKU_COMPREHENSION_TEMPLATE_NAME}" is:review`,
    }),
  ]);
  const notes: AnkiNoteInfo[] = [];
  for (let offset = 0; offset < noteIds.length; offset += 500) {
    notes.push(
      ...(await ankiInvoke<AnkiNoteInfo[]>("notesInfo", {
        notes: noteIds.slice(offset, offset + 500),
      })),
    );
  }
  const desired = extractAnkiWordStates(notes, new Set(learnedNoteIds));
  const desiredPresences = extractAnkiWordPresences(notes);
  const [current, currentPresences] = await Promise.all([
    db.wordStates.toArray(),
    db.ankiWords.toArray(),
  ]);
  const { upserts, removals } = planImportedStateReconciliation(current, desired);
  const presenceChanged = countAnkiWordPresenceChanges(
    currentPresences,
    desiredPresences,
  );
  await db.transaction("rw", db.wordStates, db.ankiWords, async () => {
    if (removals.length > 0) await db.wordStates.bulkDelete(removals);
    if (upserts.length > 0) await db.wordStates.bulkPut(upserts);
    if (presenceChanged > 0) {
      await db.ankiWords.clear();
      if (desiredPresences.length > 0) {
        await db.ankiWords.bulkPut(desiredPresences);
      }
    }
  });
  return {
    imported: desired.length,
    removed: removals.length,
    changed: upserts.length,
    presenceChanged,
  };
});

// ── anki:addNote ──────────────────────────────────────────────────────────

const MIGAKU_MODEL_NAME = "Migaku Memory";
const MIGAKU_IMPORT_MODEL_NAME = "Migaku Memory Import";
const styledMigakuModels = new Set<string>();
const PRODUCTION_FIELD = "Production";
const COMPREHENSION_PRESET_NAME = "SubJap Compréhension";
const PRODUCTION_PRESET_NAME = "SubJap Production";

interface AnkiModelTemplate {
  Front: string;
  Back: string;
}

interface AnkiModelStyling {
  css: string;
}

interface AnkiDeckConfig {
  id: number;
  name: string;
  autoplay?: boolean;
  waitForAudio?: boolean;
  new?: { bury?: boolean; perDay?: number; [key: string]: unknown };
  rev?: { bury?: boolean; [key: string]: unknown };
  lapse?: { leechAction?: number; leechFails?: number; [key: string]: unknown };
  buryInterdayLearning?: boolean;
  [key: string]: unknown;
}

async function ensureMigakuFields(modelName: string): Promise<void> {
  const fields = await ankiInvoke<string[]>("modelFieldNames", { modelName });
  const contentFields = MIGAKU_FIELDS.filter((field) => field !== PRODUCTION_FIELD);
  const missingContent = contentFields.filter((field) => !fields.includes(field));
  if (missingContent.length > 0) {
    throw new Error(
      `Anki model "${modelName}" is missing required fields: ${missingContent.join(", ")}`,
    );
  }
  if (!fields.includes(PRODUCTION_FIELD)) {
    await ankiInvoke("modelFieldAdd", {
      modelName,
      fieldName: PRODUCTION_FIELD,
      index: fields.length,
    });
  }
}

function migrateManagedTemplatePart(
  current: string,
  replacement: string,
  appendActivation = false,
): string {
  const migrated = refreshProductionActivation(
    upgradeLegacyBackLayout(
      migrateManagedTemplateStructure(current, replacement, appendActivation),
    ),
  );
  if (!migrated.includes("back-card")) return migrated;

  // Refresh our script even when a previous migration already advanced the marker.
  // Keep the surrounding template (including custom HyperTTS tags) untouched.
  const audioScript = /<script\b[^>]*\bid=["']subjap-anki-audio-controls["'][^>]*>[\s\S]*?<\/script>/gu;
  if (audioScript.test(migrated)) {
    return migrated.replace(audioScript, () => MIGAKU_AUDIO_CONTROLS_FRAGMENT.trim());
  }
  return `${migrated}\n${MIGAKU_AUDIO_CONTROLS_FRAGMENT}`;
}

/** Replace an earlier activation block (button, script and activated state) with the current one. */
function refreshProductionActivation(template: string): string {
  const activation =
    /\{\{\^Production\}\}\s*<div class="production-activation">[\s\S]*?\{\{\/Production\}\}\s*\{\{#Production\}\}\s*<div class="production-activation">[\s\S]*?\{\{\/Production\}\}/u;
  return template.replace(activation, () => MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT.trim());
}

/** Move an unmodified single-column back body to the two-column layout, keeping everything around it. */
function upgradeLegacyBackLayout(template: string): string {
  const legacyBack =
    /<div class="card-shell back-card" data-subjap-template-version="\d+">([\s\S]*?\{\{\/Notes\}\}\s*)<\/div>/u;
  const match = legacyBack.exec(template);
  if (!match?.[1]) return template;
  // A body customized from inside stays single-column rather than losing its changes.
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  if (normalize(match[1]) !== normalize(MIGAKU_LEGACY_BACK_BODY)) return template;
  return template.replace(match[0], () => MIGAKU_BACK_BODY);
}

function migrateManagedTemplateStructure(
  current: string,
  replacement: string,
  appendActivation = false,
): string {
  // Remove the former cloze requirement from existing managed cards while
  // preserving their surrounding customizations (including audio controls).
  if (current.includes("data-subjap-template-version=")) {
    current = current
      .replace(/<template id="subjap-target-(?:word|reading)">[\s\S]*?<\/template>\s*/gu, "")
      .replace(/<script id="subjap-target-recognition">[\s\S]*?<\/script>\s*/gu, "")
      .replace(/  const target = document\.querySelector\("\.back-sentence \.target"\);\s*if \(!target\) \{[\s\S]*?\n  \}\s*/u, "")
      .replace(/\{\{#Phrase\}\}<div class="production-sentence">\{\{Phrase\}\}<\/div>\{\{\/Phrase\}\}/gu, "")
      .replace("Prononce le mot manquant à voix haute", "Retrouve le mot japonais et prononce-le à voix haute");
  }

  const ensureReviewShortcuts = (template: string): string =>
    !template.includes("back-card") || template.includes("subjap-anki-review-shortcuts")
      ? template
      : `${template}\n${MIGAKU_REVIEW_SHORTCUTS_FRAGMENT}`;

  const ensureAudioControls = (template: string): string =>
    !template.includes("back-card") || template.includes("subjap-anki-audio-controls")
      ? template
      : `${template}\n${MIGAKU_AUDIO_CONTROLS_FRAGMENT}`;

  const restoreAnswerSideAfterActivation = (template: string): string => {
    if (!appendActivation || template.includes('invoke("guiShowAnswer")')) return template;
    return template.replace(
      '      button.textContent = "Production activée";\n      status.textContent = "";',
      '      button.textContent = "Production activée";\n      status.textContent = "";\n      await invoke("guiShowAnswer").catch(() => {});',
    );
  };

  if (current.includes(MIGAKU_TEMPLATE_MARKER)) return current;
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V13)) {
    return ensureAudioControls(current.replace(MIGAKU_TEMPLATE_MARKER_V13, MIGAKU_TEMPLATE_MARKER));
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V11)) {
    return ensureAudioControls(current.replace(MIGAKU_TEMPLATE_MARKER_V11, MIGAKU_TEMPLATE_MARKER));
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V12)) {
    return ensureAudioControls(current.replace(MIGAKU_TEMPLATE_MARKER_V12, MIGAKU_TEMPLATE_MARKER));
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V10)) {
    return ensureAudioControls(current.replace(MIGAKU_TEMPLATE_MARKER_V10, MIGAKU_TEMPLATE_MARKER));
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V9)) {
    return ensureReviewShortcuts(current.replace(MIGAKU_TEMPLATE_MARKER_V9, MIGAKU_TEMPLATE_MARKER));
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V8)) {
    return ensureReviewShortcuts(
      current
        .replace(MIGAKU_TEMPLATE_MARKER_V8, MIGAKU_TEMPLATE_MARKER)
        .replace(
          '<summary><span class="translation-label-show">Voir la traduction</span><span class="translation-label-hide">Masquer la traduction</span></summary>',
          '<summary>Voir la traduction</summary>',
        ),
    );
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V7)) {
    let migrated = current.replace(MIGAKU_TEMPLATE_MARKER_V7, MIGAKU_TEMPLATE_MARKER);
    migrated = migrated.replace(
      /<div class="back-audio-row">\s*\{\{#AudioMot\}\}<div class="audio audio-word">\{\{AudioMot\}\}<\/div>\{\{\/AudioMot\}\}\s*\{\{#AudioPhrase\}\}<div class="audio audio-phrase">\{\{AudioPhrase\}\}<\/div>\{\{\/AudioPhrase\}\}\s*<\/div>/u,
      `<div class="back-audio-row" aria-label="Écoute">
    {{#AudioMot}}<div class="audio-control audio-word"><span class="audio-label">Mot</span><div class="audio">{{AudioMot}}</div></div>{{/AudioMot}}
    {{#AudioPhrase}}<div class="audio-control audio-phrase"><span class="audio-label">Phrase</span><div class="audio">{{AudioPhrase}}</div></div>{{/AudioPhrase}}
  </div>`,
    );
    if (appendActivation) {
      migrated = migrated
        .replace(
          'title="Première révision dans deux jours · à réserver aux mots utiles à l’oral">\n    ＋ Production orale',
          'aria-describedby="subjap-production-hint" title="Première révision dans deux jours · à réserver aux mots utiles à l’oral">\n    Activer la production orale',
        )
        .replace(
          '  <div class="production-activation-status" id="subjap-production-status"></div>',
          '  <div class="production-activation-hint" id="subjap-production-hint">Crée une carte sœur disponible dans deux jours.</div>\n  <div class="production-activation-status" id="subjap-production-status" role="status" aria-live="polite"></div>',
        );
    }
    return ensureReviewShortcuts(migrated);
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V6)) {
    let migrated = current.replace(MIGAKU_TEMPLATE_MARKER_V6, MIGAKU_TEMPLATE_MARKER);
    if (migrated.includes('class="production-card back-card"')) {
      migrated = migrated
        .replace('class="production-card back-card"', 'class="card-shell back-card"')
        .replace(
          /\s*\{\{#Lecture\}\}<div class="reading"[^>]*>\{\{Lecture\}\}<\/div>\{\{\/Lecture\}\}/u,
          "",
        )
        .replace(/\s*<div class="production-repeat">[^<]*<\/div>/u, "")
        .replace(
          /\{\{#Traduction\}\}\s*<div class="translation-content">\s*<div class="section-label">Traduction<\/div>\s*\{\{Traduction\}\}\s*<\/div>\s*\{\{\/Traduction\}\}/u,
          `{{#Traduction}}
  <details class="translation-reveal">
    <summary>Voir la traduction</summary>
    <div class="translation-content">
      <div class="section-label">Traduction</div>
      {{Traduction}}
    </div>
  </details>
  {{/Traduction}}`,
        )
        .replace(/\s*<div class="production-grading">[\s\S]*?<\/div>/u, "");
    }
    return ensureReviewShortcuts(migrated);
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V5)) {
    return migrateManagedTemplatePart(
      current
        .replace(MIGAKU_TEMPLATE_MARKER_V5, MIGAKU_TEMPLATE_MARKER_V6)
        .replace(
          /\{\{#Traduction\}\}\s*<details class="production-hint">[\s\S]*?<\/details>\s*\{\{\/Traduction\}\}/u,
          '{{#Définitions}}<div class="production-definitions">{{Définitions}}</div>{{/Définitions}}',
        ),
      replacement,
      appendActivation,
    );
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V4)) {
    return migrateManagedTemplatePart(
      restoreAnswerSideAfterActivation(
        current.replace(MIGAKU_TEMPLATE_MARKER_V4, MIGAKU_TEMPLATE_MARKER_V5),
      ),
      replacement,
      appendActivation,
    );
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V3)) {
    let migrated = current.replace(MIGAKU_TEMPLATE_MARKER_V3, MIGAKU_TEMPLATE_MARKER_V5);
    if (appendActivation) {
      migrated = migrated
        .replace(
          '<button class="production-activation-button" id="subjap-activate-production" type="button">\n    Activer la production orale\n  </button>',
          '<button class="production-activation-button" id="subjap-activate-production" type="button"\n    title="Première révision dans deux jours · à réserver aux mots utiles à l’oral">\n    ＋ Production orale\n  </button>',
        )
        .replace(
          '<div class="production-activation-status" id="subjap-production-status">\n    Première révision dans deux jours · à réserver aux mots utiles à l’oral\n  </div>',
          '<div class="production-activation-status" id="subjap-production-status"></div>',
        )
        .replace(
          'status.textContent = "La première révision sera libérée dans deux jours.";',
          'status.textContent = "";',
        );
    }
    return migrateManagedTemplatePart(
      restoreAnswerSideAfterActivation(migrated),
      replacement,
      appendActivation,
    );
  }
  if (current.includes(MIGAKU_TEMPLATE_MARKER_V2)) {
    let migrated = current.replace(MIGAKU_TEMPLATE_MARKER_V2, MIGAKU_TEMPLATE_MARKER_V5);
    if (appendActivation && !migrated.includes("subjap-activate-production")) {
      migrated += MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT;
    }
    return migrateManagedTemplatePart(migrated, replacement, appendActivation);
  }
  return replacement;
}

/** Apply the shared presentation while preserving additions around managed v2 templates. */
async function updateMigakuModelPresentation(modelName: string): Promise<void> {
  if (styledMigakuModels.has(modelName)) return;

  await ensureMigakuFields(modelName);
  let templates = await ankiInvoke<Record<string, AnkiModelTemplate>>("modelTemplates", {
    modelName,
  });
  const previousComprehensionName = Object.keys(templates).find(
    (name) => name !== MIGAKU_PRODUCTION_TEMPLATE_NAME,
  );
  if (!previousComprehensionName) {
    console.warn(`[SubJap] Anki model has no card template: ${modelName}`);
    return;
  }
  if (previousComprehensionName !== MIGAKU_COMPREHENSION_TEMPLATE_NAME) {
    await ankiInvoke("modelTemplateRename", {
      modelName,
      oldTemplateName: previousComprehensionName,
      newTemplateName: MIGAKU_COMPREHENSION_TEMPLATE_NAME,
    });
    templates = await ankiInvoke<Record<string, AnkiModelTemplate>>("modelTemplates", {
      modelName,
    });
  }

  const comprehension = templates[MIGAKU_COMPREHENSION_TEMPLATE_NAME];
  if (!comprehension) {
    throw new Error(`Anki model "${modelName}" has no comprehension template`);
  }
  const nextComprehension = {
    Front: migrateManagedTemplatePart(comprehension.Front, MIGAKU_FRONT_TEMPLATE),
    Back: migrateManagedTemplatePart(comprehension.Back, MIGAKU_BACK_TEMPLATE, true),
  };

  const production = templates[MIGAKU_PRODUCTION_TEMPLATE_NAME];
  if (!production) {
    await ankiInvoke("modelTemplateAdd", {
      modelName,
      template: {
        Name: MIGAKU_PRODUCTION_TEMPLATE_NAME,
        Front: MIGAKU_PRODUCTION_FRONT_TEMPLATE,
        Back: MIGAKU_PRODUCTION_BACK_TEMPLATE,
      },
    });
  }

  const nextProduction = production
    ? {
        Front: migrateManagedTemplatePart(production.Front, MIGAKU_PRODUCTION_FRONT_TEMPLATE),
        Back: migrateManagedTemplatePart(production.Back, MIGAKU_PRODUCTION_BACK_TEMPLATE),
      }
    : undefined;

  const currentStyling = await ankiInvoke<AnkiModelStyling>("modelStyling", { modelName });
  const hasCurrentStyling = currentStyling.css === MIGAKU_CSS;

  if (!hasCurrentStyling) {
    await ankiInvoke("updateModelStyling", {
      model: { name: modelName, css: MIGAKU_CSS },
    });
  }
  const updatedTemplates: Record<string, AnkiModelTemplate> = {};
  if (
    nextComprehension.Front !== comprehension.Front ||
    nextComprehension.Back !== comprehension.Back
  ) {
    updatedTemplates[MIGAKU_COMPREHENSION_TEMPLATE_NAME] = nextComprehension;
  }
  if (
    production &&
    nextProduction &&
    (nextProduction.Front !== production.Front || nextProduction.Back !== production.Back)
  ) {
    updatedTemplates[MIGAKU_PRODUCTION_TEMPLATE_NAME] = nextProduction;
  }
  if (Object.keys(updatedTemplates).length > 0) {
    await ankiInvoke("updateModelTemplates", {
      model: {
        name: modelName,
        templates: updatedTemplates,
      },
    });
  }
  styledMigakuModels.add(modelName);
  console.log(`[SubJap] Anki model presentation updated: ${modelName}`);
}

/** Ensure SubJap's mining note type implements the shared Migaku field contract. */
async function ensureMigakuModel(): Promise<void> {
  const names = await ankiInvoke<string[]>("modelNames");
  if (names.includes(MIGAKU_MODEL_NAME)) {
    try {
      await updateMigakuModelPresentation(MIGAKU_MODEL_NAME);
    } catch (err) {
      console.warn("[SubJap] Could not update Migaku model presentation; continuing:", err);
    }
    return;
  }

  try {
    await ankiInvoke("createModel", {
      modelName: MIGAKU_MODEL_NAME,
      inOrderFields: [...MIGAKU_FIELDS],
      css: MIGAKU_CSS,
      cardTemplates: [
        {
          Name: MIGAKU_COMPREHENSION_TEMPLATE_NAME,
          Front: MIGAKU_FRONT_TEMPLATE,
          Back: MIGAKU_BACK_TEMPLATE,
        },
        {
          Name: MIGAKU_PRODUCTION_TEMPLATE_NAME,
          Front: MIGAKU_PRODUCTION_FRONT_TEMPLATE,
          Back: MIGAKU_PRODUCTION_BACK_TEMPLATE,
        },
      ],
    });
    styledMigakuModels.add(MIGAKU_MODEL_NAME);
  } catch (err) {
    // Already exists (e.g. from a previous attempt)? Use it; otherwise report.
    const after = await ankiInvoke<string[]>("modelNames");
    if (!after.includes(MIGAKU_MODEL_NAME)) throw err;
    try {
      await updateMigakuModelPresentation(MIGAKU_MODEL_NAME);
    } catch (err) {
      console.warn("[SubJap] Could not update Migaku model presentation; continuing:", err);
    }
  }
}

/** Style the model generated by the separate Migaku export when it is present. */
async function updateMigakuImportModelIfPresent(): Promise<void> {
  const names = await ankiInvoke<string[]>("modelNames");
  if (!names.includes(MIGAKU_IMPORT_MODEL_NAME)) return;
  try {
    await updateMigakuModelPresentation(MIGAKU_IMPORT_MODEL_NAME);
  } catch (err) {
    console.warn("[SubJap] Could not update Migaku import presentation; continuing:", err);
  }
}

async function ensureAnkiDeck(deckName: string): Promise<void> {
  const names = await ankiInvoke<string[]>("deckNames");
  if (!names.includes(deckName)) await ankiInvoke("createDeck", { deck: deckName });
}

async function ensureDeckPreset(
  deckName: string,
  presetName: string,
  configure: (config: AnkiDeckConfig) => void,
): Promise<void> {
  let config = await ankiInvoke<AnkiDeckConfig>("getDeckConfig", { deck: deckName });
  if (config.name !== presetName) {
    const configId = await ankiInvoke<number | false>("cloneDeckConfigId", {
      name: presetName,
      cloneFrom: String(config.id),
    });
    if (configId === false) throw new Error(`Could not create Anki preset "${presetName}"`);
    await ankiInvoke("setDeckConfigId", { decks: [deckName], configId });
    config = await ankiInvoke<AnkiDeckConfig>("getDeckConfig", { deck: deckName });
  }
  configure(config);
  await ankiInvoke("saveDeckConfig", { config });
}

async function ensureStudyDecks(): Promise<void> {
  await ensureAnkiDeck(ANKI_VOCABULARY_PARENT_DECK);
  await ensureAnkiDeck(ANKI_COMPREHENSION_DECK);
  await ensureAnkiDeck(ANKI_PRODUCTION_DECK);

  await ensureDeckPreset(
    ANKI_COMPREHENSION_DECK,
    COMPREHENSION_PRESET_NAME,
    (config) => {
      config.new = { ...config.new, bury: true };
      config.rev = { ...config.rev, bury: true };
      config.buryInterdayLearning = true;
      config.autoplay = true;
      config.waitForAudio = true;
    },
  );
  await ensureDeckPreset(ANKI_PRODUCTION_DECK, PRODUCTION_PRESET_NAME, (config) => {
    config.new = { ...config.new, bury: true, perDay: 5 };
    config.rev = { ...config.rev, bury: true };
    config.lapse = {
      ...config.lapse,
      leechAction: 0,
      leechFails: Math.max(12, config.lapse?.leechFails ?? 0),
    };
    config.buryInterdayLearning = true;
    config.autoplay = true;
    config.waitForAudio = true;
  });
}

async function moveModelCardsIntoStudyDecks(modelName: string): Promise<void> {
  const comprehensionCards = await ankiInvoke<number[]>("findCards", {
    query: `note:"${modelName}" card:${MIGAKU_COMPREHENSION_TEMPLATE_NAME}`,
  });
  if (comprehensionCards.length > 0) {
    await ankiInvoke("changeDeck", {
      cards: comprehensionCards,
      deck: ANKI_COMPREHENSION_DECK,
    });
  }
  const productionCards = await ankiInvoke<number[]>("findCards", {
    query: `note:"${modelName}" card:${MIGAKU_PRODUCTION_TEMPLATE_NAME}`,
  });
  if (productionCards.length > 0) {
    await ankiInvoke("changeDeck", {
      cards: productionCards,
      deck: ANKI_PRODUCTION_DECK,
    });
  }
}

interface AnkiProductionCardInfo {
  cardId: number;
  note: number;
  deckName: string;
  queue: number;
  fields: Record<string, { value: string }>;
}

const PRODUCTION_RELEASE_ALARM_NAME = "subjap-production-release";

async function scheduleProductionReleaseAlarm(): Promise<void> {
  await chrome.alarms.create(PRODUCTION_RELEASE_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 60,
  });
}

async function findProductionCardInfos(): Promise<AnkiProductionCardInfo[]> {
  const cardIds: number[] = [];
  for (const modelName of [MIGAKU_MODEL_NAME, MIGAKU_IMPORT_MODEL_NAME]) {
    cardIds.push(
      ...(await ankiInvoke<number[]>("findCards", {
        query: `note:"${modelName}" card:${MIGAKU_PRODUCTION_TEMPLATE_NAME}`,
      })),
    );
  }
  if (cardIds.length === 0) return [];
  return ankiInvoke<AnkiProductionCardInfo[]>("cardsInfo", { cards: cardIds });
}

/** Whether Anki is showing a card: any card change now could replace it with another one. */
async function isAnkiReviewing(): Promise<boolean> {
  try {
    return await ankiInvoke<boolean>("guiReviewActive");
  } catch {
    // AnkiConnect reports a missing reviewer as an error; an unreachable Anki fails the next call.
    return false;
  }
}

/** Generate the production cards requested from Anki, suspended for two full days. */
async function createRequestedProductionCards(): Promise<void> {
  const noteIds = await ankiInvoke<number[]>("findNotes", {
    query: `tag:${ANKI_PRODUCTION_REQUEST_TAG}`,
  });
  if (noteIds.length === 0) return;
  const notes = await ankiInvoke<AnkiNoteInfo[]>("notesInfo", { notes: noteIds });
  const releaseAt = String(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const toActivate = notes.filter(
    (note) => PRODUCTION_FIELD in note.fields && !note.fields[PRODUCTION_FIELD]?.value.trim(),
  );
  if (toActivate.length > 0) {
    // Filling the field generates the card; the release pass then moves and suspends it.
    await ankiInvoke("multi", {
      actions: toActivate.map((note) => ({
        action: "updateNoteFields",
        version: 6,
        params: { note: { id: note.noteId, fields: { [PRODUCTION_FIELD]: releaseAt } } },
      })),
    });
  }
  await ankiInvoke("removeTags", { notes: noteIds, tags: ANKI_PRODUCTION_REQUEST_TAG });
}

/**
 * Create requested production cards, then release those due as new cards after
 * two full days. Skipped while Anki shows a card, retried by the hourly alarm.
 */
async function maintainProductionCards(): Promise<void> {
  if (await isAnkiReviewing()) return;
  await createRequestedProductionCards();
  await releaseDueProductionCards();
}

async function releaseDueProductionCards(): Promise<number> {
  const infos = await findProductionCardInfos();
  const now = Date.now();
  const due: AnkiProductionCardInfo[] = [];
  const futureToSuspend: number[] = [];
  const wrongDeck: number[] = [];

  for (const info of infos) {
    if (info.deckName !== ANKI_PRODUCTION_DECK) wrongDeck.push(info.cardId);
    const raw = info.fields[PRODUCTION_FIELD]?.value.trim() ?? "";
    const releaseAt = Number(raw);
    if (!raw || raw === "active" || !Number.isFinite(releaseAt)) continue;
    if (releaseAt <= now) {
      due.push(info);
    } else if (info.queue !== -1) {
      futureToSuspend.push(info.cardId);
    }
  }

  if (wrongDeck.length > 0) {
    await ankiInvoke("changeDeck", { cards: wrongDeck, deck: ANKI_PRODUCTION_DECK });
  }
  if (futureToSuspend.length > 0) {
    await ankiInvoke("suspend", { cards: futureToSuspend });
  }
  if (due.length > 0) {
    const suspendedDue = due.filter((info) => info.queue === -1).map((info) => info.cardId);
    if (suspendedDue.length > 0) {
      await ankiInvoke("unsuspend", { cards: suspendedDue });
    }
    await ankiInvoke("multi", {
      actions: due.map((info) => ({
        action: "updateNoteFields",
        version: 6,
        params: {
          note: { id: info.note, fields: { [PRODUCTION_FIELD]: "active" } },
        },
      })),
    });
  }
  return due.length;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== PRODUCTION_RELEASE_ALARM_NAME) return;
  void maintainProductionCards().catch((err) => {
    console.info("[SubJap] Pending production release unavailable:", err);
  });
});

void scheduleProductionReleaseAlarm();

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid media data URL");
  return dataUrl.slice(comma + 1);
}

async function storeAnkiMedia(dataUrl: string, prefix: string, extension: string): Promise<string> {
  const filename = `${prefix}_${Date.now()}_${crypto.randomUUID()}.${extension}`;
  await ankiInvoke("storeMediaFile", {
    filename,
    data: dataUrlToBase64(dataUrl),
  });
  return filename;
}

onMessage(
  "anki:addNote",
  async ({ fields, audioPhraseDataUrl, imageDataUrl, tags }) => {
    const deckName = ANKI_COMPREHENSION_DECK;
    await ensureAnkiDeck(deckName);
    await ensureMigakuModel();
    const noteFields: Record<string, string> = { ...fields, [PRODUCTION_FIELD]: "" };

    if (audioPhraseDataUrl) {
      const filename = await storeAnkiMedia(audioPhraseDataUrl, "subjap_phrase", "wav");
      noteFields.AudioPhrase = `[sound:${filename}]`;
    }
    if (imageDataUrl) {
      const filename = await storeAnkiMedia(imageDataUrl, "subjap_image", "png");
      noteFields.Image = `<div><img src="${filename}"></div>`;
    }

    const note: Record<string, unknown> = {
      deckName,
      modelName: MIGAKU_MODEL_NAME,
      fields: noteFields,
      tags: tags ?? ["subjap"],
      options: {
        // Phrase mining intentionally allows multiple contexts for one lemma.
        allowDuplicate: true,
        duplicateScope: "deck",
      },
    };

    const noteId = await ankiInvoke<number>("addNote", { note });
    console.log("[SubJap] Anki note added:", {
      noteId,
      deckName,
      modelName: MIGAKU_MODEL_NAME,
    });
    return { noteId, modelName: MIGAKU_MODEL_NAME, deckName };
  },
);

// ── anki:setup ────────────────────────────────────────────────────────────

/**
 * Ensure the vocabulary subdecks, presets and two-card note models exist.
 * Existing comprehension cards are migrated without changing their schedule.
 */
onMessage("anki:setup", async () => {
  const deckName = ANKI_COMPREHENSION_DECK;
  const modelName = MIGAKU_MODEL_NAME;

  await ensureStudyDecks();
  await ensureMigakuModel();
  await updateMigakuImportModelIfPresent();
  await moveModelCardsIntoStudyDecks(MIGAKU_MODEL_NAME);

  const modelNames = await ankiInvoke<string[]>("modelNames");
  if (modelNames.includes(MIGAKU_IMPORT_MODEL_NAME)) {
    await moveModelCardsIntoStudyDecks(MIGAKU_IMPORT_MODEL_NAME);
  }
  await maintainProductionCards();

  console.log("[SubJap] Anki setup ensured:", { deckName, modelName });
  return { deckName, modelName };
});

// ── anki:dueCount ─────────────────────────────────────────────────────────

onMessage("anki:dueCount", async () => {
  try {
    const dueCards = await ankiInvoke<number[]>("findCards", {
      query: "is:due",
    });
    return { count: dueCards.length };
  } catch (err) {
    console.warn("[SubJap] Failed to fetch Anki due count:", err);
    return { count: 0 };
  }
});

// ---------------------------------------------------------------------------
// Log that the service worker is ready
// ---------------------------------------------------------------------------

console.log("[SubJap] Background service worker initialized.");
