// ---------------------------------------------------------------------------
// Common words that UniDic splits in two (実 + は, 申し訳 + ない).
// ---------------------------------------------------------------------------
//
// A short hand-kept list rather than a dictionary rule: JMdict also files
// それは or 上は as adverbs and conjunctions, which would merge 机の上は.
// Their definitions are in every JMdict pack or in the bundled expression list.

import { tokenCanonicalKey, tokenDictionaryForm, type Token } from "@/core/types";
import { toHiragana } from "@/core/kana";

interface SplitWord {
  /** JMdict headword: the identity shared by every spelling. */
  headword: string;
  /** Reading of the first morpheme: 実 (じつ) is not 実 (み), 要 (よう) not 要 (かなめ). */
  headReading: string;
}

/** Adverbs and conjunctions ending in particles (実 + は, 時 + に + は). */
interface ParticleWord extends SplitWord {
  spellings: string[];
  partOfSpeech: string;
}

/** い-adjectives ending in ない, which keeps its inflection (申し訳なかった). */
interface NaiWord extends SplitWord {
  /** Written forms of the first morpheme. */
  heads: string[];
  /** Also 申し訳ありません / ございません: polite negative, same word. */
  polite: boolean;
}

const PARTICLE_WORDS: ParticleWord[] = [
  { headword: "実は", spellings: ["実は", "じつは"], headReading: "じつ", partOfSpeech: "副詞" },
  { headword: "要は", spellings: ["要は", "ようは"], headReading: "よう", partOfSpeech: "副詞" },
  {
    headword: "実際は",
    spellings: ["実際は", "じっさいは"],
    headReading: "じっさい",
    partOfSpeech: "副詞",
  },
  {
    headword: "先ずは",
    spellings: ["先ずは", "まずは"],
    headReading: "まず",
    partOfSpeech: "副詞",
  },
  {
    headword: "恐らくは",
    spellings: ["恐らくは", "おそらくは"],
    headReading: "おそらく",
    partOfSpeech: "副詞",
  },
  {
    headword: "時には",
    spellings: ["時には", "ときには"],
    headReading: "とき",
    partOfSpeech: "副詞",
  },
  {
    headword: "今では",
    spellings: ["今では", "いまでは"],
    headReading: "いま",
    partOfSpeech: "副詞",
  },
  {
    headword: "何時かは",
    spellings: ["何時かは", "いつかは"],
    headReading: "いつ",
    partOfSpeech: "副詞",
  },
  {
    headword: "因みに",
    spellings: ["因みに", "ちなみに"],
    headReading: "ちなみ",
    partOfSpeech: "接続詞",
  },
  {
    headword: "疾っくに",
    spellings: ["疾っくに", "とっくに"],
    headReading: "とっく",
    partOfSpeech: "副詞",
  },
  { headword: "一気に", spellings: ["一気に"], headReading: "いっき", partOfSpeech: "副詞" },
  // Usually one UniDic word; kept for the contexts where it splits.
  { headword: "さっさと", spellings: ["さっさと"], headReading: "さっさ", partOfSpeech: "副詞" },
];

const NAI_WORDS: NaiWord[] = [
  {
    headword: "申し訳ない",
    heads: ["申し訳", "申しわけ"],
    headReading: "もうしわけ",
    polite: true,
  },
  { headword: "勿体ない", heads: ["もったい", "勿体"], headReading: "もったい", polite: false },
  { headword: "とんでも無い", heads: ["とんでも"], headReading: "とんでも", polite: true },
];

const MAX_PARTICLE_PARTS = 3;
const POLITE_VERBS = new Set(["ある", "有る", "ござる", "御座る"]);
const NEGATIVE_AUXILIARIES = new Set(["ず", "ぬ", "ん"]);

const readingOf = (token: Token): string => toHiragana(token.reading.normalize("NFKC"));
const formsOf = (token: Token): string[] => [tokenDictionaryForm(token), tokenCanonicalKey(token)];

/** A determined noun keeps its own sense: 子供の時には is « when », not « sometimes ». */
function isModifier(token: Token | undefined): boolean {
  if (!token) return false;
  // ん is の in speech (頃んとき), even when UniDic takes it for a filler (中２んとき).
  if (token.surface === "ん") return true;
  if (
    token.partOfSpeech.includes("助詞") &&
    (token.surface === "の" || tokenDictionaryForm(token) === "の")
  ) {
    return true;
  }
  return ["動詞", "形容詞", "助動詞", "連体詞"].some((pos) => token.partOfSpeech.includes(pos));
}

/** で + は + ない / ありません is the negated copula: 今ではなく明日 is « not now ». */
function isNegatedCopula(surface: string, next: Token | undefined): boolean {
  if (!next || !surface.endsWith("では")) return false;
  const forms = formsOf(next);
  return (
    (next.partOfSpeech.includes("形容詞") &&
      forms.some((form) => ["ない", "無い"].includes(form))) ||
    (next.partOfSpeech.includes("動詞") && forms.some((form) => POLITE_VERBS.has(form)))
  );
}

function findParticleWord(tokens: Token[], start: number): { token: Token; length: number } | null {
  const head = tokens[start];
  if (!head || isModifier(tokens[start - 1])) return null;
  const headReading = readingOf(head);
  for (let length = MAX_PARTICLE_PARTS; length >= 2; length -= 1) {
    const parts = tokens.slice(start, start + length);
    if (
      parts.length < length ||
      !parts.slice(1).every((part) => part.partOfSpeech.includes("助詞"))
    ) {
      continue;
    }
    const surface = parts.map((part) => part.surface).join("");
    const word = PARTICLE_WORDS.find(
      (candidate) => candidate.headReading === headReading && candidate.spellings.includes(surface),
    );
    if (!word || isNegatedCopula(surface, tokens[start + length])) continue;
    const reading = `${word.headReading}${surface.slice(head.surface.length)}`;
    return {
      length,
      token: {
        surface,
        dictionaryForm: surface,
        canonicalKey: word.headword,
        lookupTerms: [...new Set([surface, ...word.spellings])],
        lemma: word.headword,
        reading,
        dictionaryReading: reading,
        partOfSpeech: [word.partOfSpeech],
        components: parts,
        dictionaryCompound: true,
      },
    };
  }
  return null;
}

/**
 * 申し訳 + ない (or polite あり + ませ + ん) becomes one morpheme that keeps
 * the tail's morphology, so the predicate grouping still adds its
 * inflection (申し訳なかった, 申し訳ありませんでした).
 */
function findNaiWord(tokens: Token[], start: number): { token: Token; length: number } | null {
  const head = tokens[start];
  const tail = tokens[start + 1];
  if (!head || !tail) return null;
  const word = NAI_WORDS.find(
    (candidate) =>
      candidate.heads.includes(head.surface) && candidate.headReading === readingOf(head),
  );
  if (!word) return null;

  const isNai =
    tail.partOfSpeech.includes("形容詞") &&
    formsOf(tail).some((form) => ["ない", "無い"].includes(form));
  const isPoliteNegative =
    word.polite &&
    tail.partOfSpeech.includes("動詞") &&
    formsOf(tail).some((form) => POLITE_VERBS.has(form)) &&
    tokenDictionaryForm(tokens[start + 2] ?? tail) === "ます" &&
    NEGATIVE_AUXILIARIES.has(tokenDictionaryForm(tokens[start + 3] ?? tail));
  if (!isNai && !isPoliteNegative) return null;

  const dictionaryForm = `${head.surface}ない`;
  const dictionaryReading = `${word.headReading}ない`;
  return {
    length: 2,
    token: {
      surface: `${head.surface}${tail.surface}`,
      dictionaryForm,
      canonicalKey: word.headword,
      lookupTerms: [...new Set([dictionaryForm, word.headword])],
      lemma: word.headword,
      reading: `${readingOf(head)}${readingOf(tail)}`,
      dictionaryReading,
      partOfSpeech: tail.partOfSpeech,
      ...(tail.partOfSpeechDetails ? { partOfSpeechDetails: tail.partOfSpeechDetails } : undefined),
      ...(tail.conjugationType ? { conjugationType: tail.conjugationType } : undefined),
      ...(tail.conjugationForm ? { conjugationForm: tail.conjugationForm } : undefined),
      components: [head, tail],
      dictionaryCompound: true,
    },
  };
}

/** Merge 実 + は, 申し訳 + ない… into one word; anything else is untouched. */
export function mergeSplitWords(tokens: Token[]): Token[] {
  const result: Token[] = [];
  for (let start = 0; start < tokens.length;) {
    const found = findParticleWord(tokens, start) ?? findNaiWord(tokens, start);
    if (found) {
      result.push(found.token);
      start += found.length;
    } else {
      const token = tokens[start];
      if (token) result.push(token);
      start += 1;
    }
  }
  return result;
}
