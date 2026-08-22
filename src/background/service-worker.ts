// ---------------------------------------------------------------------------
// SubJap — Background service worker
// ---------------------------------------------------------------------------

import { db } from "@/core/db";
import { onMessage } from "@/core/messaging";
import { fetchJmdictTgz, JMDICT_DEFAULT_URL } from "@/dictionary/jmdict";
import { fetchJapaneseFrequencyRanks } from "@/dictionary/frequency";
import { markDictionaryLoaded } from "@/onboarding";
import type { MineCard, SrsState } from "@/core/types";

// ---------------------------------------------------------------------------
// First-install: open the options page so the onboarding wizard can run.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if ((details.reason as string) === "install") {
    void chrome.runtime.openOptionsPage();
  }
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

// ── dict:lookup ───────────────────────────────────────────────────────────

onMessage("dict:lookup", async ({ lemma }) => {
  const entry = await db.dictionaryEntries
    .where("headword")
    .equals(lemma)
    .first();

  // If not found by headword, try reading index
  if (!entry) {
    const byReading = await db.dictionaryEntries
      .where("reading")
      .equals(lemma)
      .first();
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
  const state = await db.wordStates.get(key);
  return { state: state ?? null };
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
  const knownWords = await db.wordStates
    .where("status")
    .equals("known")
    .count();

  const totalCards = await db.mineCards.count();

  const now = Date.now();
  const cardsDue = await db.mineCards
    .where("srs.due")
    .belowOrEqual(now)
    .count();

  return { knownWords, totalCards, cardsDue };
});

// ── data:reset ────────────────────────────────────────────────────────────
// Wipe all local learning data (word states, mine cards, dictionary) plus the
// overlay options. Keeps the onboarding state so the user isn't forced back
// through the wizard; the options page exposes a separate "re-run onboarding"
// control for that.

onMessage("data:reset", async () => {
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

// ── anki:addNote ──────────────────────────────────────────────────────────

/**
 * Ensure a note model with the given name exists in Anki. Creates it
 * (idempotent) with Front/Back (+ Audio/Picture reserved for later media
 * attachment) when missing.
 */
async function ensureAnkiModel(modelName: string): Promise<void> {
  const names = await ankiInvoke<string[]>("modelNames");
  if (names.includes(modelName)) return;
  try {
    await ankiInvoke("createModel", {
      modelName,
      inOrderFields: ["Front", "Back", "Audio", "Picture"],
      css: "",
      cardTemplates: [
        {
          Name: "Card 1",
          Front: "{{Front}}",
          Back: "{{Front}}<br>{{Back}}",
        },
      ],
    });
  } catch (err) {
    // Already exists (e.g. from a previous attempt)? Use it; otherwise report.
    const after = await ankiInvoke<string[]>("modelNames");
    if (!after.includes(modelName)) throw err;
  }
}

/**
 * Resolve a note model name that actually exists in Anki.
 *
 * Anki profiles are not always English: the built-in "Basic" type is renamed
 * in localized profiles (e.g. "Basique" in French) and its fields may be
 * localized too. Resolution order:
 *   1. the requested name (usually "Basic") if it exists;
 *   2. the first model exposing English "Front"/"Back" fields;
 *   3. a dedicated "SubJap Basic" model created on demand (idempotent).
 */
async function resolveAnkiModel(preferred: string): Promise<string> {
  const names = await ankiInvoke<string[]>("modelNames");
  if (names.includes(preferred)) return preferred;

  for (const name of names) {
    try {
      const fields = await ankiInvoke<string[]>("modelFieldNames", {
        modelName: name,
      });
      if (fields.includes("Front") && fields.includes("Back")) return name;
    } catch {
      // Unusable model — keep scanning.
    }
  }

  await ensureAnkiModel("SubJap Basic");
  return "SubJap Basic";
}

onMessage("anki:addNote", async ({ deckName, modelName, fields, audioUrl, screenshotUrl }) => {
  const resolvedModel = await resolveAnkiModel(modelName ?? "Basic");
  const note: Record<string, unknown> = {
    deckName,
    modelName: resolvedModel,
    fields,
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
    },
  };

  if (audioUrl) {
    note.audio = {
      url: audioUrl,
      filename: `subjap_audio_${Date.now()}.mp3`,
      fields: ["Audio"],
    };
  }

  if (screenshotUrl) {
    note.picture = {
      url: screenshotUrl,
      filename: `subjap_screenshot_${Date.now()}.png`,
      fields: ["Picture"],
    };
  }

  const noteId = await ankiInvoke<number>("addNote", { note });
  console.log("[SubJap] Anki note added:", {
    noteId,
    deckName,
    modelName: resolvedModel,
  });
  return { noteId, modelName: resolvedModel };
});

// ── anki:setup ────────────────────────────────────────────────────────────

/**
 * Ensure the dedicated "SubJap" deck and note model exist in Anki, so mined
 * cards land in a predictable place with a predictable note type. Idempotent.
 */
onMessage("anki:setup", async () => {
  const deckName = "SubJap";
  const modelName = "SubJap Basic";

  const deckNames = await ankiInvoke<string[]>("deckNames");
  if (!deckNames.includes(deckName)) {
    await ankiInvoke("createDeck", { deck: deckName });
  }
  await ensureAnkiModel(modelName);

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
