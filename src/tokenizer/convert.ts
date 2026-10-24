import type { Token } from "@/core/types";
import { toHiragana } from "@/core/kana";

/** Stable subset of Lindera UniDic's JSON token shape. */
export interface RawLinderaToken {
  surface: string;
  byteStart: number;
  byteEnd: number;
  lexeme: string;
  orthographicBaseForm: string;
  orthographicSurfaceForm: string;
  phonologicalBaseForm: string;
  phonologicalSurfaceForm: string;
  reading: string;
  partOfSpeech: string;
  partOfSpeechSubcategory1: string;
  partOfSpeechSubcategory2: string;
  partOfSpeechSubcategory3: string;
  conjugationType: string;
  conjugationForm: string;
}

function nonStar(value: string | undefined, fallback: string): string {
  return value && value !== "*" ? value : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value) && value !== "*"))];
}

const RAW_TEXT_FIELDS = [
  "surface",
  "lexeme",
  "orthographicBaseForm",
  "orthographicSurfaceForm",
  "phonologicalBaseForm",
  "phonologicalSurfaceForm",
  "reading",
  "partOfSpeech",
  "partOfSpeechSubcategory1",
  "partOfSpeechSubcategory2",
  "partOfSpeechSubcategory3",
  "conjugationType",
  "conjugationForm",
] as const;

/**
 * Lindera's WASM binding returns numeric-looking UniDic features as JSON
 * numbers: the base form of the ASCII digit "3" arrives as 3. Coerce every
 * textual feature back to a string so lexical keys stay strings downstream.
 */
function normalizeRawToken(raw: RawLinderaToken): RawLinderaToken {
  const normalized = { ...raw };
  for (const field of RAW_TEXT_FIELDS) {
    const value: unknown = raw[field];
    normalized[field] = value == null ? "" : String(value);
  }
  return normalized;
}

/** Convert one Lindera/UniDic token to the shared SubJap contract. */
export function toLinderaToken(input: RawLinderaToken): Token {
  const raw = normalizeRawToken(input);
  const dictionaryForm = nonStar(raw.orthographicBaseForm, raw.surface);
  const canonicalKey = nonStar(raw.lexeme, dictionaryForm);
  const reading = toHiragana(nonStar(raw.reading, raw.surface));
  const details = unique([
    raw.partOfSpeechSubcategory1,
    raw.partOfSpeechSubcategory2,
    raw.partOfSpeechSubcategory3,
  ]);
  const lookupTerms = unique([
    dictionaryForm,
    canonicalKey,
    nonStar(raw.orthographicSurfaceForm, raw.surface),
    nonStar(raw.phonologicalSurfaceForm, ""),
    reading,
  ]);

  return {
    surface: raw.surface,
    dictionaryForm,
    canonicalKey,
    lookupTerms,
    // Compatibility field for old persisted fixtures; new code uses the
    // explicit dictionaryForm/canonicalKey fields above.
    lemma: canonicalKey,
    reading,
    dictionaryReading: toHiragana(nonStar(raw.phonologicalBaseForm, "")),
    partOfSpeech: raw.partOfSpeech && raw.partOfSpeech !== "*" ? [raw.partOfSpeech] : [],
    ...(details.length > 0 ? { partOfSpeechDetails: details } : undefined),
    ...(raw.conjugationType && raw.conjugationType !== "*"
      ? { conjugationType: raw.conjugationType }
      : undefined),
    ...(raw.conjugationForm && raw.conjugationForm !== "*"
      ? { conjugationForm: raw.conjugationForm }
      : undefined),
  };
}

/**
 * Lindera reports UTF-8 byte offsets. The surface is authoritative, but this
 * guard makes malformed bindings fail loudly instead of silently dropping or
 * duplicating Japanese text.
 */
export function assertLinderaSurfaceCoverage(
  sentence: string,
  rawTokens: Pick<RawLinderaToken, "surface" | "byteStart" | "byteEnd">[],
): void {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sentence);
  let cursor = 0;
  for (const token of rawTokens) {
    if (
      !Number.isInteger(token.byteStart) ||
      !Number.isInteger(token.byteEnd) ||
      token.byteStart !== cursor ||
      token.byteEnd <= token.byteStart
    ) {
      throw new Error(
        `UniDic offsets are not contiguous at ${token.surface}: expected ${cursor}, got ${token.byteStart}`,
      );
    }
    const encoded = encoder.encode(token.surface);
    if (encoded.byteLength !== token.byteEnd - token.byteStart) {
      throw new Error(`UniDic offset length mismatch for ${token.surface}`);
    }
    cursor = token.byteEnd;
  }
  if (cursor !== bytes.byteLength) {
    throw new Error(`UniDic surfaces cover ${cursor}/${bytes.byteLength} UTF-8 bytes`);
  }
  if (rawTokens.map((token) => token.surface).join("") !== sentence) {
    throw new Error("UniDic surfaces do not reproduce the input text");
  }
}
