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
