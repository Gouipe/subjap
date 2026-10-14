import type { DictionaryEntry, Token } from "@/core/types";
import { toHiragana } from "@/core/kana";
import { entryReadings, entrySpellings, selectDictionaryEntry } from "./match";

const MAX_COMPOUND_COMPONENTS = 4;

const RENDAKU_INITIALS = new Map([
  ["か", "が"],
  ["き", "ぎ"],
  ["く", "ぐ"],
  ["け", "げ"],
  ["こ", "ご"],
  ["さ", "ざ"],
  ["し", "じ"],
  ["す", "ず"],
  ["せ", "ぜ"],
  ["そ", "ぞ"],
  ["た", "だ"],
  ["ち", "ぢ"],
  ["つ", "づ"],
  ["て", "で"],
  ["と", "ど"],
  ["は", "ば"],
  ["ひ", "び"],
  ["ふ", "ぶ"],
  ["へ", "べ"],
  ["ほ", "ぼ"],
]);

function isNominalHead(token: Token): boolean {
  return (
    !token.grammar?.length &&
    (token.partOfSpeech.includes("名詞") || token.partOfSpeech.includes("代名詞")) &&
    !token.partOfSpeech.includes("接尾辞")
  );
}

function isCompoundStart(token: Token): boolean {
  return isNominalHead(token) || (!token.grammar?.length && token.partOfSpeech.includes("接頭辞"));
}

function isNominalContinuation(token: Token): boolean {
  if (token.grammar?.length) return false;
  if (token.partOfSpeech.includes("名詞") || token.partOfSpeech.includes("代名詞")) return true;
  return (
    token.partOfSpeech.includes("接尾辞") && token.partOfSpeechDetails?.includes("名詞的") === true
  );
}

function areAdjacent(left: Token, right: Token): boolean {
  return left.endOffset !== undefined && right.startOffset === left.endOffset;
}

function candidateSurface(parts: Token[]): string {
  return parts
    .map((part) => part.surface)
    .join("")
    .replace(/\n/gu, "");
}

function normalizedPartReadings(parts: Token[]): string[] {
  return parts.map((part) =>
    toHiragana((part.reading || part.dictionaryReading || "").normalize("NFKC")),
  );
}

function compoundReadingVariants(parts: Token[]): string[] {
  const readings = normalizedPartReadings(parts);
  if (readings.some((reading) => reading.length === 0)) return [];

  const variants = new Set([readings.join("")]);
  for (let index = 1; index < readings.length; index += 1) {
    const reading = readings[index];
    if (!reading) continue;
    const first = Array.from(reading)[0];
    const voiced = first ? RENDAKU_INITIALS.get(first) : undefined;
    if (voiced) {
      variants.add(
        `${readings.slice(0, index).join("")}${voiced}${Array.from(reading).slice(1).join("")}${readings.slice(index + 1).join("")}`,
      );
    }
  }
  return [...variants];
}

function matchingEntryReading(entry: DictionaryEntry, parts: Token[]): string | null {
  const variants = compoundReadingVariants(parts);
  if (variants.length === 0) return null;
  return (
    entryReadings(entry).find((reading) => {
      const normalized = toHiragana(reading.normalize("NFKC"));
      return normalized === variants[0];
    }) ??
    entryReadings(entry).find((reading) =>
      variants.includes(toHiragana(reading.normalize("NFKC"))),
    ) ??
    null
  );
}

function compoundPosHead(parts: Token[]): Token {
  const first = parts[0];
  if (!first) throw new Error("A dictionary compound requires at least one token");
  return parts.find(isNominalHead) ?? first;
}

/** Candidate spellings from adjacent nominal UniDic fragments, for one batched JMdict lookup. */
export function dictionaryCompoundLookupTerms(tokens: Token[]): string[] {
  const terms = new Set<string>();

  for (let start = 0; start < tokens.length; start += 1) {
    const head = tokens[start];
    if (!head || !isCompoundStart(head)) continue;

    const parts = [head];
    for (
      let end = start + 1;
      end < tokens.length && end < start + MAX_COMPOUND_COMPONENTS;
      end += 1
    ) {
      const previous = tokens[end - 1];
      const next = tokens[end];
      if (!previous || !next || !isNominalContinuation(next) || !areAdjacent(previous, next)) break;

      parts.push(next);
      terms.add(candidateSurface(parts));
    }
  }

  return [...terms].filter(Boolean);
}

function makeLookupToken(parts: Token[], surface: string): Token {
  const head = compoundPosHead(parts);
  return {
    surface,
    dictionaryForm: surface,
    canonicalKey: surface,
    lookupTerms: [surface],
    lemma: surface,
    reading: parts.map((part) => part.reading).join(""),
    dictionaryReading: parts.map((part) => part.dictionaryReading ?? part.reading).join(""),
    partOfSpeech: head.partOfSpeech,
    ...(head.partOfSpeechDetails ? { partOfSpeechDetails: head.partOfSpeechDetails } : undefined),
  };
}

function createCompoundToken(parts: Token[], surface: string, entry: DictionaryEntry): Token {
  const surfaceHead = parts[0];
  const tail = parts[parts.length - 1];
  if (!surfaceHead || !tail) throw new Error("A dictionary compound requires at least one token");
  const posHead = compoundPosHead(parts);
  const dictionaryReading = matchingEntryReading(entry, parts) ?? entry.reading;
  const reading = toHiragana(dictionaryReading);

  return {
    surface: parts.map((part) => part.surface).join(""),
    dictionaryForm: surface,
    canonicalKey: entry.headword,
    lookupTerms: [...new Set([surface, entry.headword, ...entrySpellings(entry)])],
    lemma: entry.headword,
    reading,
    dictionaryReading: reading,
    ...(surfaceHead.startOffset !== undefined
      ? { startOffset: surfaceHead.startOffset }
      : undefined),
    ...(tail.endOffset !== undefined ? { endOffset: tail.endOffset } : undefined),
    partOfSpeech: posHead.partOfSpeech,
    ...(posHead.partOfSpeechDetails
      ? { partOfSpeechDetails: posHead.partOfSpeechDetails }
      : undefined),
    components: parts,
    dictionaryCompound: true,
  };
}

/** Merge the longest exact JMdict matches; unmatched morphology stays untouched. */
export function mergeDictionaryCompounds(
  tokens: Token[],
  entriesByTerm: Record<string, DictionaryEntry[]>,
): Token[] {
  const result: Token[] = [];

  for (let start = 0; start < tokens.length;) {
    const head = tokens[start];
    if (!head || !isCompoundStart(head)) {
      if (head) result.push(head);
      start += 1;
      continue;
    }

    const parts = [head];
    const candidates: Array<{ parts: Token[]; surface: string }> = [];
    for (
      let end = start + 1;
      end < tokens.length && end < start + MAX_COMPOUND_COMPONENTS;
      end += 1
    ) {
      const previous = tokens[end - 1];
      const next = tokens[end];
      if (!previous || !next || !isNominalContinuation(next) || !areAdjacent(previous, next)) break;

      parts.push(next);
      candidates.push({ parts: [...parts], surface: candidateSurface(parts) });
    }

    let compound: Token | null = null;
    let consumed = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const entries = entriesByTerm[candidate.surface] ?? [];
      if (entries.length === 0) continue;

      const lookupToken = makeLookupToken(candidate.parts, candidate.surface);
      const compatibleEntries = entries.filter((entry) =>
        matchingEntryReading(entry, candidate.parts),
      );
      const entry = selectDictionaryEntry(
        compatibleEntries,
        [candidate.surface],
        "orthography",
        lookupToken,
      );
      if (!entry) continue;

      compound = createCompoundToken(candidate.parts, candidate.surface, entry);
      consumed = candidate.parts.length;
      break;
    }

    if (compound) {
      result.push(compound);
      start += consumed;
    } else {
      result.push(head);
      start += 1;
    }
  }

  return result;
}
