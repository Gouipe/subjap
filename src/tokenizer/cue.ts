import type { Token, Tokenizer } from "@/core/types";
import { segmentForTokenization } from "@/subtitles/segment";
import { groupTokens } from "./group";

function separator(surface: string, startOffset: number): Token {
  return {
    surface,
    lemma: surface,
    reading: "",
    partOfSpeech: ["空白"],
    startOffset,
    endOffset: startOffset + surface.length,
  };
}

/** Analyze across visual newlines, then restore exact normalized cue text. */
export function tokenizeCue(text: string, tokenizer: Tokenizer): Token[] {
  const result: Token[] = [];
  for (const segment of segmentForTokenization(text)) {
    const positions: number[] = [];
    let analysis = "";
    for (let offset = 0; offset < segment.text.length; offset += 1) {
      const char = segment.text[offset]!;
      if (char === "\n") continue;
      positions.push(segment.startOffset + offset);
      analysis += char;
    }

    // Never mutate the tokenizer's cached morphological objects.
    const restore = (token: Token, analysisStart: number): Token => {
      const startOffset = positions[analysisStart]!;
      const endOffset = positions[analysisStart + token.surface.length - 1]! + 1;
      let componentStart = analysisStart;
      const components = token.components?.map((component) => {
        const restored = restore(component, componentStart);
        componentStart += component.surface.length;
        return restored;
      });
      return {
        ...token,
        surface: text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        ...(components ? { components } : {}),
      };
    };

    let analysisStart = 0;
    let sourceCursor = segment.startOffset;
    for (const token of analysis ? groupTokens(tokenizer.tokenize(analysis)) : []) {
      const restored = restore(token, analysisStart);
      if (restored.startOffset! > sourceCursor) {
        result.push(separator(text.slice(sourceCursor, restored.startOffset), sourceCursor));
      }
      result.push(restored);
      analysisStart += token.surface.length;
      sourceCursor = restored.endOffset!;
    }
    const segmentEnd = segment.startOffset + segment.text.length;
    if (sourceCursor < segmentEnd) {
      result.push(separator(text.slice(sourceCursor, segmentEnd), sourceCursor));
    }
  }
  return result;
}
