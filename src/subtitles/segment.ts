// ---------------------------------------------------------------------------
// SubJap — Linguistic segmentation and legacy presentation chunks
// ---------------------------------------------------------------------------
//
// Analysis uses linguistic boundaries and preserves original source positions.
// Presentation chunking remains a separate API for existing callers.

export interface TokenizationSegment {
  text: string;
  startOffset: number;
}

/**
 * Linguistic boundaries for production analysis. Keep every separator, do not
 * cut at ellipses or at an arbitrary length, and keep visual line wraps inside
 * the same sentence. Blank lines and explicit speaker markers remain barriers.
 * The legacy splitIntoSentences helper below is for presentation-sized chunks.
 */
export function segmentForTokenization(text: string): TokenizationSegment[] {
  const segments: TokenizationSegment[] = [];
  const boundaries = /[。！？!?]+[」』）)〉》’"”]*|\n{2,}|\n(?=[（(「『―—–-])/gu;
  let startOffset = 0;
  for (const match of text.matchAll(boundaries)) {
    const end = match.index + match[0].length;
    segments.push({ text: text.slice(startOffset, end), startOffset });
    startOffset = end;
  }
  if (startOffset < text.length) segments.push({ text: text.slice(startOffset), startOffset });
  return segments;
}

// Sentence boundaries: 。！？!?… optionally followed by closing brackets
// 」』）)〉》』』’"” (kept in sync with the regex in splitLine).

/**
 * Split a subtitle line into sentence chunks at punctuation boundaries.
 * `。！？!?…` end a sentence; any immediately following closing brackets are
 * kept attached to that sentence.
 */
function splitLine(line: string): string[] {
  const marked = line.replace(/[。！？!?…]+[」』）)〉》』』’"”]*/g, (m) => m + "\u0000");
  return marked.split("\u0000");
}

/**
 * Split an over-long chunk at the nearest break character (whitespace or
 * Japanese comma) within `maxLen`, falling back to a hard character cut.
 */
function splitLongChunk(chunk: string, maxLen: number): string[] {
  const BREAK_CHARS = [" ", "　", ",", "、", "・", "，"];
  const out: string[] = [];
  let rest = chunk;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen + 1);
    let cut = -1;
    for (let i = maxLen; i > 0; i--) {
      if (BREAK_CHARS.includes(window[i] ?? "")) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) cut = maxLen;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Split a normalized cue text into sentence-sized chunks suitable for
 * tokenization. Newlines are hard boundaries; sentence-final punctuation
 * (`。！？!?…`) creates soft boundaries; chunks longer than `maxLen`
 * characters are split further at the nearest break character.
 */
export function splitIntoSentences(text: string, maxLen = 80): string[] {
  const normalized = text.replace(/\n+/g, "\n").trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  for (const line of normalized.split("\n")) {
    const chunks = splitLine(line);
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      if (trimmed.length <= maxLen) {
        sentences.push(trimmed);
      } else {
        sentences.push(...splitLongChunk(trimmed, maxLen));
      }
    }
  }
  return sentences;
}
