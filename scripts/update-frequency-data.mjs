// Rebuild public/frequency/ from the JPDB v2.2 lemma frequency list.
//
// JPDB ranks dictionary forms (起こす, not 起こして) over a large corpus of
// Japanese anime, dramas, novels and visual novels. Its own ranks are kept;
// particles and auxiliaries stay in the list and are set aside by SubJap
// where their part of speech is known (subtitle tokens, JMdict entries).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const JPDB_CSV_URL =
  "https://github.com/Kuuuube/yomitan-dictionaries/raw/main/data/jpdb_v2.2_freq_list_2024-10-13.csv";
const MAX_RANK = 10_000;
const OUTPUT_PATH = resolve(`public/frequency/jpdb-v2.2-top${MAX_RANK}.tsv`);

const response = await fetch(JPDB_CSV_URL);
if (!response.ok) {
  throw new Error(`JPDB frequency source HTTP ${response.status}: ${response.statusText}`);
}

// One line per spelling and reading: a spelling keeps its best rank.
const bestRanks = new Map();
for (const line of (await response.text()).split(/\r?\n/).slice(1)) {
  const [rawTerm, , rawRank] = line.split("\t");
  const term = (rawTerm ?? "").trim().normalize("NFKC");
  const rank = Number.parseInt(rawRank ?? "", 10);
  if (!term || !Number.isInteger(rank) || rank < 1 || rank > MAX_RANK) continue;
  bestRanks.set(term, Math.min(bestRanks.get(term) ?? Infinity, rank));
}

const lines = [...bestRanks]
  .sort(([, a], [, b]) => a - b)
  .map(([term, rank]) => `${term}\t${rank}`);

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} frequency ranks to ${OUTPUT_PATH}`);
