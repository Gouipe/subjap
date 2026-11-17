// @vitest-environment node
// ---------------------------------------------------------------------------
// Subtitle segmentation over real UniDic and the bundled expression list.
// ---------------------------------------------------------------------------
//
// Each line of segmentation-corpus.txt is a subtitle and the clickable units
// SubJap must show for it. Nominal compounds are not merged here: they need
// an installed JMdict pack.

import { initSync, TokenizerBuilder } from "lindera-wasm-web-unidic";
import { describe, expect, it } from "vitest";
import { tokenCanonicalKey, type DictionaryEntry, type Token, type Tokenizer } from "@/core/types";
import {
  dictionaryExpressionLookupTerms,
  mergeDictionaryExpressions,
} from "@/dictionary/expression";
import { buildExpressionIndex, findExpressions } from "@/dictionary/expression-list";
import { assertLinderaSurfaceCoverage, toLinderaToken, type RawLinderaToken } from "./convert";
import { tokenizeCue } from "./cue";
import corpus from "./segmentation-corpus.txt?raw";
import expressionList from "../../public/expressions/jmdict-expressions.json?raw";

// The project has no Node typings: only the WASM file is read from disk.
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const { readFileSync } = (await nodeModule("node:fs")) as {
  readFileSync: (path: string) => Uint8Array;
};
const { createRequire } = (await nodeModule("node:module")) as {
  createRequire: (url: string) => { resolve: (id: string) => string };
};

function createNodeTokenizer(): Tokenizer {
  const wasmPath = createRequire(import.meta.url).resolve(
    "lindera-wasm-web-unidic/lindera_wasm_bg.wasm",
  );
  initSync({ module: readFileSync(wasmPath) });
  const builder = new TokenizerBuilder();
  builder.setDictionary("embedded://unidic");
  builder.setMode("normal");
  builder.setKeepWhitespace(true);
  const engine = builder.build();
  return {
    tokenize(sentence: string): Token[] {
      const raw = engine.tokenize(sentence) as RawLinderaToken[];
      assertLinderaSurfaceCoverage(sentence, raw);
      return raw.map(toLinderaToken);
    },
  };
}

const tokenizer = createNodeTokenizer();
const { entries } = JSON.parse(expressionList) as { entries: DictionaryEntry[] };
const expressionIndex = buildExpressionIndex(entries);

/** The cue as the content script tokenizes it, nominal compounds aside. */
function segment(text: string): Token[] {
  const tokens = tokenizeCue(text, tokenizer);
  const terms = dictionaryExpressionLookupTerms(tokens);
  return mergeDictionaryExpressions(tokens, findExpressions(expressionIndex, terms)).filter(
    (token) => !token.partOfSpeech.includes("空白"),
  );
}

interface Case {
  line: number;
  text: string;
  expected: string;
}

/** `subtitle → unit|unit=identity|…`; `#` starts a comment. */
function readCorpus(): Case[] {
  const cases: Case[] = [];
  corpus.split(/\r?\n/u).forEach((raw, index) => {
    const content = raw.replace(/\s+#.*$/u, "").trim();
    if (!content || content.startsWith("#")) return;
    const [text, expected] = content.split(/\s*→\s*/u);
    if (!text || !expected) throw new Error(`segmentation-corpus.txt:${index + 1}: no « → »`);
    cases.push({ line: index + 1, text, expected });
  });
  return cases;
}

describe("subtitle segmentation", () => {
  it.each(readCorpus())("$text (line $line)", ({ text, expected }) => {
    const wanted = expected.split("|");
    // An identity is checked only where the corpus gives one.
    const shown = segment(text)
      .map((token, index) =>
        wanted[index]?.includes("=")
          ? `${token.surface}=${tokenCanonicalKey(token)}`
          : token.surface,
      )
      .join("|");
    expect(shown).toBe(expected);
  });
});
