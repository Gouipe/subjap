import type { Token } from "@/core/types";

type TokenMatcher = string | ((token: Token) => boolean);

interface GroupRule {
  matchers: TokenMatcher[];
}

const surface = (expected: string): TokenMatcher => expected;
const isAuxiliary = (token: Token): boolean =>
  token.partOfSpeech.includes("助動詞");
const isExplanatoryN = (token: Token): boolean =>
  token.surface === "ん" &&
  (token.lemma === "ん" || token.partOfSpeech.includes("名詞"));
const isCopularNan = (token: Token): boolean =>
  token.surface === "なん" &&
  (token.lemma === "だ" || isAuxiliary(token));
const isCopularNa = (token: Token): boolean =>
  token.surface === "な" &&
  (token.lemma === "だ" || isAuxiliary(token));

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
]);

const INFLECTIONAL_INVARIABLE_AUXILIARIES = new Set(["ん", "う"]);

function hasPosDetail(token: Token, detail: string): boolean {
  return (
    token.partOfSpeechDetails?.includes(detail) === true ||
    token.partOfSpeech.includes(detail)
  );
}

function isIndependentVerb(token: Token): boolean {
  return token.partOfSpeech.includes("動詞") && hasPosDetail(token, "自立");
}

function isInflectionalSuffixVerb(token: Token): boolean {
  return (
    token.partOfSpeech.includes("動詞") &&
    hasPosDetail(token, "接尾") &&
    INFLECTIONAL_SUFFIX_LEMMAS.has(token.lemma)
  );
}

function isInflectionalAuxiliary(token: Token): boolean {
  return (
    isAuxiliary(token) &&
    (INFLECTIONAL_AUXILIARY_TYPES.has(token.conjugationType ?? "") ||
      INFLECTIONAL_INVARIABLE_AUXILIARIES.has(token.lemma))
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

function createInflectedVerbGroup(tokens: Token[]): Token {
  const verb = tokens[0];
  if (!verb) throw new Error("An inflected verb group requires a lexical verb");
  const behavesAsIAdjective = tokens.some(
    (token) => token.conjugationType === "特殊・タイ",
  );

  return {
    surface: tokens.map((token) => token.surface).join(""),
    lemma: verb.lemma,
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

/**
 * Conservative first set of Japanese pedagogical units.
 *
 * Kuromoji's morphological boundaries remain available in `components`;
 * this layer only changes the unit exposed to the overlay and popover.
 */
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

function matchesAt(tokens: Token[], start: number, rule: GroupRule): boolean {
  return rule.matchers.every(
    (matcher, offset) => {
      const token = tokens[start + offset];
      return (
        token != null &&
        (typeof matcher === "string" ? token.surface === matcher : matcher(token))
      );
    },
  );
}

function createGroup(tokens: Token[]): Token {
  const surface = tokens.map((token) => token.surface).join("");
  return {
    surface,
    // A grouped grammar unit has no single dictionary lemma yet. Its surface
    // is a stable pedagogical key until grammar entries are introduced.
    lemma: surface,
    reading: tokens.map((token) => token.reading).join(""),
    partOfSpeech: [...new Set(tokens.flatMap((token) => token.partOfSpeech))],
    components: tokens,
  };
}

/** Convert morphological tokens into conservative display/interaction units. */
export function groupTokens(tokens: Token[]): Token[] {
  const result: Token[] = [];

  for (let index = 0; index < tokens.length; ) {
    const verbLength = inflectedVerbLength(tokens, index);
    if (verbLength > 0) {
      const components = tokens.slice(index, index + verbLength);
      result.push(createInflectedVerbGroup(components));
      index += verbLength;
      continue;
    }

    const rule = GROUP_RULES.find((candidate) =>
      matchesAt(tokens, index, candidate),
    );

    if (rule) {
      const components = tokens.slice(index, index + rule.matchers.length);
      result.push(createGroup(components));
      index += rule.matchers.length;
    } else {
      const token = tokens[index];
      if (token) result.push(token);
      index += 1;
    }
  }

  return result;
}
