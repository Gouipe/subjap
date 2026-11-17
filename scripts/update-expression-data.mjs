// Rebuild public/expressions/ from the full JMdict (jmdict-simplified).
//
// The default « Courant » pack holds only a few dozen idioms such as
// 空気を読む: SubJap ships the full dictionary's noun + particle + verb
// expressions so that every installation recognizes them in subtitles,
// plus the adverbs and conjunctions ending in は (先ずは, 何時かは).
// Entries keep the DictionaryEntry shape built by convertJmdictWord().

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const JMDICT_VERSION = "3.6.2+20260817122448";
const version = encodeURIComponent(JMDICT_VERSION);
const JMDICT_URL = `https://github.com/scriptin/jmdict-simplified/releases/download/${version}/jmdict-eng-${version}.json.tgz`;
const OUTPUT_PATH = resolve("public/expressions/jmdict-expressions.json");

// Noun + を/が/に/で/と/へ + verb in its dictionary form (u-row ending).
const EXPRESSION_SPELLING =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+[をがにでとへ][\p{Script=Han}\p{Script=Hiragana}々]*[うくぐすつぬぶむる]$/u;
const OUTDATED = new Set(["arch", "obs", "obsc"]);

function parseTar(buffer) {
  const files = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const name = buffer.toString("utf8", offset, offset + 100).replace(/\0.*$/su, "").trim();
    if (!name) break;
    const size = Number.parseInt(buffer.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/su, "").trim(), 8);
    const type = String.fromCharCode(buffer[offset + 156]);
    const start = offset + 512;
    if (type === "0" || type === "\0") files.set(name, buffer.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

const response = await fetch(JMDICT_URL);
if (!response.ok) throw new Error(`JMdict HTTP ${response.status}: ${response.statusText}`);
const files = parseTar(gunzipSync(Buffer.from(await response.arrayBuffer())));
const json = [...files].find(([name]) => name.endsWith(".json"))?.[1];
if (!json) throw new Error("No JSON file in the JMdict archive");
const { words } = JSON.parse(json.toString("utf8"));

const entries = [];
for (const word of words) {
  const partOfSpeech = [...new Set(word.sense.flatMap((sense) => sense.partOfSpeech ?? []))];
  const kanjiForms = (word.kanji ?? []).map((form) => form.text);
  const verbalExpression =
    partOfSpeech.includes("exp") &&
    partOfSpeech.some((pos) => /^v[15krsz]/u.test(pos)) &&
    kanjiForms.some((text) => EXPRESSION_SPELLING.test(text));
  // Adverbs split before は (実は, 先ずは): src/tokenizer/wa-adverbs.ts.
  const waAdverb =
    partOfSpeech.some((pos) => pos === "adv" || pos === "conj") &&
    kanjiForms.some((text) => text.length > 1 && text.endsWith("は"));
  if (!verbalExpression && !waAdverb) continue;
  const senses = word.sense
    .filter((sense) => !(sense.misc ?? []).some((tag) => OUTDATED.has(tag)))
    .map((sense) => ({
      glosses: (sense.gloss ?? []).map((gloss) => (typeof gloss === "string" ? gloss : gloss.text)).filter(Boolean),
      tags: [...(sense.tags ?? []), ...(sense.misc ?? [])],
    }))
    .filter((sense) => sense.glosses.length > 0);
  if (senses.length === 0) continue;

  const kanji = (word.kanji ?? []).map((form) => form.text);
  const readings = word.kana.map((form) => form.text);
  const headword = kanji[0] ?? readings[0];
  const reading = readings[0] ?? headword;
  const aliases = [...new Set([...kanji, ...readings])].filter((form) => form !== headword && form !== reading);
  entries.push({
    headword,
    reading,
    spellings: kanji,
    readings,
    ...(aliases.length > 0 ? { aliases } : undefined),
    partOfSpeech,
    senses: senses.map(({ glosses, tags }) => (tags.length > 0 ? { glosses, tags } : { glosses })),
    common: [...(word.kanji ?? []), ...word.kana].some((form) => form.common),
  });
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({ version: JMDICT_VERSION, entries })}\n`, "utf8");
console.log(`Wrote ${entries.length} expressions to ${OUTPUT_PATH}`);
