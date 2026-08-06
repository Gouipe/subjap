// ---------------------------------------------------------------------------
// Dictionary lookup — JMdict-simplified in-memory index.
// ---------------------------------------------------------------------------
//
// ## Data flow (for future reference)
//
// 1. On first launch / onboarding the extension fetches a jmdict-simplified
//    JSON file (typically ~30–45 MB uncompressed) from a CDN or bundled URL.
// 2. The JSON array of `DictionaryEntry` objects is stored in IndexedDB
//    (via Dexie, already a dependency) so subsequent starts avoid re-fetch.
// 3. On startup the stored array is read from IndexedDB and passed to
//    `loadDictionary()`, which rebuilds the in-memory Map indexes.
// 4. Runtime lookups are synchronous O(1) Map lookups — fast enough for
//    every token in every subtitle cue.
//
// The in-memory footprint of a Map with ~200k entries is well under the
// 100 MB budget (typically 40–60 MB for the Map + the entry objects).

import type { DictionaryEntry } from "@/core/types";

// ── Indexes ───────────────────────────────────────────────────────────────

/** Primary index: headword → best-matching entry. */
let headwordIndex: Map<string, DictionaryEntry> | null = null;

/** Secondary index: reading → entry (useful for words looked up via kana). */
let readingIndex: Map<string, DictionaryEntry> | null = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Bulk-load dictionary entries and rebuild the in-memory indexes.
 *
 * Call this after retrieving the jmdict-simplified JSON from IndexedDB (or
 * optionally from a fresh download at onboarding time).
 *
 * Each call replaces the previous indexes entirely (idempotent).
 */
export function loadDictionary(entries: DictionaryEntry[]): void {
  const hi = new Map<string, DictionaryEntry>();
  const ri = new Map<string, DictionaryEntry>();

  for (const e of entries) {
    // Headword index: first-write-wins (common entries come first in jmdict).
    if (!hi.has(e.headword)) {
      hi.set(e.headword, e);
    }

    // Reading index: same strategy; skip if reading equals headword
    // (already covered by the primary index).
    if (e.reading && e.reading !== e.headword && !ri.has(e.reading)) {
      ri.set(e.reading, e);
    }
  }

  headwordIndex = hi;
  readingIndex = ri;
}

/**
 * Look up a lemma (dictionary form) and return the best-matching entry.
 *
 * Search order:
 * 1. Exact headword match.
 * 2. Exact reading match.
 *
 * Returns `null` when no match is found.
 */
export function lookup(lemma: string): DictionaryEntry | null {
  if (!headwordIndex) return null;

  const byHeadword = headwordIndex.get(lemma);
  if (byHeadword) return byHeadword;

  if (readingIndex) {
    return readingIndex.get(lemma) ?? null;
  }

  return null;
}

/**
 * Return the current number of indexed entries (for diagnostics).
 * Returns 0 when the dictionary has not been loaded yet.
 */
export function entryCount(): number {
  return headwordIndex?.size ?? 0;
}
