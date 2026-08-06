// ---------------------------------------------------------------------------
// SubJap — jmdict-simplified download & conversion
// ---------------------------------------------------------------------------
//
// The dictionary ships as a .tgz GitHub Release asset. The service worker
// downloads it, gunzips (native DecompressionStream), parses the tar, and
// converts jmdict-simplified entries into our shared DictionaryEntry shape
// before bulk-inserting them into IndexedDB.
//
// Format reference: github.com/scriptin/jmdict-simplified (v3.x wraps the
// entry list in an object; glosses are { lang, text } objects).

import type { DictionaryEntry } from "@/core/types";

/**
 * Default source: English, "common-only" build (~22k frequent words).
 * The versioned asset name must be updated when a new release ships.
 */
export const JMDICT_DEFAULT_URL =
  "https://github.com/scriptin/jmdict-simplified/releases/latest/download/jmdict-eng-common-3.6.2+20260803141815.json.tgz";

/** Downloadable dictionary packs (asset names versioned per GitHub release). */
export interface JmdictPack {
  id: "common" | "full";
  label: string;
  description: string;
  url: string;
  approxEntries: number;
}

export const JMDICT_PACKS: [JmdictPack, JmdictPack] = [
  {
    id: "common",
    label: "Courant (~22k mots)",
    description: "jmdict-eng-common — les mots les plus fréquents, ~1,4 Mo",
    url: JMDICT_DEFAULT_URL,
    approxEntries: 22626,
  },
  {
    id: "full",
    label: "Complet (~218k mots)",
    description: "jmdict-eng — tout le dictionnaire, ~11 Mo à télécharger",
    url: "https://github.com/scriptin/jmdict-simplified/releases/latest/download/jmdict-eng-3.6.2+20260803141815.json.tgz",
    approxEntries: 218290,
  },
];

// ── Raw jmdict-simplified shapes ──────────────────────────────────────────

interface JmdictSurface {
  common: boolean;
  text: string;
  tags: string[];
}

interface JmdictGloss {
  lang?: string;
  text: string;
}

interface JmdictSense {
  partOfSpeech?: string[];
  gloss?: (string | JmdictGloss)[];
  tags?: string[];
  misc?: string[];
  info?: string[];
}

interface JmdictWord {
  id: string;
  kanji?: JmdictSurface[];
  kana: JmdictSurface[];
  sense: JmdictSense[];
}

interface JmdictFile {
  version?: string;
  languages?: string[];
  commonOnly?: boolean;
  words: JmdictWord[];
}

// ── Conversion ────────────────────────────────────────────────────────────

/** Convert one jmdict-simplified word into our DictionaryEntry. */
export function convertJmdictWord(word: JmdictWord): DictionaryEntry | null {
  const headword = word.kanji?.[0]?.text ?? word.kana[0]?.text ?? "";
  if (!headword) return null;

  const reading = word.kana[0]?.text ?? headword;
  const common =
    (word.kanji?.some((k) => k.common) ?? false) ||
    word.kana.some((k) => k.common);

  const senses = (word.sense ?? []).map((sense) => ({
    glosses: (sense.gloss ?? [])
      .map((g) => (typeof g === "string" ? g : g.text))
      .filter((text) => text.length > 0),
    tags: [...(sense.tags ?? []), ...(sense.misc ?? [])],
  }));

  return {
    headword,
    reading,
    partOfSpeech: word.sense?.[0]?.partOfSpeech ?? [],
    senses,
    common,
  };
}

// ── Tar parsing ───────────────────────────────────────────────────────────

/**
 * Parse a POSIX tar byte buffer into file name → contents.
 * Only regular files (type 0) are extracted; directories and links skipped.
 */
export function parseTar(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  const view = new DataView(buffer);
  let offset = 0;

  while (offset + 512 <= buffer.byteLength) {
    const name = decoder
      .decode(new Uint8Array(buffer, offset, 100))
      .replace(/\0.*$/, "")
      .trim();
    if (name === "") break;

    const sizeStr = decoder
      .decode(new Uint8Array(buffer, offset + 124, 12))
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeStr, 8);
    if (Number.isNaN(size)) break;

    const type = String.fromCharCode(view.getUint8(offset + 156));
    const dataStart = offset + 512;

    if (type === "0" || type === "\0" || type === "") {
      files.set(name, new Uint8Array(buffer.slice(dataStart, dataStart + size)));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

// ── Download pipeline ─────────────────────────────────────────────────────

/**
 * Download a jmdict-simplified .tgz asset, gunzip it, extract the JSON,
 * and convert it into our DictionaryEntry shape.
 *
 * Throws on network/parse failure so callers can surface the error.
 */
export async function fetchJmdictTgz(url: string): Promise<DictionaryEntry[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Dictionary download failed: HTTP ${response.status}`);
  }

  const compressed = await response.arrayBuffer();
  const decompressor = new DecompressionStream("gzip");
  const decompressed = await new Response(
    new Blob([compressed]).stream().pipeThrough(decompressor),
  ).arrayBuffer();

  const files = parseTar(decompressed);
  const jsonName = [...files.keys()].find((name) => name.endsWith(".json"));
  if (!jsonName) throw new Error("No dictionary JSON found in archive");

  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(files.get(jsonName)),
  );
  const words: JmdictWord[] = Array.isArray(parsed)
    ? (parsed as unknown as JmdictWord[])
    : ((parsed as JmdictFile).words ?? []);

  const entries: DictionaryEntry[] = [];
  for (const word of words) {
    const entry = convertJmdictWord(word);
    if (entry) entries.push(entry);
  }
  return entries;
}
