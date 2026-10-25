// ---------------------------------------------------------------------------
// SubJap — structured view of the AI enrichment text
// ---------------------------------------------------------------------------
//
// The enrichment is stored and sent to Anki as plain text lines, which the
// card script turns into kanji tiles (`方 — Direction` followed by `・…`
// examples). The mining modal edits the same content as structured
// paragraphs so the learner can never break that line format.

export type AiNoteParagraph =
  | { kind: "kanji"; character: string; meaning: string; examples: string[] }
  | { kind: "text"; lines: string[] };

/** Same heading rule as the Anki card script. */
const KANJI_HEADING = /^(\p{Script=Han}{1,2}) — (.+)$/u;

/** Labels emphasized on the card; the modal keeps them out of the editable text. */
export const AI_NOTE_LABEL = /^((?:Synonyme|Nuance|Association) :)\s*(.*)$/u;

export function parseAiNotes(text: string): AiNoteParagraph[] {
  const paragraphs: AiNoteParagraph[] = [];
  let current: AiNoteParagraph | null = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      current = null;
      continue;
    }
    const heading = KANJI_HEADING.exec(line);
    if (heading) {
      const [, character = "", meaning = ""] = heading;
      const tile: AiNoteParagraph = { kind: "kanji", character, meaning, examples: [] };
      paragraphs.push(tile);
      current = tile;
      continue;
    }
    if (current?.kind === "kanji" && line.startsWith("・")) {
      const example = line.slice(1).trim();
      if (example) current.examples.push(example);
      continue;
    }
    if (current?.kind === "text") {
      current.lines.push(line);
      continue;
    }
    const text: AiNoteParagraph = { kind: "text", lines: [line] };
    paragraphs.push(text);
    current = text;
  }
  return paragraphs;
}

export function serializeAiNotes(paragraphs: AiNoteParagraph[]): string {
  return paragraphs
    .map((paragraph) =>
      paragraph.kind === "kanji"
        ? [
            `${paragraph.character} — ${paragraph.meaning}`,
            ...paragraph.examples.map((example) => `・${example}`),
          ].join("\n")
        : paragraph.lines.join("\n"),
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}
