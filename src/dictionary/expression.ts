// ---------------------------------------------------------------------------
// Noun + particle + verb expressions (空気を読む) found in subtitle tokens.
// ---------------------------------------------------------------------------
//
// Runs after the nominal compounds, so the noun may itself be a compound.
// The verb keeps its conjugation (空気を読めない), and the を / が that speech
// often drops may be missing (空気読めない). Nothing may come in between.

import {
  tokenCanonicalKey,
  tokenDictionaryForm,
  type DictionaryEntry,
  type GrammarAnnotation,
  type Token,
} from "@/core/types";
import { toHiragana } from "@/core/kana";
import { entryReadings, entrySpellings, lexicalHead } from "./match";

const PARTICLES = new Set(["を", "が", "に", "で", "と", "へ"]);
/** Particles that speech drops before the verb (空気読めない, 腹立つ). */
const OMISSIBLE_PARTICLES = ["を", "が"];
/** A noun before する is a suru verb (勉強する), not an expression missing を. */
const NO_OMISSION_VERBS = new Set(["する", "為る"]);

/** Potential verbs (読める) as UniDic lemmas: their godan base (読む). */
const POTENTIAL_TO_GODAN = new Map([
  ["え", "う"],
  ["け", "く"],
  ["げ", "ぐ"],
  ["せ", "す"],
  ["て", "つ"],
  ["ね", "ぬ"],
  ["べ", "ぶ"],
  ["め", "む"],
  ["れ", "る"],
]);

const isKana = (text: string): boolean => /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(text);
const normalizeReading = (text: string): string => toHiragana(text.normalize("NFKC"));
const plain = (text: string): string => text.replace(/\n/gu, "");

function isExpressionNoun(token: Token): boolean {
  return (
    (token.partOfSpeech.includes("名詞") || token.partOfSpeech.includes("代名詞")) &&
    !token.partOfSpeech.includes("接尾辞") &&
    !token.grammarOnly &&
    !token.grammar?.length
  );
}

function isExpressionParticle(token: Token): boolean {
  return token.partOfSpeech.includes("助詞") && PARTICLES.has(token.surface);
}

function isExpressionVerb(token: Token): boolean {
  return token.partOfSpeech.includes("動詞") && !token.grammarOnly;
}

function areAdjacent(left: Token, right: Token): boolean {
  return left.endOffset !== undefined && right.startOffset === left.endOffset;
}

function potentialBase(form: string): string | null {
  const chars = Array.from(form);
  const ending = chars[chars.length - 2];
  const godan = ending ? POTENTIAL_TO_GODAN.get(ending) : undefined;
  return chars[chars.length - 1] === "る" && godan ? `${chars.slice(0, -2).join("")}${godan}` : null;
}

interface VerbBase {
  form: string;
  reading: string;
}

/** Dictionary forms the verb may take inside an expression, exact ones first. */
function verbBases(verb: Token): VerbBase[] {
  const head = verb.components?.[0] ?? verb;
  const reading = normalizeReading(lexicalHead(verb).dictionaryReading ?? verb.dictionaryReading ?? "");
  const forms = [...new Set([tokenDictionaryForm(verb), tokenCanonicalKey(verb)].filter(Boolean))];
  const bases: VerbBase[] = forms.map((form) => ({ form, reading }));
  if (head.conjugationType?.includes("下一段")) {
    const potentialReading = potentialBase(reading) ?? "";
    for (const form of forms) {
      const base = potentialBase(form);
      if (base) bases.push({ form: base, reading: potentialReading });
    }
  }
  return bases;
}

interface ExpressionCandidate {
  noun: Token;
  particle: Token | null;
  /** The particle written in the dictionary spelling, even when omitted. */
  particleText: string;
  verb: Token;
  verbBase: VerbBase;
  spelling: string;
  reading: string;
}

/** Candidates starting at `start`, in order of preference. */
function candidatesAt(tokens: Token[], start: number): ExpressionCandidate[] {
  const noun = tokens[start];
  const next = tokens[start + 1];
  if (!noun || !next || !isExpressionNoun(noun) || !areAdjacent(noun, next)) return [];

  const nounSurface = plain(noun.surface);
  const nounReading = normalizeReading(noun.reading);
  const build = (particle: Token | null, particleText: string, verb: Token): ExpressionCandidate[] =>
    verbBases(verb).map((verbBase) => ({
      noun,
      particle,
      particleText,
      verb,
      verbBase,
      spelling: `${nounSurface}${particleText}${verbBase.form}`,
      reading: nounReading && verbBase.reading ? `${nounReading}${particleText}${verbBase.reading}` : "",
    }));

  const verb = tokens[start + 2];
  if (isExpressionParticle(next) && verb && isExpressionVerb(verb) && areAdjacent(next, verb)) {
    return build(next, next.surface, verb);
  }
  // A kana noun only meets its entry by reading: without the particle as well,
  // too little is checked (ことあるごとに is not 事がある).
  if (
    isExpressionVerb(next) &&
    !NO_OMISSION_VERBS.has(tokenDictionaryForm(next)) &&
    !isKana(nounSurface)
  ) {
    return OMISSIBLE_PARTICLES.flatMap((particle) => build(null, particle, next));
  }
  return [];
}

function candidateTerms(candidate: ExpressionCandidate): string[] {
  // A noun written in kana (こと) can only meet a kanji headword (事がある) by reading.
  return isKana(plain(candidate.noun.surface)) && candidate.reading
    ? [candidate.spelling, candidate.reading]
    : [candidate.spelling];
}

/** Terms to look up in the bundled expression list, batched per cue. */
export function dictionaryExpressionLookupTerms(tokens: Token[]): string[] {
  const terms = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (const candidate of candidatesAt(tokens, start)) {
      for (const term of candidateTerms(candidate)) terms.add(term);
    }
  }
  return [...terms];
}

function matchingReading(entry: DictionaryEntry, candidate: ExpressionCandidate): string | null {
  return (
    entryReadings(entry).find((reading) => normalizeReading(reading) === candidate.reading) ?? null
  );
}

function matchingEntry(
  candidate: ExpressionCandidate,
  entriesByTerm: Record<string, DictionaryEntry[]>,
): DictionaryEntry | null {
  const bySpelling = (entriesByTerm[candidate.spelling] ?? []).filter(
    (entry) =>
      entrySpellings(entry).includes(candidate.spelling) &&
      // The reading tells 手 (て) from 手 (しゅ) when UniDic gives one.
      (!candidate.reading || matchingReading(entry, candidate) !== null),
  );
  const spelled = bySpelling.find((entry) => entry.common) ?? bySpelling[0];
  if (spelled) return spelled;
  if (!isKana(plain(candidate.noun.surface)) || !candidate.reading) return null;
  const byReading = (entriesByTerm[candidate.reading] ?? []).filter(
    (entry) => matchingReading(entry, candidate) !== null,
  );
  return byReading.find((entry) => entry.common) ?? byReading[0] ?? null;
}

/** No « potentiel » label: UniDic also files misparsed forms (席に着け) under
 * 下一段 lemmas, so the godan fallback does not prove a potential verb. */
function expressionGrammar(candidate: ExpressionCandidate): GrammarAnnotation[] {
  const { particle, particleText, verb } = candidate;
  return [
    ...(particle
      ? []
      : [{ surface: particleText, kind: "other" as const, label: "particule omise (oral)" }]),
    ...(verb.grammar ?? []),
  ];
}

function createExpressionToken(candidate: ExpressionCandidate, entry: DictionaryEntry): Token {
  const { noun, particle, verb } = candidate;
  const parts = particle ? [noun, particle, verb] : [noun, verb];
  const dictionaryReading = toHiragana(matchingReading(entry, candidate) ?? entry.reading);
  const dictionaryForm = entrySpellings(entry).includes(candidate.spelling)
    ? candidate.spelling
    : entry.headword;
  const verbSegments =
    verb.segments ?? verb.components?.map((component) => component.surface) ?? [verb.surface];

  return {
    surface: parts.map((part) => part.surface).join(""),
    dictionaryForm,
    canonicalKey: entry.headword,
    lookupTerms: [...new Set([dictionaryForm, entry.headword, ...entrySpellings(entry)])],
    lemma: entry.headword,
    reading: parts.map((part) => part.reading).join(""),
    dictionaryReading,
    ...(noun.startOffset !== undefined ? { startOffset: noun.startOffset } : undefined),
    ...(verb.endOffset !== undefined ? { endOffset: verb.endOffset } : undefined),
    partOfSpeech: verb.partOfSpeech,
    ...(verb.partOfSpeechDetails ? { partOfSpeechDetails: verb.partOfSpeechDetails } : undefined),
    components: parts.flatMap((part) => part.components ?? [part]),
    segments: [noun.surface, ...(particle ? [particle.surface] : []), ...verbSegments],
    grammar: expressionGrammar(candidate),
    dictionaryCompound: true,
  };
}

/** Merge each expression found in the bundled list into one unit. */
export function mergeDictionaryExpressions(
  tokens: Token[],
  entriesByTerm: Record<string, DictionaryEntry[]>,
): Token[] {
  const result: Token[] = [];
  for (let start = 0; start < tokens.length;) {
    let merged: { token: Token; length: number } | null = null;
    for (const candidate of candidatesAt(tokens, start)) {
      const entry = matchingEntry(candidate, entriesByTerm);
      if (!entry) continue;
      merged = { token: createExpressionToken(candidate, entry), length: candidate.particle ? 3 : 2 };
      break;
    }
    if (merged) {
      result.push(merged.token);
      start += merged.length;
    } else {
      const token = tokens[start];
      if (token) result.push(token);
      start += 1;
    }
  }
  return result;
}
