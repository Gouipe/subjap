/** Convert full-width katakana readings (as returned by kuromoji) to hiragana. */
export function toHiragana(text: string): string {
  return Array.from(text, (char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return char;
    return codePoint >= 0x30a1 && codePoint <= 0x30f6
      ? String.fromCodePoint(codePoint - 0x60)
      : char;
  }).join("");
}
