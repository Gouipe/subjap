// ---------------------------------------------------------------------------
// SubJap — AnkiConnect HTTP client
// ---------------------------------------------------------------------------

const ANKI_URL = "http://127.0.0.1:8765";

interface AnkiRequest {
  action: string;
  version: 6;
  params: unknown;
}

interface AnkiResponse<T = unknown> {
  result: T | null;
  error: string | null;
}

async function invoke<T = unknown>(
  action: string,
  params: unknown = {},
): Promise<T> {
  const body: AnkiRequest = { action, version: 6, params };

  const res = await fetch(ANKI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`AnkiConnect HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as AnkiResponse<T>;

  if (json.error) {
    throw new Error(`AnkiConnect error: ${json.error}`);
  }

  return json.result as T;
}

// ── Public API ────────────────────────────────────────────────────────────

export interface AnkiStatus {
  connected: boolean;
  deckNames: string[];
}

/**
 * Check whether AnkiConnect is reachable and return the list of deck names.
 */
export async function checkAnkiConnect(): Promise<AnkiStatus> {
  try {
    const deckNames = await invoke<string[]>("deckNames");
    return { connected: true, deckNames };
  } catch {
    return { connected: false, deckNames: [] };
  }
}

/**
 * Create a new note in Anki via AnkiConnect.
 * Returns the generated note id.
 */
export async function createAnkiNote(
  deckName: string,
  modelName: string,
  fields: Record<string, string>,
  _audio?: Blob,
  _screenshot?: Blob,
): Promise<number> {
  // AnkiConnect does not natively accept blobs inline; audio/screenshot
  // must be stored as files and referenced.  For MVP we send the text fields
  // only — the caller can upload media separately via storeMediaFile.
  const note = {
    deckName,
    modelName,
    fields,
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
    },
  };

  const noteId = await invoke<number>("addNote", { note });
  return noteId;
}

/**
 * Return the number of cards due today.
 */
export async function getDueCount(): Promise<number> {
  try {
    // cardsDue returns an array of card IDs; return its length.
    const due = await invoke<number[]>("cardsDue", { deck: "" });
    // The response is an array of card IDs; return its length.
    return Array.isArray(due) ? due.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Store a base64-encoded media file in Anki's collection.media folder.
 * Returns the filename that can be referenced in note fields.
 */
export async function storeMediaFile(
  filename: string,
  dataBase64: string,
): Promise<string> {
  await invoke("storeMediaFile", { filename, data: dataBase64 });
  return filename;
}
