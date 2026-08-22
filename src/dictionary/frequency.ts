/**
 * Japanese subtitle frequency data.
 *
 * The source is the OpenSubtitles 2018 Japanese list from FrequencyWords.
 * It is sorted by descending occurrence count, and therefore gives us a
 * practical spoken/subtitle rank for learning hints.
 */
export const JAPANESE_FREQUENCY_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ja/ja_full.txt";

export interface FrequencyEntry {
  key: string;
  rank: number;
}

/** Parse `word count` lines into stable 1-based frequency ranks. */
export function parseFrequencyList(text: string): FrequencyEntry[] {
  const counts = new Map<string, number>();

  for (const line of text.split(/\r?\n/)) {
    const separator = line.lastIndexOf(" ");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    const count = Number.parseInt(line.slice(separator + 1).trim(), 10);
    if (!key || !Number.isFinite(count) || count < 1) continue;

    const previous = counts.get(key) ?? 0;
    counts.set(key, Math.max(previous, count));
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key], index) => ({ key, rank: index + 1 }));
}

export async function fetchJapaneseFrequencyRanks(): Promise<FrequencyEntry[]> {
  const response = await fetch(JAPANESE_FREQUENCY_URL);
  if (!response.ok) {
    throw new Error(
      `Japanese frequency list HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return parseFrequencyList(await response.text());
}
