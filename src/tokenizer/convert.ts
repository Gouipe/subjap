import type { Token } from "@/core/types";
import { toHiragana } from "@/core/kana";

/** Raw token shape emitted by kuromoji. */
export interface RawKuromojiToken {
  surface_form: string;
  basic_form: string;
  reading: string | undefined;
  pos: string;
  pos_detail_1?: string;
  pos_detail_2?: string;
  pos_detail_3?: string;
  word_type: string;
  word_position: number;
  conjugated_type?: string;
  conjugated_form?: string;
}

/** Convert Kuromoji's token shape into the shared SubJap representation. */
export function toToken(kt: RawKuromojiToken): Token {
  const inlinePosDetails = kt.pos.split(",").slice(1);
  const partOfSpeechDetails = [
    kt.pos_detail_1,
    kt.pos_detail_2,
    kt.pos_detail_3,
    ...inlinePosDetails,
  ].filter((detail): detail is string => Boolean(detail && detail !== "*"));

  return {
    surface: kt.surface_form,
    lemma: kt.basic_form === "*" ? kt.surface_form : kt.basic_form,
    reading: toHiragana(kt.reading ?? kt.surface_form),
    partOfSpeech: kt.pos.split(",").filter(Boolean),
    ...(partOfSpeechDetails.length > 0
      ? { partOfSpeechDetails: [...new Set(partOfSpeechDetails)] }
      : undefined),
    ...(kt.conjugated_type
      ? { conjugationType: kt.conjugated_type }
      : undefined),
    ...(kt.conjugated_form
      ? { conjugationForm: kt.conjugated_form }
      : undefined),
  };
}
