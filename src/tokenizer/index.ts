import initLindera, { TokenizerBuilder } from "lindera-wasm-web-unidic";
import type { Token, Tokenizer } from "@/core/types";
import { LRUCache } from "./lru-cache";
import {
  assertLinderaSurfaceCoverage,
  toLinderaToken,
  type RawLinderaToken,
} from "./convert";

const TOKENIZER_CACHE_SIZE = 500;
const WASM_LOAD_TIMEOUT_MS = 30_000;

interface LinderaTokenizerInstance {
  tokenize(text: string): unknown;
}

let instancePromise: Promise<LinderaTokenizerInstance> | null = null;
let cache: LRUCache<string, Token[]> | null = null;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${WASM_LOAD_TIMEOUT_MS}ms`)),
      WASM_LOAD_TIMEOUT_MS,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function ensureCache(): LRUCache<string, Token[]> {
  if (!cache) cache = new LRUCache<string, Token[]>(TOKENIZER_CACHE_SIZE);
  return cache;
}

function isRawLinderaToken(value: unknown): value is RawLinderaToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<RawLinderaToken>;
  return (
    typeof token.surface === "string" &&
    typeof token.byteStart === "number" &&
    typeof token.byteEnd === "number" &&
    typeof token.partOfSpeech === "string"
  );
}

async function loadLinderaTokenizer(): Promise<LinderaTokenizerInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      console.log("[SubJap] tokenizer: loading Lindera UniDic 2.0.0");
      await withTimeout(initLindera(), "Lindera UniDic WASM load");
      const builder = new TokenizerBuilder();
      builder.setDictionary("embedded://unidic");
      builder.setMode("normal");
      builder.setKeepWhitespace(true);
      const tokenizer = builder.build();
      console.log("[SubJap] tokenizer: Lindera UniDic ready");
      return tokenizer;
    })().catch((error: unknown) => {
      instancePromise = null;
      const cause = error instanceof Error ? error : new Error(String(error));
      console.error("[SubJap] tokenizer: Lindera UniDic failed:", cause);
      throw new Error(`Impossible de charger UniDic: ${cause.message}`, { cause });
    });
  }
  return instancePromise;
}

function convertTokens(sentence: string, rawValue: unknown): Token[] {
  if (!Array.isArray(rawValue) || !rawValue.every(isRawLinderaToken)) {
    throw new Error("Lindera UniDic returned an invalid token array");
  }
  const rawTokens = rawValue as RawLinderaToken[];
  assertLinderaSurfaceCoverage(sentence, rawTokens);
  return rawTokens.map(toLinderaToken);
}

/** Create the singleton production tokenizer backed by embedded UniDic. */
export async function createTokenizer(): Promise<Tokenizer> {
  const engine = await loadLinderaTokenizer();
  const sentenceCache = ensureCache();
  return {
    tokenize(sentence: string): Token[] {
      const cached = sentenceCache.get(sentence);
      if (cached) return cached;
      const tokens = convertTokens(sentence, engine.tokenize(sentence));
      sentenceCache.set(sentence, tokens);
      return tokens;
    },
  };
}

/** Clear only the sentence cache; the WASM singleton remains warm. */
export function clearTokenizerCache(): void {
  cache = null;
}
