// ---------------------------------------------------------------------------
// SubJap — Subtitle text normalization
// ---------------------------------------------------------------------------
//
// Subtitle tracks (VTTCue.text, SRT, ASS) carry markup that must be stripped
// before tokenization: HTML-ish tags (<i>, <c.yellow>…), ASS override blocks
// ({\i1}…), ASS line breaks (\N, \n) and HTML entities (&amp;…).

// ── Entity decoding ────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rarr;": "→",
  "&larr;": "←",
};

/** Decode common HTML entities (named + numeric decimal/hex). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => {
      const cp = Number(n);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    })
    .replace(/&[a-zA-Z#0-9]+;/g, (entity) => NAMED_ENTITIES[entity] ?? entity);
}

/** Remove HTML-ish tags (<i>, <b>, <c>, <ruby>…) from a cue text. */
export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

/**
 * Remove ASS override blocks ({\i1}, {\pos(…)}…) and convert ASS line breaks
 * (\N, \n) to plain newlines.
 */
export function stripAssOverrides(text: string): string {
  return text
    .replace(/\\[Nn]/g, "\n")
    .replace(/\{\\[^}]*\}/g, "");
}

/**
 * Normalize a raw subtitle cue line for tokenization:
 * ASS overrides → HTML tags → entities → whitespace collapse.
 */
export function normalizeCueText(text: string): string {
  return decodeEntities(stripAssOverrides(stripHtmlTags(text)))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
