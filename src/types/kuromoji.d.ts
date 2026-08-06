// Type declarations for kuromoji.js (v0.1.2) — the library ships without types.

interface KuromojiToken {
  surface_form: string;
  basic_form: string;
  reading: string | undefined;
  pos: string;
  word_type: string;
  word_position: number;
}

declare module "kuromoji" {
  interface KuromojiTokenizer {
    tokenize(text: string): KuromojiToken[];
  }

  interface BuilderOptions {
    dicPath: string;
  }

  interface Builder {
    build(cb: (err: Error | null, tokenizer: KuromojiTokenizer) => void): void;
  }

  function builder(options: BuilderOptions): Builder;

  export default { builder };
}

// Deep imports used by the custom fetch()-based dictionary loader in
// src/tokenizer/index.ts (kuromoji.builder() hardcodes an XMLHttpRequest
// loader that can stall silently in content scripts).
declare module "kuromoji/src/loader/DictionaryLoader" {
  class DictionaryLoader {
    constructor(dicPath: string);
    loadArrayBuffer(
      url: string,
      callback: (err: Error | null, buffer?: ArrayBuffer) => void,
    ): void;
    load(callback: (err: Error | null, dic?: unknown) => void): void;
  }
  export = DictionaryLoader;
}

declare module "kuromoji/src/Tokenizer" {
  class Tokenizer {
    constructor(dic: unknown);
    tokenize(text: string): KuromojiToken[];
  }
  export = Tokenizer;
}
