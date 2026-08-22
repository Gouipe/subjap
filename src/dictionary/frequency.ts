/**
 * Practical Japanese frequency data for subtitle-based learning.
 *
 * The shipped list is derived from OpenSubtitles 2018 and matched against
 * JMdict vocabulary before it reaches SubJap. This keeps the spoken/media
 * register while avoiding raw morphological fragments and subtitle noise.
 */
export const FREQUENCY_DATA_VERSION = "opensubtitles-jmdict-202604-v1";

export const SUBTITLE_FREQUENCY_PATH =
  "frequency/opensubtitles-ja-jmdict-top8598.tsv";

export interface FrequencyEntry {
  key: string;
  rank: number;
}

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

/** Parse the compact `word<TAB>rank` subtitle asset bundled with SubJap. */
export function parseFrequencyList(text: string): FrequencyEntry[] {
  const bestRanks = new Map<string, number>();

  for (const line of text.split(/\r?\n/)) {
    const [rawKey, rawRank] = line.split("\t");
    const key = normalizeKey(rawKey ?? "");
    const rank = Number.parseInt(rawRank ?? "", 10);
    if (!isLearningEntry(key) || !Number.isFinite(rank) || rank < 1) continue;

    bestRanks.set(key, Math.min(bestRanks.get(key) ?? Infinity, rank));
  }

  return entriesFromBestRanks(bestRanks);
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
