import { inflateSync, strFromU8 } from "fflate";

/**
 * Practical Japanese frequency data.
 *
 * TUBELEX supplies the primary video/subtitle ranking. CEJC supplies a second
 * ranking from recorded everyday conversations. For learning priority, a
 * lemma keeps the best (lowest) rank found in either relevant corpus.
 */
export const FREQUENCY_DATA_VERSION = "tubelex-top50k-cejc-202201-v1";

export const TUBELEX_FREQUENCY_PATH = "frequency/tubelex-ja-lemma-top50k.tsv";

export const CEJC_FREQUENCY_URL =
  "https://www2.ninjal.ac.jp/conversation/cejc-monitor/data/CEJC%E8%AA%9E%E5%BD%99%E8%A1%A8_%E8%AA%9E%E5%BD%99%E7%B4%A0%E3%81%AE%E3%81%BF_%E8%AA%9E%E5%BD%A2%E5%88%A5_ver202201.zip";

export interface FrequencyEntry {
  key: string;
  rank: number;
}

interface ZipLocalEntry {
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const CEJC_ZIP_HEADER_END = 262_143;

function normalizeKey(value: string): string {
  return value.trim().normalize("NFKC");
}

function isLearningEntry(key: string, partOfSpeech = ""): boolean {
  return (
    key.length > 0 &&
    key !== "[TOTAL]" &&
    !partOfSpeech.includes("補助記号") &&
    !partOfSpeech.includes("記号") &&
    !partOfSpeech.includes("固有名詞")
  );
}

function entriesFromBestRanks(bestRanks: Map<string, number>): FrequencyEntry[] {
  return [...bestRanks.entries()]
    .map(([key, rank]) => ({ key, rank }))
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

/** Parse the compact `lemma<TAB>rank` TUBELEX asset bundled with SubJap. */
export function parseTubelexFrequencyList(text: string): FrequencyEntry[] {
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

/** Parse the official CEJC vocabulary TSV, whose first column is already rank. */
export function parseCejcFrequencyList(text: string): FrequencyEntry[] {
  const lines = text.split(/\r?\n/);
  const header = lines.shift()?.split("\t") ?? [];
  const rankIndex = header.indexOf("rank");
  const lemmaIndex = header.indexOf("語彙素");
  const partOfSpeechIndex = header.indexOf("品詞");

  if (rankIndex < 0 || lemmaIndex < 0 || partOfSpeechIndex < 0) {
    throw new Error("Unexpected CEJC vocabulary header");
  }

  const bestRanks = new Map<string, number>();
  for (const line of lines) {
    if (!line) continue;
    const columns = line.split("\t");
    const key = normalizeKey(columns[lemmaIndex] ?? "");
    const partOfSpeech = columns[partOfSpeechIndex] ?? "";
    const rank = Number.parseInt(columns[rankIndex] ?? "", 10);
    if (!isLearningEntry(key, partOfSpeech) || !Number.isFinite(rank) || rank < 1) {
      continue;
    }

    bestRanks.set(key, Math.min(bestRanks.get(key) ?? Infinity, rank));
  }

  return entriesFromBestRanks(bestRanks);
}

function filenameFromZipBytes(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function findCejcTsvEntry(bytes: Uint8Array): ZipLocalEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== ZIP_LOCAL_FILE_SIGNATURE) break;

    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const filenameOffset = offset + 30;
    const dataOffset = filenameOffset + filenameLength + extraLength;

    if (flags & 0x08) {
      throw new Error("Unsupported CEJC ZIP data descriptor");
    }
    if (dataOffset > bytes.length) break;

    const filename = filenameFromZipBytes(
      bytes.subarray(filenameOffset, filenameOffset + filenameLength),
    );
    if (filename.toLowerCase().endsWith(".tsv")) {
      return { compression, compressedSize, uncompressedSize, dataOffset };
    }

    offset = dataOffset + compressedSize;
  }

  throw new Error("CEJC archive header does not contain a TSV vocabulary entry");
}

function parseCejcCompressedEntry(
  compressed: Uint8Array,
  entry: ZipLocalEntry,
): FrequencyEntry[] {
  if (compressed.length !== entry.compressedSize) {
    throw new Error("Incomplete CEJC TSV ZIP entry");
  }

  let vocabulary: Uint8Array;
  if (entry.compression === 0) {
    vocabulary = compressed;
  } else if (entry.compression === 8) {
    vocabulary = inflateSync(compressed, {
      out: new Uint8Array(entry.uncompressedSize),
    });
  } else {
    throw new Error(`Unsupported CEJC ZIP compression: ${entry.compression}`);
  }

  return parseCejcFrequencyList(strFromU8(vocabulary));
}

/** Extract only the TSV local entry from a CEJC ZIP and parse its ranked rows. */
export function parseCejcFrequencyArchive(archive: ArrayBuffer | Uint8Array): FrequencyEntry[] {
  const bytes = ArrayBuffer.isView(archive)
    ? new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength)
    : new Uint8Array(archive);
  const entry = findCejcTsvEntry(bytes);
  return parseCejcCompressedEntry(
    bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize),
    entry,
  );
}

/** Keep the best rank observed in any supplied practical-language corpus. */
export function mergeFrequencyRanks(...sources: readonly FrequencyEntry[][]): FrequencyEntry[] {
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

async function fetchTubelexFrequencyRanks(): Promise<FrequencyEntry[]> {
  const response = await fetch(extensionUrl(TUBELEX_FREQUENCY_PATH));
  if (!response.ok) {
    throw new Error(`TUBELEX frequency list HTTP ${response.status}: ${response.statusText}`);
  }
  return parseTubelexFrequencyList(await response.text());
}

export async function fetchCejcFrequencyRanks(): Promise<FrequencyEntry[]> {
  const header = await fetchCejcRange(0, CEJC_ZIP_HEADER_END);
  const entry = findCejcTsvEntry(header);
  const start = entry.dataOffset;
  const end = start + entry.compressedSize - 1;
  const compressed = await fetchCejcRange(start, end);
  return parseCejcCompressedEntry(compressed, entry);
}

async function fetchCejcRange(start: number, end: number): Promise<Uint8Array> {
  const response = await fetch(CEJC_FREQUENCY_URL, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(
      `CEJC frequency range HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) {
    throw new Error(`Incomplete CEJC frequency range ${start}-${end}`);
  }
  return bytes;
}

export async function fetchJapaneseFrequencyRanks(): Promise<FrequencyEntry[]> {
  const [tubelex, cejc] = await Promise.all([
    fetchTubelexFrequencyRanks(),
    fetchCejcFrequencyRanks(),
  ]);
  return mergeFrequencyRanks(tubelex, cejc);
}
