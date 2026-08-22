import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import xzDecompress from "xz-decompress";

const TUBELEX_URL =
  "https://raw.githubusercontent.com/naist-nlp/tubelex/main/frequencies/tubelex-ja-lemma-pos.tsv.xz";
const OUTPUT_PATH = resolve("public/frequency/tubelex-ja-lemma-top50k.tsv");
const MAX_ENTRIES = 50_000;

function isLearningEntry(word, partOfSpeech) {
  return (
    word.length > 0 &&
    word !== "[TOTAL]" &&
    !partOfSpeech.includes("補助記号") &&
    !partOfSpeech.includes("記号") &&
    !partOfSpeech.includes("固有名詞")
  );
}

const response = await fetch(TUBELEX_URL);
if (!response.ok || !response.body) {
  throw new Error(`TUBELEX HTTP ${response.status}: ${response.statusText}`);
}

const { XzReadableStream } = xzDecompress;
const text = await new Response(new XzReadableStream(response.body)).text();
const rows = text.split(/\r?\n/);
const header = rows.shift()?.split("\t") ?? [];
const wordIndex = header.indexOf("word");
const posIndex = header.indexOf("pos");

if (wordIndex < 0 || posIndex < 0) {
  throw new Error("Unexpected TUBELEX header");
}

const entries = [];
const seen = new Set();
let sourceRank = 0;

for (const row of rows) {
  if (!row) continue;
  const columns = row.split("\t");
  const word = (columns[wordIndex] ?? "").trim().normalize("NFKC");
  const partOfSpeech = columns[posIndex] ?? "";
  if (word === "[TOTAL]") continue;

  sourceRank += 1;
  if (!isLearningEntry(word, partOfSpeech) || seen.has(word)) continue;

  seen.add(word);
  entries.push(`${word}\t${sourceRank}`);
  if (entries.length === MAX_ENTRIES) break;
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${entries.join("\n")}\n`, "utf8");
console.log(`Wrote ${entries.length} TUBELEX ranks to ${OUTPUT_PATH}`);
