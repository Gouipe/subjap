import type { AnkiWordPresence, WordState, WordStatus } from "@/core/types";
import { canonicalizeLexicalKey } from "@/core/lexical-key";

export interface AnkiNoteInfoForWordStates {
  noteId?: number;
  modelName?: string;
  fields: Record<string, { value: string }>;
  tags?: string[];
}

/** Suspended technical notes that only carry imported Migaku word statuses. */
const MIGAKU_STATUS_MODEL_NAME = "Migaku Vocabulary Status";

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

// IGNORED is an explicit opt-out and must win when notes/tags conflict across
// decks; otherwise the presence of the same word in Anki can turn it purple.
// Acquired vocabulary wins over stale UNKNOWN/LEARNING tags in other notes.
export const WORD_STATUS_PRIORITY: Record<WordStatus, number> = {
  unknown: 1,
  learning: 2,
  known: 3,
  ignored: 4,
};

/** Normalize Migaku bracket syntax and SubJap/Anki ruby HTML to a lemma key. */
export function normalizeAnkiWord(value: string): string {
  const normalized = value
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
  return canonicalizeLexicalKey(normalized);
}

export function extractAnkiWordStates(
  notes: AnkiNoteInfoForWordStates[],
  learnedNoteIds: ReadonlySet<number> = new Set(),
): ImportedAnkiWordState[] {
  const byWord = new Map<string, WordStatus>();
  for (const note of notes) {
    const key = normalizeAnkiWord(note.fields.Mot?.value ?? "");
    if (!key) continue;
    const statuses = (note.tags ?? [])
      .map((tag) => TAG_STATUS[tag.toUpperCase()])
      .filter((status): status is WordStatus => status !== undefined);
    if (note.noteId !== undefined && learnedNoteIds.has(note.noteId)) {
      statuses.push("known");
    }
    for (const status of statuses) {
      const current = byWord.get(key);
      if (!current || WORD_STATUS_PRIORITY[status] > WORD_STATUS_PRIORITY[current]) {
        byWord.set(key, status);
      }
    }
  }
  return [...byWord].map(([key, status]) => ({ key, status }));
}

/** Count every Anki study note (status notes excluded) by its normalized `Mot` field. */
export function extractAnkiWordPresences(
  notes: AnkiNoteInfoForWordStates[],
): AnkiWordPresence[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    // Status notes feed word states through their tags, but they are not
    // cards the user studies: counting them would mark UNKNOWN words as
    // already mined.
    if (note.modelName === MIGAKU_STATUS_MODEL_NAME) continue;
    const key = normalizeAnkiWord(note.fields.Mot?.value ?? "");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, noteCount]) => ({ key, noteCount }));
}

export function countAnkiWordPresenceChanges(
  current: AnkiWordPresence[],
  desired: AnkiWordPresence[],
): number {
  const currentByKey = new Map(current.map((entry) => [entry.key, entry.noteCount]));
  const desiredByKey = new Map(desired.map((entry) => [entry.key, entry.noteCount]));
  const keys = new Set([...currentByKey.keys(), ...desiredByKey.keys()]);
  let changed = 0;
  for (const key of keys) {
    if (currentByKey.get(key) !== desiredByKey.get(key)) changed += 1;
  }
  return changed;
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
