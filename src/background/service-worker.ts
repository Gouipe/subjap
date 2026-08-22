// ---------------------------------------------------------------------------
// SubJap — Background service worker
// ---------------------------------------------------------------------------

import { db } from "@/core/db";
import { onMessage } from "@/core/messaging";
import { fetchJmdictTgz, JMDICT_DEFAULT_URL } from "@/dictionary/jmdict";
import { fetchJapaneseFrequencyRanks } from "@/dictionary/frequency";
import { markDictionaryLoaded } from "@/onboarding";
import { fetchNetflixTimedText } from "./netflix-timed-text";
import { synthesizeVoicevox, warmupVoicevox } from "@/mining/voicevox";
import {
  countAnkiWordPresenceChanges,
  extractAnkiWordPresences,
  extractAnkiWordStates,
  planImportedStateReconciliation,
} from "./anki-known";
import type { MineCard, SrsState } from "@/core/types";

// ---------------------------------------------------------------------------
// First-install: open the options page so the onboarding wizard can run.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if ((details.reason as string) === "install") {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void warmupVoicevox().catch((err) => {
    console.info("[SubJap] VOICEVOX warm-up unavailable:", err);
  });
});

// ---------------------------------------------------------------------------
// AnkiConnect helpers
// ---------------------------------------------------------------------------

const ANKI_CONNECT_URL = "http://127.0.0.1:8765";

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

async function ensureFrequencyRanks(): Promise<void> {
  if ((await db.frequencyEntries.count()) > 0) return;
  if (frequencyLoadPromise) return frequencyLoadPromise;

  frequencyLoadPromise = fetchJapaneseFrequencyRanks()
    .then(async (entries) => {
      await db.frequencyEntries.clear();
      await db.frequencyEntries.bulkPut(entries);
    })
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

onMessage("dict:lookup", async ({ lemma }) => {
  const entry = await db.dictionaryEntries.where("headword").equals(lemma).first();

  // If not found by headword, try reading index
  if (!entry) {
    const byReading = await db.dictionaryEntries.where("reading").equals(lemma).first();
    return { entry: byReading ?? null };
  }

  return { entry };
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
    await db.frequencyEntries.clear();
    await db.frequencyEntries.bulkPut(frequencyRanks);
  }

  // Persist the "loaded" flag so popup/options/onboarding can detect it
  // without counting the table every time.
  await markDictionaryLoaded();

  return { count: entries.length };
});

// ── word:get ──────────────────────────────────────────────────────────────
onMessage("word:get", async ({ key }) => {
  const [state, ankiWord] = await Promise.all([
    db.wordStates.get(key),
    db.ankiWords.get(key),
  ]);
  return { state: state ?? null, ankiNoteCount: ankiWord?.noteCount ?? 0 };
});

// ── word:set ──────────────────────────────────────────────────────────────

onMessage("word:set", async (payload) => {
  await db.wordStates.put(payload);
});

// ── word:batch ────────────────────────────────────────────────────────────

onMessage("word:batch", async (payload) => {
  await db.wordStates.bulkPut(payload);
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

onMessage("tts:generate", async ({ text }) => ({
  dataUrl: await synthesizeVoicevox(text),
}));

onMessage("screenshot:capture", async (_payload, sender) => {
  const windowId = sender.tab?.windowId;
  if (windowId == null) throw new Error("No browser window associated with the tab");

  return {
    dataUrl: await chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
  };
});

async function getTabCaptureStreamId(tabId: number): Promise<string> {
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabId, consumerTabId: tabId },
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
  return { streamId: await getTabCaptureStreamId(tabId) };
});

// Kept as a typed fallback for extension pages that cannot call tabCapture
// directly. The popup activation normally calls the API in its foreground
// context so Chrome associates it with the explicit activation click.
onMessage("tabCapture:prepare", async ({ tabId }) => {
  const streamId = await getTabCaptureStreamId(tabId);
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
  fields: Record<string, { value: string }>;
  tags: string[];
}

/** Reconcile vocabulary presence and status tags across every Anki deck. */
onMessage("anki:syncKnown", async () => {
  const noteIds = await ankiInvoke<number[]>("findNotes", { query: "Mot:*" });
  const notes: AnkiNoteInfo[] = [];
  for (let offset = 0; offset < noteIds.length; offset += 500) {
    notes.push(
      ...(await ankiInvoke<AnkiNoteInfo[]>("notesInfo", {
        notes: noteIds.slice(offset, offset + 500),
      })),
    );
  }
  const desired = extractAnkiWordStates(notes);
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
const MIGAKU_FIELDS = [
  "Mot",
  "Lecture",
  "Phrase",
  "Traduction",
  "Définitions",
  "Notes",
  "Image",
  "AudioMot",
  "AudioPhrase",
] as const;

const MIGAKU_CSS =
  '.card { font-family: "Hiragino Kaku Gothic ProN", "Meiryo", Arial, sans-serif; text-align: center; font-size: 20px; }\n' +
  ".word { font-size: 40px; font-weight: bold; }\n" +
  ".reading { color: #666; font-size: 20px; margin-bottom: 8px; }\n" +
  ".sentence { font-size: 22px; line-height: 1.8; margin: 12px 0; }\n" +
  ".translation { margin-top: 12px; color: #333; }\n" +
  ".definitions { text-align: left; margin: 12px auto; max-width: 600px; }\n" +
  ".notes { text-align: left; margin: 12px auto; max-width: 600px; color: #555; font-size: 14px; }\n" +
  ".target { font-weight: bold; }\n" +
  "ruby rt { font-size: 0.5em; color: #888; }";

/** Ensure SubJap's mining note type implements the shared Migaku field contract. */
async function ensureMigakuModel(): Promise<void> {
  const names = await ankiInvoke<string[]>("modelNames");
  if (names.includes(MIGAKU_MODEL_NAME)) {
    const fields = await ankiInvoke<string[]>("modelFieldNames", {
      modelName: MIGAKU_MODEL_NAME,
    });
    const exact =
      fields.length === MIGAKU_FIELDS.length &&
      MIGAKU_FIELDS.every((field, index) => fields[index] === field);
    if (!exact) {
      throw new Error(
        `Anki model "${MIGAKU_MODEL_NAME}" has incompatible fields; expected ${MIGAKU_FIELDS.join(", ")}`,
      );
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
          Name: MIGAKU_MODEL_NAME,
          Front:
            '<div class="word">{{Mot}}</div>\n' +
            '<div class="reading">{{Lecture}}</div>\n' +
            '<div class="audio">{{AudioMot}}</div>',
          Back:
            '{{FrontSide}}\n\n<hr id="answer">\n\n' +
            '<div class="sentence">{{Phrase}}</div>\n' +
            '<div class="audio">{{AudioPhrase}}</div>\n' +
            "{{Image}}\n" +
            '<div class="translation">{{Traduction}}</div>\n' +
            '<div class="definitions">{{Définitions}}</div>\n' +
            '<div class="notes">{{Notes}}</div>',
        },
      ],
    });
  } catch (err) {
    // Already exists (e.g. from a previous attempt)? Use it; otherwise report.
    const after = await ankiInvoke<string[]>("modelNames");
    if (!after.includes(MIGAKU_MODEL_NAME)) throw err;
  }
}

async function ensureAnkiDeck(deckName: string): Promise<void> {
  const names = await ankiInvoke<string[]>("deckNames");
  if (!names.includes(deckName)) await ankiInvoke("createDeck", { deck: deckName });
}

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
  async ({ deckName, fields, audioMotDataUrl, audioPhraseDataUrl, imageDataUrl, tags }) => {
    await ensureAnkiDeck(deckName);
    await ensureMigakuModel();
    const noteFields = { ...fields };

    if (audioMotDataUrl) {
      const filename = await storeAnkiMedia(audioMotDataUrl, "subjap_mot", "wav");
      noteFields.AudioMot = `[sound:${filename}]`;
    }
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
 * Ensure the dedicated "SubJap" deck and note model exist in Anki, so mined
 * cards land in a predictable place with a predictable note type. Idempotent.
 */
onMessage("anki:setup", async () => {
  const deckName = "SubJap";
  const modelName = MIGAKU_MODEL_NAME;

  await ensureAnkiDeck(deckName);
  await ensureMigakuModel();

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
