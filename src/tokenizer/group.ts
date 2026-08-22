import type { GrammarAnnotation, Token } from "@/core/types";
import {
  tokenCanonicalKey,
  tokenDictionaryForm,
  tokenLookupTerms,
} from "@/core/types";

type TokenMatcher = string | ((token: Token) => boolean);

interface GroupRule {
  matchers: TokenMatcher[];
}

const surface = (expected: string): TokenMatcher => expected;
const isAuxiliary = (token: Token): boolean =>
  token.partOfSpeech.includes("助動詞");
const isExplanatoryN = (token: Token): boolean =>
  token.surface === "ん" &&
  (tokenDictionaryForm(token) === "ん" || token.partOfSpeech.includes("名詞"));
const isCopularNan = (token: Token): boolean =>
  token.surface === "なん" &&
  (tokenDictionaryForm(token) === "だ" || isAuxiliary(token));
const isCopularNa = (token: Token): boolean =>
  token.surface === "な" &&
  (tokenDictionaryForm(token) === "だ" || isAuxiliary(token));

const INFLECTIONAL_SUFFIX_LEMMAS = new Set([
  "れる",
  "られる",
  "せる",
  "させる",
  "す",
  "さす",
]);

const INFLECTIONAL_AUXILIARY_TYPES = new Set([
  "特殊・タ",
  "特殊・ナイ",
  "特殊・タイ",
  "特殊・マス",
  "特殊・デス",
  "特殊・ヌ",
  "助動詞-タ",
  "助動詞-ナイ",
  "助動詞-タイ",
  "助動詞-マス",
  "助動詞-デス",
  "助動詞-ヌ",
]);

const INFLECTIONAL_INVARIABLE_AUXILIARIES = new Set(["ん", "う"]);

function hasPosDetail(token: Token, detail: string): boolean {
  return (
    token.partOfSpeechDetails?.includes(detail) === true ||
    token.partOfSpeech.includes(detail)
  );
}

function isIndependentVerb(token: Token): boolean {
  if (!token.partOfSpeech.includes("動詞")) return false;
  if (hasPosDetail(token, "接尾") || hasPosDetail(token, "非自立") || hasPosDetail(token, "非自立可能")) {
    return false;
  }
  // Some analyzers explicitly mark 自立; UniDic marks ordinary verbs as 一般.
  return hasPosDetail(token, "自立") || hasPosDetail(token, "一般") || token.partOfSpeechDetails == null;
}

function isInflectionalSuffixVerb(token: Token): boolean {
  return (
    token.partOfSpeech.includes("動詞") &&
    (hasPosDetail(token, "接尾") ||
      INFLECTIONAL_SUFFIX_LEMMAS.has(tokenDictionaryForm(token)))
  );
}

function isInflectionalAuxiliary(token: Token): boolean {
  return (
    isAuxiliary(token) &&
    (INFLECTIONAL_AUXILIARY_TYPES.has(token.conjugationType ?? "") ||
      INFLECTIONAL_INVARIABLE_AUXILIARIES.has(tokenDictionaryForm(token)))
  );
}

function inflectedVerbLength(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (!head || !isIndependentVerb(head)) return 0;

  let end = start + 1;
  let candidate = tokens[end];
  while (candidate && isInflectionalSuffixVerb(candidate)) {
    end += 1;
    candidate = tokens[end];
  }
  while (candidate && isInflectionalAuxiliary(candidate)) {
    end += 1;
    candidate = tokens[end];
  }

  return end - start > 1 ? end - start : 0;
}

function hasExplicitLexicalContract(token: Token): boolean {
  return (
    token.dictionaryForm !== undefined ||
    token.canonicalKey !== undefined ||
    token.lookupTerms !== undefined
  );
}

function derivedLexicalFields(base: Token): Partial<Token> {
  if (!hasExplicitLexicalContract(base)) return {};
  return {
    dictionaryForm: tokenDictionaryForm(base),
    canonicalKey: tokenCanonicalKey(base),
    lookupTerms: tokenLookupTerms(base),
  };
}

function createInflectedVerbGroup(tokens: Token[]): Token {
  const verb = tokens[0];
  if (!verb) throw new Error("An inflected verb group requires a lexical verb");
  const behavesAsIAdjective = tokens.some(
    (token) => token.conjugationType === "特殊・タイ" || token.conjugationType === "助動詞-タイ",
  );

  return {
    surface: tokens.map((token) => token.surface).join(""),
    ...derivedLexicalFields(verb),
    lemma: tokenCanonicalKey(verb),
    reading: tokens.map((token) => token.reading).join(""),
    partOfSpeech: behavesAsIAdjective
      ? [...new Set([...verb.partOfSpeech, "形容詞"])]
      : verb.partOfSpeech,
    ...(verb.partOfSpeechDetails
      ? { partOfSpeechDetails: verb.partOfSpeechDetails }
      : undefined),
    components: tokens,
  };
}

const GROUP_RULES: GroupRule[] = [
  { matchers: [surface("じゃ"), surface("なく"), surface("て")] },
  { matchers: [surface("じゃ"), surface("なくっ"), surface("て")] },
  { matchers: [surface("では"), surface("なく"), surface("て")] },
  { matchers: [surface("では"), surface("なくっ"), surface("て")] },
  { matchers: [isExplanatoryN, surface("です")] },
  { matchers: [isExplanatoryN, surface("だ")] },
  { matchers: [isCopularNan, surface("です")] },
  { matchers: [isCopularNan, surface("だ")] },
  { matchers: [isCopularNa, isExplanatoryN, surface("です")] },
  { matchers: [isCopularNa, isExplanatoryN, surface("だ")] },
];

const PLURAL_SUFFIXES = new Map([
  ["ら", "ら"],
  ["等", "ら"],
  ["たち", "たち"],
  ["達", "たち"],
  ["ども", "ども"],
  ["共", "ども"],
  ["がた", "がた"],
  ["方", "がた"],
]);

function isNominalBase(token: Token): boolean {
  return (
    (token.partOfSpeech.includes("名詞") || token.partOfSpeech.includes("代名詞")) &&
    !token.partOfSpeech.includes("接尾辞")
  );
}

function pluralSuffixLabel(token: Token): string | null {
  if (!token.partOfSpeech.includes("接尾辞")) return null;
  return (
    PLURAL_SUFFIXES.get(token.surface) ??
    PLURAL_SUFFIXES.get(tokenDictionaryForm(token)) ??
    PLURAL_SUFFIXES.get(tokenCanonicalKey(token)) ??
    null
  );
}

function createPluralGroup(base: Token, suffix: Token): Token {
  const grammar: GrammarAnnotation = { surface: suffix.surface, kind: "plural-suffix" };
  return {
    surface: `${base.surface}${suffix.surface}`,
    ...derivedLexicalFields(base),
    lemma: tokenCanonicalKey(base),
    reading: `${base.reading}${suffix.reading}`,
    partOfSpeech: base.partOfSpeech,
    ...(base.partOfSpeechDetails
      ? { partOfSpeechDetails: base.partOfSpeechDetails }
      : undefined),
    components: [base, suffix],
    grammar: [grammar],
  };
}

function matchesAt(tokens: Token[], start: number, rule: GroupRule): boolean {
  return rule.matchers.every((matcher, offset) => {
    const token = tokens[start + offset];
    return token != null && (typeof matcher === "string" ? token.surface === matcher : matcher(token));
  });
}

function createGroup(tokens: Token[]): Token {
  const groupedSurface = tokens.map((token) => token.surface).join("");
  return {
    surface: groupedSurface,
    // Grammar expressions do not have a single lexical identity.
    lemma: groupedSurface,
    reading: tokens.map((token) => token.reading).join(""),
    partOfSpeech: [...new Set(tokens.flatMap((token) => token.partOfSpeech))],
    components: tokens,
  };
}

/** Convert morphological tokens into conservative display/interaction units. */
export function groupTokens(tokens: Token[]): Token[] {
  const result: Token[] = [];

  for (let index = 0; index < tokens.length; ) {
    const base = tokens[index];
    const suffix = tokens[index + 1];
    const label = base && suffix && isNominalBase(base) ? pluralSuffixLabel(suffix) : null;
    if (base && suffix && label) {
      result.push(createPluralGroup(base, suffix));
      index += 2;
      continue;
    }

    const verbLength = inflectedVerbLength(tokens, index);
    if (verbLength > 0) {
      result.push(createInflectedVerbGroup(tokens.slice(index, index + verbLength)));
      index += verbLength;
      continue;
    }

    const rule = GROUP_RULES.find((candidate) => matchesAt(tokens, index, candidate));
    if (rule) {
      result.push(createGroup(tokens.slice(index, index + rule.matchers.length)));
      index += rule.matchers.length;
    } else {
      if (base) result.push(base);
      index += 1;
    }
  }

  return result;
}
