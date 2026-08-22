// ---------------------------------------------------------------------------
// Extract vocabulary status from Migaku-compatible Anki notes.
// ---------------------------------------------------------------------------

export interface AnkiNoteInfoForKnownWords {
  fields: Record<string, { value: string }>;
}

/**
 * Turn a Migaku/SubJap Mot field into the plain Japanese form used by the
 * tokenizer. Migaku exports readings in bracket syntax and SubJap's own
 * notes may use ruby HTML, so both forms are handled here.
 */
export function normalizeAnkiWord(value: string): string {
  return value
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, "")
    .trim();
}

export function extractKnownAnkiWords(
  notes: AnkiNoteInfoForKnownWords[],
): string[] {
  return [
    ...new Set(
      notes
        .map((note) => normalizeAnkiWord(note.fields.Mot?.value ?? ""))
        .filter(Boolean),
    ),
  ];
}
