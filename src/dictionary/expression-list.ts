// ---------------------------------------------------------------------------
// Bundled JMdict expressions (noun + particle + verb: 空気を読む, 気にする).
// ---------------------------------------------------------------------------
//
// The default « Courant » pack holds only a few dozen of them, so SubJap ships
// the full dictionary's list (scripts/update-expression-data.mjs) and loads it
// in the service worker on first use, whatever pack is installed. The list
// also holds the adverbs ending in は (先ずは) that split-words.ts merges.

import type { DictionaryEntry } from "@/core/types";
import { toHiragana } from "@/core/kana";
import { entryReadings, entrySpellings } from "./match";

export const EXPRESSION_LIST_PATH = "expressions/jmdict-expressions.json";

export interface ExpressionIndex {
  bySpelling: Map<string, DictionaryEntry[]>;
  byReading: Map<string, DictionaryEntry[]>;
}

let indexPromise: Promise<ExpressionIndex> | null = null;

function extensionUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
  return `/${path}`;
}

const normalizeReading = (text: string): string => toHiragana(text.normalize("NFKC"));

/** Index the bundled entries by spelling and by reading. */
export function buildExpressionIndex(entries: DictionaryEntry[]): ExpressionIndex {
  const bySpelling = new Map<string, DictionaryEntry[]>();
  const byReading = new Map<string, DictionaryEntry[]>();
  const add = (
    index: Map<string, DictionaryEntry[]>,
    key: string,
    entry: DictionaryEntry,
  ): void => {
    const matches = index.get(key) ?? [];
    if (!matches.includes(entry)) matches.push(entry);
    index.set(key, matches);
  };
  for (const entry of entries) {
    for (const spelling of entrySpellings(entry)) add(bySpelling, spelling, entry);
    for (const reading of entryReadings(entry)) add(byReading, normalizeReading(reading), entry);
  }
  return { bySpelling, byReading };
}

function loadExpressionIndex(): Promise<ExpressionIndex> {
  indexPromise ??= fetch(extensionUrl(EXPRESSION_LIST_PATH))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Expression list HTTP ${response.status}: ${response.statusText}`);
      }
      const data = (await response.json()) as { entries: DictionaryEntry[] };
      return buildExpressionIndex(data.entries);
    })
    .catch((err: unknown) => {
      // Retry on the next lookup rather than keep a failed load forever.
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

/** Expressions written exactly as `term`, or read as `term` when it is kana. */
export function findExpressions(
  index: ExpressionIndex,
  terms: string[],
): Record<string, DictionaryEntry[]> {
  return Object.fromEntries(
    terms.map((term) => [
      term,
      [
        ...new Set([
          ...(index.bySpelling.get(term) ?? []),
          ...(index.byReading.get(normalizeReading(term)) ?? []),
        ]),
      ],
    ]),
  );
}

export async function lookupExpressions(
  terms: string[],
): Promise<Record<string, DictionaryEntry[]>> {
  return findExpressions(await loadExpressionIndex(), terms);
}

/** Spelling matches only, merged into ordinary dictionary lookups. */
export async function lookupExpressionSpellings(terms: string[]): Promise<DictionaryEntry[]> {
  const index = await loadExpressionIndex();
  return [...new Set(terms.flatMap((term) => index.bySpelling.get(term) ?? []))];
}
