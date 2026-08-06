// ---------------------------------------------------------------------------
// Kuromoji tokenizer adapter — implements the shared Tokenizer interface.
//
// kuromoji.builder() loads its dictionary through a hardcoded XMLHttpRequest
// loader that can stall silently in extension content scripts (the build
// callback never fires and no error surfaces — observed on Netflix). We
// therefore bypass the builder and drive kuromoji's DictionaryLoader with our
// own fetch()-based loadArrayBuffer: explicit per-file errors, a hard timeout,
// and progress logs.
// ---------------------------------------------------------------------------

import DictionaryLoader from "kuromoji/src/loader/DictionaryLoader";
import KuromojiTokenizerClass from "kuromoji/src/Tokenizer";
import type { Token, Tokenizer } from "@/core/types";
import { LRUCache } from "./lru-cache";

/** Raw token shape emitted by kuromoji. */
interface KuromojiToken {
  surface_form: string;
  basic_form: string;
  reading: string | undefined;
  pos: string; // comma-separated like "助詞,格助詞,一般"
  word_type: string;
  word_position: number;
}

/** The built tokenizer object (kuromoji's Tokenizer class). */
interface KuromojiTokenizerInstance {
  tokenize(text: string): KuromojiToken[];
}

// ── Singleton state ──────────────────────────────────────────────────────

const TOKENIZER_CACHE_SIZE = 500;
const DICT_FILE_TIMEOUT_MS = 20000;

let instancePromise: Promise<KuromojiTokenizerInstance> | null = null;
let cache: LRUCache<string, Token[]> | null = null;

// ── Fetch-based dictionary loader ─────────────────────────────────────────

/**
 * Fetch + decompress one gzip'd kuromoji dictionary file. Uses the native
 * DecompressionStream (Chrome 80+) instead of zlibjs; rejects with a clear
 * error (and a hard timeout) instead of hanging silently.
 */
async function fetchDictFile(url: string): Promise<ArrayBuffer> {
  const name = url.split("/").pop() ?? url;
  console.log(`[SubJap] tokenizer: fetch ${name}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DICT_FILE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    const compressed = await res.arrayBuffer();
    const decompressed = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    console.log(
      `[SubJap] tokenizer: ${name} ok (${(decompressed.byteLength / 1024).toFixed(0)} KiB)`,
    );
    return decompressed;
  } catch (err) {
    console.error(`[SubJap] tokenizer: ${name} failed:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** DictionaryLoader whose loadArrayBuffer uses fetch() instead of XHR. */
class FetchDictionaryLoader extends DictionaryLoader {
  override loadArrayBuffer(
    url: string,
    callback: (err: Error | null, buffer?: ArrayBuffer) => void,
  ): void {
    fetchDictFile(url)
      .then((buffer) => callback(null, buffer))
      .catch((err: unknown) => {
        callback(
          err instanceof Error ? err : new Error(String(err)),
          undefined,
        );
      });
  }
}

/** Build the kuromoji tokenizer with our own dictionary loader. */
function buildKuromojiTokenizer(
  dicPath: string,
  callback: (
    err: Error | null,
    tokenizer: KuromojiTokenizerInstance | null,
  ) => void,
): void {
  console.log(`[SubJap] tokenizer: start (${dicPath})`);
  const loader = new FetchDictionaryLoader(dicPath);
  loader.load((err, dic) => {
    if (err || !dic) {
      callback(err ?? new Error("kuromoji dictionary load failed"), null);
      return;
    }
    callback(null, new KuromojiTokenizerClass(dic));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ensureCache(): LRUCache<string, Token[]> {
  if (!cache) {
    cache = new LRUCache<string, Token[]>(TOKENIZER_CACHE_SIZE);
  }
  return cache;
}

/** Convert a single kuromoji token into our shared Token shape. */
function toToken(kt: KuromojiToken): Token {
  return {
    surface: kt.surface_form,
    lemma: kt.basic_form === "*" ? kt.surface_form : kt.basic_form,
    reading: kt.reading ?? kt.surface_form,
    partOfSpeech: kt.pos.split(",").filter(Boolean),
  };
}

/** Lazily build the kuromoji tokenizer (called only once). */
function loadKuromojiTokenizer(): Promise<KuromojiTokenizerInstance> {
  if (!instancePromise) {
    instancePromise = new Promise<KuromojiTokenizerInstance>(
      (resolve, reject) => {
        // In the extension the dictionary files are served from the extension
        // origin (dist/dict, exposed via web_accessible_resources). In tests
        // (Node/jsdom, no `chrome` global) fall back to a plain path.
        const dicPath =
          typeof chrome !== "undefined" &&
          typeof chrome.runtime?.getURL === "function"
            ? chrome.runtime.getURL("dict/")
            : "/dict/";

        buildKuromojiTokenizer(dicPath, (err, tokenizer) => {
          if (err || !tokenizer) {
            reject(err ?? new Error("kuromoji build failed"));
          } else {
            console.log("[SubJap] tokenizer: ready");
            resolve(tokenizer);
          }
        });
      },
    );
  }
  return instancePromise;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create (or reuse) the singleton kuromoji-backed `Tokenizer`.
 *
 * The underlying kuromoji instance is lazily initialised on first call and
 * then reused across all subsequent calls.  A 500-entry LRU cache avoids
 * re-tokenising sentences that repeat across subtitle cues.
 */
export async function createTokenizer(): Promise<Tokenizer> {
  const kt = await loadKuromojiTokenizer();
  const c = ensureCache();

  const tokenize = (sentence: string): Token[] => {
    // Fast path: exact cache hit.
    const cached = c.get(sentence);
    if (cached) return cached;

    const raw = kt.tokenize(sentence);
    const tokens: Token[] = raw.map(toToken);
    c.set(sentence, tokens);
    return tokens;
  };

  return { tokenize };
}
