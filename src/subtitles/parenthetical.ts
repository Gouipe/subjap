import type { Token } from "@/core/types";

const OPENING_PARENTHESES = new Set(["(", "（"]);
const CLOSING_PARENTHESES = new Set([")", "）"]);

/**
 * Return one flag per token for complete parenthetical expressions.
 *
 * Unmatched delimiters are left untouched. Nested and mixed ASCII/full-width
 * parentheses are supported because subtitle providers are not consistent in
 * which width they emit.
 */
export function markParentheticalTokens(
  tokens: Pick<Token, "surface">[],
): boolean[] {
  const marked = tokens.map(() => false);
  const openingIndexes: number[] = [];

  tokens.forEach((token, index) => {
    if (OPENING_PARENTHESES.has(token.surface)) {
      openingIndexes.push(index);
      return;
    }

    if (!CLOSING_PARENTHESES.has(token.surface)) return;

    const openingIndex = openingIndexes.pop();
    if (openingIndex == null) return;

    for (let markedIndex = openingIndex; markedIndex <= index; markedIndex += 1) {
      marked[markedIndex] = true;
    }
  });

  return marked;
}
