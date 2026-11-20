import type { Token } from "@/core/types";
import { toHiragana } from "@/core/kana";
import { stripLexemeGloss } from "@/core/lexical-key";

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

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const VOWEL_ROWS: [string, string][] = [
  ["あ", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["い", "いきしちにひみりぎじぢびぴぃ"],
  ["う", "うくすつぬふむゆるぐずづぶぷぅゅ"],
  // Long e and o are spelled えい / おう in native and Sino-Japanese words.
  ["い", "えけせてねへめれげぜでべぺぇ"],
  ["う", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const PHONOLOGICAL_SPELLINGS: Record<string, string> = { ー: "あいうえお", ず: "づ", じ: "ぢ" };

function longVowelSpelling(previous: string | undefined): string {
  return VOWEL_ROWS.find(([, row]) => previous && row.includes(previous))?.[0] ?? "ー";
}

/**
 * UniDic's `reading` is the lexeme reading (じゃ→ダ, 選ん→エラブ). Its
 * phonological forms follow the actual morpheme (来→キ, 本→ポン) but write
 * long vowels as ー and ぢ/づ as じ/ず: restore them from the lexeme reading
 * while both still agree, else from the preceding vowel.
 */
function kanaReading(written: string, pronunciation: string, lexemeReading: string): string {
  if (KANA_ONLY.test(written)) return toHiragana(written);
  if (!pronunciation) return toHiragana(lexemeReading || written);
  const pron = toHiragana(pronunciation);
  const lexeme = toHiragana(lexemeReading);
  let spelled = "";
  for (const char of pron) {
    const lexemeChar = lexeme[spelled.length];
    if (
      lexemeChar &&
      lexeme.startsWith(spelled) &&
      PHONOLOGICAL_SPELLINGS[char]?.includes(lexemeChar)
    )
      spelled += lexemeChar;
    else spelled += char === "ー" ? longVowelSpelling(spelled.at(-1)) : char;
  }
  return spelled;
}

/**
 * UniDic conjugates 信じろ, 信じられない, 感じた as the literary サ変 verbs
 * 信ずる, 感ずる. A じ form is the modern 上一段 verb (信じる): its base form is
 * the one heard, shown and mined. A ず/ぜ surface (信ずる, 信ぜよ) keeps ずる.
 */
function modernJiruForm(form: string, surface: string, conjugationType: string): string {
  if (!conjugationType.startsWith("サ行変格") || form.length <= 2 || !form.endsWith("ずる"))
    return form;
  const stem = form.slice(0, -2);
  return surface.startsWith(`${stem}じ`) ? `${stem}じる` : form;
}

/** しんずる → しんじる, alongside {@link modernJiruForm}. */
function jiruReading(reading: string, jiruVerb: boolean): string {
  return jiruVerb && reading.endsWith("ずる") ? `${reading.slice(0, -2)}じる` : reading;
}

/** Convert one Lindera/UniDic token to the shared SubJap contract. */
export function toLinderaToken(input: RawLinderaToken): Token {
  const raw = normalizeRawToken(input);
  const unidicBaseForm = nonStar(raw.orthographicBaseForm, raw.surface);
  const dictionaryForm = modernJiruForm(unidicBaseForm, raw.surface, raw.conjugationType ?? "");
  const jiruVerb = dictionaryForm !== unidicBaseForm;
  // テレビ-television → テレビ: SubJap's identity is the word, not UniDic's gloss.
  const canonicalKey = stripLexemeGloss(nonStar(raw.lexeme, dictionaryForm));
  const lexemeReading = nonStar(raw.reading, "");
  const reading = kanaReading(raw.surface, nonStar(raw.phonologicalSurfaceForm, ""), lexemeReading);
  const phonologicalBaseForm = nonStar(raw.phonologicalBaseForm, "");
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
    toHiragana(lexemeReading || raw.surface),
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
    dictionaryReading: phonologicalBaseForm
      ? jiruReading(kanaReading(unidicBaseForm, phonologicalBaseForm, lexemeReading), jiruVerb)
      : "",
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
