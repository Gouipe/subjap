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

// One line per spelling and reading, and a kanji spelling keeps its readings
// apart: 未だ is 90th read まだ, while いまだ ranks 2419th. When a word is
// mostly written in kana, JPDB also gives the kana form's rank (居る read いる:
// 3021st, いる: 18th). UniDic files いる under 居る, so that reading keeps the
// better of the two and shares the kana form's rank. Only the most common
// kanji spelling of that kana form does, and only when it is common on its
// own: archaic, ateji or homophone spellings (一寸 for ちょっと, 此れ for これ,
// 挙げる for あげる) would rank among the first words.
const HAS_KANJI = /\p{Script=Han}/u;
const rows = new Map();
for (const line of (await response.text()).split(/\r?\n/).slice(1)) {
  const [rawTerm, rawReading, rawRank, rawKanaRank] = line.split("\t");
  const term = (rawTerm ?? "").trim().normalize("NFKC");
  const reading = HAS_KANJI.test(term) ? (rawReading ?? "").trim().normalize("NFKC") : "";
  const rank = Number.parseInt(rawRank ?? "", 10);
  if (!term || !Number.isInteger(rank) || rank < 1) continue;
  const kanaRank = Number.parseInt(rawKanaRank ?? "", 10);
  const key = `${term}\t${reading}`;
  const current = rows.get(key);
  if (!current || rank < current.rank) {
    rows.set(key, { term, reading, rank, kanaRank: Number.isInteger(kanaRank) ? kanaRank : 0 });
  }
}

// Kana rank → its most common kanji spelling, when common on its own. A
// spelling already ranked better (行く: 44th, いく: 65th) still claims it, so
// a rarer homophone (逝く, « to die ») does not inherit いく's rank.
const kanaHeirs = new Map();
for (const [key, { rank, kanaRank }] of rows) {
  if (rank > MAX_RANK || kanaRank < 1) continue;
  const heir = kanaHeirs.get(kanaRank);
  if (!heir || rank < rows.get(heir).rank) kanaHeirs.set(kanaRank, key);
}

const ranked = [...rows]
  .map(([key, { term, reading, rank, kanaRank }]) => ({
    term,
    reading,
    rank: kanaHeirs.get(kanaRank) === key ? Math.min(rank, kanaRank) : rank,
  }))
  .filter(({ rank }) => rank <= MAX_RANK);

// `word<TAB>rank`, plus `<TAB>reading` for a kanji spelling. Kana first within
// a shared rank (いる before 居る): the triage shows it.
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lines = ranked
  .sort((a, b) => a.rank - b.rank || compare(a.term, b.term) || compare(a.reading, b.reading))
  .map(({ term, reading, rank }) => (reading ? `${term}\t${rank}\t${reading}` : `${term}\t${rank}`));

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} frequency ranks to ${OUTPUT_PATH}`);
