/** Convert full-width katakana readings (as returned by UniDic) to hiragana. */
export function toHiragana(text: string): string {
  return Array.from(text, (char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return char;
    return codePoint >= 0x30a1 && codePoint <= 0x30f6
      ? String.fromCodePoint(codePoint - 0x60)
      : char;
  }).join("");
}

/** Return whether a token contains script that benefits from a furigana hint. */
export function containsKanjiOrKatakana(text: string): boolean {
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u30A0-\u30FF\uFF66-\uFF9F]/u.test(
    text,
  );
}
