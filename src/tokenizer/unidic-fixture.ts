// Test fixture shared by the tokenizer unit tests.
import type { RawLinderaToken } from "./convert";

/** A UniDic token as Lindera returns it, unset features as "*". */
export function unidic(fields: Partial<RawLinderaToken>): RawLinderaToken {
  return {
    surface: "",
    byteStart: 0,
    byteEnd: 0,
    lexeme: "*",
    orthographicBaseForm: "*",
    orthographicSurfaceForm: "*",
    phonologicalBaseForm: "*",
    phonologicalSurfaceForm: "*",
    reading: "*",
    partOfSpeech: "*",
    partOfSpeechSubcategory1: "*",
    partOfSpeechSubcategory2: "*",
    partOfSpeechSubcategory3: "*",
    conjugationType: "*",
    conjugationForm: "*",
    ...fields,
  };
}
