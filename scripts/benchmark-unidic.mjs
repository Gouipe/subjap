import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("lindera-wasm-web-unidic/package.json"));
const moduleUrl = pathToFileURL(join(packageRoot, "lindera_wasm.js"));
const wasmPath = join(packageRoot, "lindera_wasm_bg.wasm");
const inputPath = process.argv[2] ?? "benchmarks/unidic-corpus.synthetic.json";
const corpus = JSON.parse(await readFile(inputPath, "utf8"));

const { initSync, TokenizerBuilder, getVersion } = await import(moduleUrl);
initSync({ module: await readFile(wasmPath) });
const builder = new TokenizerBuilder();
builder.setDictionary("embedded://unidic");
builder.setMode("normal");
builder.setKeepWhitespace(true);
const tokenizer = builder.build();

const result = {
  engine: "lindera-wasm-web-unidic",
  version: getVersion(),
  dictionary: "embedded://unidic",
  sentences: corpus.map((sentence) => ({
    sentence,
    tokens: tokenizer.tokenize(sentence).map((token) => ({
      surface: token.surface,
      dictionaryForm: token.orthographicBaseForm,
      lexeme: token.lexeme,
      reading: token.reading,
      partOfSpeech: token.partOfSpeech,
      conjugationType: token.conjugationType,
      conjugationForm: token.conjugationForm,
    })),
  })),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
