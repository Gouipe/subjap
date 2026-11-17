// Rebuild public/frequency/ from the JPDB v2.2 lemma frequency list.
//
// JPDB ranks dictionary forms (起こす, not 起こして) over a large corpus of
// Japanese anime, dramas, novels and visual novels. Its own ranks are kept;
// a common kanji spelling also takes its kana form's rank (see below).
// Particles and auxiliaries stay in the list and are set aside by SubJap
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

// One line per spelling and reading. A spelling takes the rank of its most
// frequent reading. When that word is mostly written in kana, JPDB also gives
// the kana form's rank (居る: 3021st, いる: 18th). UniDic files いる under 居る,
// so the spelling keeps the better of the two and shares the kana form's rank.
// Only the most common kanji spelling of that kana form does, and only when it
// is common on its own: archaic, ateji or homophone spellings (一寸 for
// ちょっと, 此れ for これ, 挙げる for あげる) would rank among the first words.
const mainReadings = new Map();
for (const line of (await response.text()).split(/\r?\n/).slice(1)) {
  const [rawTerm, , rawRank, rawKanaRank] = line.split("\t");
  const term = (rawTerm ?? "").trim().normalize("NFKC");
  const rank = Number.parseInt(rawRank ?? "", 10);
  if (!term || !Number.isInteger(rank) || rank < 1) continue;
  const kanaRank = Number.parseInt(rawKanaRank ?? "", 10);
  const current = mainReadings.get(term);
  if (!current || rank < current.rank) {
    mainReadings.set(term, { rank, kanaRank: Number.isInteger(kanaRank) ? kanaRank : 0 });
  }
}

// Kana rank → its most common kanji spelling, when common on its own. A
// spelling already ranked better (行く: 44th, いく: 65th) still claims it, so
// a rarer homophone (逝く, « to die ») does not inherit いく's rank.
const kanaHeirs = new Map();
for (const [term, { rank, kanaRank }] of mainReadings) {
  if (rank > MAX_RANK || kanaRank < 1) continue;
  const heir = kanaHeirs.get(kanaRank);
  if (!heir || rank < mainReadings.get(heir).rank) kanaHeirs.set(kanaRank, term);
}

const bestRanks = [...mainReadings]
  .map(([term, { rank, kanaRank }]) => [
    term,
    kanaHeirs.get(kanaRank) === term ? Math.min(rank, kanaRank) : rank,
  ])
  .filter(([, rank]) => rank <= MAX_RANK);

// Kana first within a shared rank (いる before 居る): the triage shows it.
const lines = bestRanks
  .sort(([termA, a], [termB, b]) => a - b || (termA < termB ? -1 : termA > termB ? 1 : 0))
  .map(([term, rank]) => `${term}\t${rank}`);

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} frequency ranks to ${OUTPUT_PATH}`);
