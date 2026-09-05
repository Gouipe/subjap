// ---------------------------------------------------------------------------
// Dictionary lookup — JMdict-simplified in-memory index.
// ---------------------------------------------------------------------------

import type { DictionaryEntry } from "@/core/types";
import { toHiragana } from "@/core/kana";
import {
  entrySpellings,
  entryReadings,
  selectDictionaryEntry,
  type DictionaryLookupOptions,
} from "./match";

// ── Indexes ───────────────────────────────────────────────────────────────

let headwordCount = 0;
let spellingCandidates = new Map<string, DictionaryEntry[]>();
let readingCandidates = new Map<string, DictionaryEntry[]>();

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
  headwordCount = new Set(entries.map((entry) => entry.headword)).size;
  spellingCandidates = new Map();
  readingCandidates = new Map();
  const add = (
    index: Map<string, DictionaryEntry[]>,
    term: string,
    entry: DictionaryEntry,
  ): void => {
    const matches = index.get(term) ?? [];
    if (!matches.includes(entry)) matches.push(entry);
    index.set(term, matches);
  };

  for (const e of entries) {
    for (const spelling of entrySpellings(e)) add(spellingCandidates, spelling, e);
    for (const reading of entryReadings(e))
      add(readingCandidates, toHiragana(reading.normalize("NFKC")), e);
  }
}

/**
 * Look up a lemma (dictionary form) and return the best-matching entry.
 *
 * Search order:
 * 1. Exact spelling match (headword or written variant).
 * 2. Exact reading match.
 *
 * Returns `null` when no match is found.
 */
export function lookup(lemma: string): DictionaryEntry | null {
  const exact = lookupCandidates(lemma, { mode: "orthography" });
  return (
    selectDictionaryEntry(exact, [lemma], "orthography") ??
    selectDictionaryEntry(lookupCandidates(lemma, { mode: "reading" }), [lemma], "reading")
  );
}

/** All entries must remain available until token context has selected one. */
export function lookupCandidates(
  lemma: string,
  options?: DictionaryLookupOptions,
): DictionaryEntry[] {
  return options?.mode === "reading"
    ? (readingCandidates.get(toHiragana(lemma.normalize("NFKC"))) ?? [])
    : (spellingCandidates.get(lemma) ?? []);
}

/**
 * Return the current number of indexed entries (for diagnostics).
 * Returns 0 when the dictionary has not been loaded yet.
 */
export function entryCount(): number {
  return headwordCount;
}
