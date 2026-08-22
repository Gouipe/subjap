import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SUBTITLE_FREQUENCY_URL =
  "https://raw.githubusercontent.com/jkindrix/japanese-language-data/main/data/enrichment/frequency-subtitles.json";
const OUTPUT_PATH = resolve("public/frequency/opensubtitles-ja-jmdict-top8598.tsv");

const response = await fetch(SUBTITLE_FREQUENCY_URL);
if (!response.ok) {
  throw new Error(
    `Subtitle frequency source HTTP ${response.status}: ${response.statusText}`,
  );
}

const payload = await response.json();
if (!Array.isArray(payload?.entries)) {
  throw new Error("Unexpected subtitle frequency source shape");
}

const entries = payload.entries
  .filter(
    (entry) =>
      typeof entry?.text === "string" &&
      entry.text.trim().length > 0 &&
      Number.isInteger(entry.rank) &&
      entry.rank > 0,
  )
  .map((entry) => `${entry.text.trim().normalize("NFKC")}\t${entry.rank}`);

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${entries.join("\n")}\n`, "utf8");
console.log(`Wrote ${entries.length} subtitle frequency ranks to ${OUTPUT_PATH}`);
