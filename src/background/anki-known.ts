import type { WordState, WordStatus } from "@/core/types";

export interface AnkiNoteInfoForWordStates {
  fields: Record<string, { value: string }>;
  tags?: string[];
}

export interface ImportedAnkiWordState {
  key: string;
  status: WordStatus;
}

const TAG_STATUS: Record<string, WordStatus> = {
  KNOWN: "known",
  IGNORED: "ignored",
  UNKNOWN: "unknown",
  LEARNING: "learning",
};

// When conflicting notes exist across decks, the state requiring attention wins.
const STATUS_PRIORITY: Record<WordStatus, number> = {
  ignored: 0,
  known: 1,
  unknown: 2,
  learning: 3,
};

/** Normalize Migaku bracket syntax and SubJap/Anki ruby HTML to a lemma key. */
export function normalizeAnkiWord(value: string): string {
  return value
    .normalize("NFC")
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\{([^}]*)\}/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, "")
    .replace(/^["'“”‘’「」『』（）()【】、。！？!?.,，．…]+/, "")
    .replace(/["'“”‘’「」『』（）()【】、。！？!?.,，．…]+$/, "")
    .trim();
}

export function extractAnkiWordStates(
  notes: AnkiNoteInfoForWordStates[],
): ImportedAnkiWordState[] {
  const byWord = new Map<string, WordStatus>();
  for (const note of notes) {
    const key = normalizeAnkiWord(note.fields.Mot?.value ?? "");
    if (!key) continue;
    const statuses = (note.tags ?? [])
      .map((tag) => TAG_STATUS[tag.toUpperCase()])
      .filter((status): status is WordStatus => status !== undefined);
    for (const status of statuses) {
      const current = byWord.get(key);
      if (!current || STATUS_PRIORITY[status] > STATUS_PRIORITY[current]) {
        byWord.set(key, status);
      }
    }
  }
  return [...byWord].map(([key, status]) => ({ key, status }));
}

export function planImportedStateReconciliation(
  current: WordState[],
  desired: ImportedAnkiWordState[],
  now = Date.now(),
): { upserts: WordState[]; removals: string[] } {
  const currentByKey = new Map(current.map((state) => [state.key, state]));
  const desiredByKey = new Map(desired.map((state) => [state.key, state]));
  const removals = current
    .filter((state) => state.source === "import" && !desiredByKey.has(state.key))
    .map((state) => state.key);
  const upserts: WordState[] = [];
  for (const desiredState of desired) {
    const existing = currentByKey.get(desiredState.key);
    if (existing?.source === "manual") continue;
    if (existing?.source === "import" && existing.status === desiredState.status) continue;
    upserts.push({
      key: desiredState.key,
      status: desiredState.status,
      knownAt:
        desiredState.status === "known"
          ? existing?.knownAt ?? now
          : undefined,
      source: "import",
    });
  }
  return { upserts, removals };
}
