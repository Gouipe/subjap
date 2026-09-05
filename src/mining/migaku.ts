// ---------------------------------------------------------------------------
// SubJap — Migaku Memory note formatting
// ---------------------------------------------------------------------------

import type { RenderedCue, SpanToken } from "@/core/types";

/** Escape user/dictionary text before placing it in an Anki HTML field. */
export function escapeAnkiHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format the word field in the same spirit as the Migaku export: keep the
 * Japanese form and add ruby when a kanji form has a known reading.
 */
export function formatMigakuWord(surface: string, reading: string): string {
  const escapedSurface = escapeAnkiHtml(surface);
  if (!reading || !/[\u3400-\u9fff\uF900-\uFAFF]/u.test(surface)) {
    return escapedSurface;
  }
  return `<ruby>${escapedSurface}<rt>${escapeAnkiHtml(reading)}</rt></ruby>`;
}

/** Render a mined subtitle with the selected token highlighted. */
export function formatMigakuSentence(cue: RenderedCue, targetToken: SpanToken): string {
  return cue.spans
    .map((span) => {
      const target = span.token === targetToken.token;
      const className = target ? ' class="target"' : "";
      return `<span${className}>${escapeAnkiHtml(span.token.surface).replace(/\n/gu, "<br>")}</span>`;
    })
    .join("");
}

/** Convert selected dictionary glosses to the comma-separated Migaku field. */
export function formatMigakuDefinitions(definitions: string[]): string {
  return definitions.map(escapeAnkiHtml).join(", ");
}

/** Convert multiline user text to safe HTML while preserving line breaks. */
export function formatMigakuNotes(text: string): string {
  return escapeAnkiHtml(text).replace(/\r?\n/gu, "<br>");
}
