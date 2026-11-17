/**
 * Practical Japanese frequency data for subtitle-based learning.
 *
 * The shipped list is JPDB v2.2: dictionary forms (起こす, not 起こして)
 * ranked over Japanese anime, dramas, novels and visual novels. Particles and
 * auxiliaries keep their rank here; callers set them aside where their part
 * of speech is known.
 */
export const FREQUENCY_DATA_VERSION = "jpdb-v2.2-20241013-v6";

export const SUBTITLE_FREQUENCY_PATH = "frequency/jpdb-v2.2-top10000.tsv";

export interface FrequencyEntry {
  key: string;
  /** Best rank of the spelling, whatever its reading. */
  rank: number;
  /** A kanji spelling's rank per reading (未だ: まだ 90th; いまだ unranked). */
  readings?: Record<string, number>;
}

import { FREQUENCY_READING_SEPARATOR } from "@/core/frequency";

export { FREQUENCY_READING_SEPARATOR };

function normalizeKey(value: string): string {
  return value.trim().normalize("NFKC");
}

function isLearningEntry(key: string): boolean {
  return key.length > 0 && key !== "[TOTAL]" && !/[<>[\]]/.test(key);
}

function entriesFromBestRanks(bestRanks: Map<string, number>): FrequencyEntry[] {
  return [...bestRanks.entries()]
    .map(([key, rank]) => ({ key, rank }))
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

/**
 * Parse the compact subtitle asset bundled with SubJap: `word<TAB>rank`, plus
 * `<TAB>reading` on each reading of a kanji spelling.
 */
export function parseFrequencyList(text: string): FrequencyEntry[] {
  const bestRanks = new Map<string, number>();
  const readingRanks = new Map<string, Record<string, number>>();

  for (const line of text.split(/\r?\n/)) {
    const [rawKey, rawRank, rawReading] = line.split("\t");
    const key = normalizeKey(rawKey ?? "");
    const rank = Number.parseInt(rawRank ?? "", 10);
    if (!isLearningEntry(key) || !Number.isFinite(rank) || rank < 1) continue;

    bestRanks.set(key, Math.min(bestRanks.get(key) ?? Infinity, rank));
    const reading = normalizeKey(rawReading ?? "");
    if (reading) {
      const readings = readingRanks.get(key) ?? {};
      readings[reading] = Math.min(readings[reading] ?? Infinity, rank);
      readingRanks.set(key, readings);
    }
  }

  return entriesFromBestRanks(bestRanks).map((entry) => {
    const readings = readingRanks.get(entry.key);
    return readings ? { ...entry, readings } : entry;
  });
}

/**
 * A spelling's rank under the reading it is read with (中 read ちゅう: 303rd,
 * read なか: 75th). A reading the list does not rank under that spelling
 * (未だ read いまだ, ranked under まだ) takes the rank of its kana form
 * (いまだ). A kana form shorter than three kana is too ambiguous (明日 read
 * あす, 家 read か, a suffix, not the particle): the spelling's best rank then
 * stands, as when the reading is unknown.
 */
export function rankForReading(
  entry: FrequencyEntry | undefined,
  reading: string,
  kanaEntry: FrequencyEntry | undefined,
): number | undefined {
  if (!entry) return undefined;
  if (!entry.readings || !reading) return entry.rank;
  const ranked = entry.readings[reading];
  if (ranked !== undefined) return ranked;
  return [...reading].length >= 3 && kanaEntry && !kanaEntry.readings
    ? kanaEntry.rank
    : entry.rank;
}

/** A `frequency:batch` term's rank: a spelling, or a spelling and its reading. */
export function rankFrequencyTerm(
  term: string,
  entryOf: (key: string) => FrequencyEntry | undefined,
): number | undefined {
  const [spelling = "", reading = ""] = term.split(FREQUENCY_READING_SEPARATOR);
  return rankForReading(entryOf(spelling), reading, reading ? entryOf(reading) : undefined);
}

/** Keep the best rank observed in any supplied practical-language corpus. */
export function mergeFrequencyRanks(
  ...sources: readonly FrequencyEntry[][]
): FrequencyEntry[] {
  const bestRanks = new Map<string, number>();

  for (const source of sources) {
    for (const { key: rawKey, rank } of source) {
      const key = normalizeKey(rawKey);
      if (!isLearningEntry(key) || !Number.isFinite(rank) || rank < 1) continue;
      bestRanks.set(key, Math.min(bestRanks.get(key) ?? Infinity, rank));
    }
  }

  return entriesFromBestRanks(bestRanks);
}

function extensionUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return `/${path}`;
}

async function fetchSubtitleFrequencyRanks(): Promise<FrequencyEntry[]> {
  const response = await fetch(extensionUrl(SUBTITLE_FREQUENCY_PATH));
  if (!response.ok) {
    throw new Error(
      `Subtitle frequency list HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return parseFrequencyList(await response.text());
}

export async function fetchJapaneseFrequencyRanks(): Promise<FrequencyEntry[]> {
  return fetchSubtitleFrequencyRanks();
}
