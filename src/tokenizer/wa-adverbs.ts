// ---------------------------------------------------------------------------
// Adverbs that UniDic splits before は (実は → 実 + は).
// ---------------------------------------------------------------------------
//
// A short hand-kept list rather than a dictionary rule: JMdict also files
// それは or 上は as adverbs and conjunctions, which would merge 机の上は.
// Their definitions ship in the bundled expression list, whatever the pack.

import { tokenDictionaryForm, type Token } from "@/core/types";
import { toHiragana } from "@/core/kana";

interface WaAdverb {
  /** JMdict headword: the identity shared by every spelling. */
  headword: string;
  spellings: string[];
  /** Reading of the first morpheme: 実 (じつ) is not 実 (み), 要 (よう) not 要 (かなめ). */
  headReading: string;
}

const WA_ADVERBS: WaAdverb[] = [
  { headword: "実は", spellings: ["実は", "じつは"], headReading: "じつ" },
  { headword: "要は", spellings: ["要は", "ようは"], headReading: "よう" },
  { headword: "実際は", spellings: ["実際は", "じっさいは"], headReading: "じっさい" },
  { headword: "先ずは", spellings: ["先ずは", "まずは"], headReading: "まず" },
  { headword: "恐らくは", spellings: ["恐らくは", "おそらくは"], headReading: "おそらく" },
  { headword: "時には", spellings: ["時には", "ときには"], headReading: "とき" },
  { headword: "今では", spellings: ["今では", "いまでは"], headReading: "いま" },
  { headword: "何時かは", spellings: ["何時かは", "いつかは"], headReading: "いつ" },
];

const MAX_PARTS = 3;

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

function findAdverb(tokens: Token[], start: number): { adverb: WaAdverb; length: number } | null {
  const head = tokens[start];
  if (!head || isModifier(tokens[start - 1])) return null;
  const headReading = toHiragana(head.reading.normalize("NFKC"));
  for (let length = MAX_PARTS; length >= 2; length -= 1) {
    const parts = tokens.slice(start, start + length);
    if (
      parts.length < length ||
      !parts.slice(1).every((part) => part.partOfSpeech.includes("助詞"))
    ) {
      continue;
    }
    const surface = parts.map((part) => part.surface).join("");
    const adverb = WA_ADVERBS.find(
      (candidate) => candidate.headReading === headReading && candidate.spellings.includes(surface),
    );
    if (adverb) return { adverb, length };
  }
  return null;
}

function createAdverbToken(parts: Token[], adverb: WaAdverb): Token {
  const surface = parts.map((part) => part.surface).join("");
  const reading = `${adverb.headReading}${surface.slice(parts[0]?.surface.length ?? 0)}`;
  return {
    surface,
    dictionaryForm: surface,
    canonicalKey: adverb.headword,
    lookupTerms: [...new Set([surface, ...adverb.spellings])],
    lemma: adverb.headword,
    reading,
    dictionaryReading: reading,
    partOfSpeech: ["副詞"],
    components: parts,
    dictionaryCompound: true,
  };
}

/** Merge 実 + は, 時 + に + は… into one adverb; anything else is untouched. */
export function mergeWaAdverbs(tokens: Token[]): Token[] {
  const result: Token[] = [];
  for (let start = 0; start < tokens.length;) {
    const found = findAdverb(tokens, start);
    if (found) {
      result.push(createAdverbToken(tokens.slice(start, start + found.length), found.adverb));
      start += found.length;
    } else {
      const token = tokens[start];
      if (token) result.push(token);
      start += 1;
    }
  }
  return result;
}
