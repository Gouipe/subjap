import { canonicalizeLexicalKey } from "@/core/lexical-key";
import { sendMessage } from "@/core/messaging";
import { DEFAULT_ENRICHMENT_PROMPT, getAiSettings } from "@/core/ai-settings";
import type { AiKanjiCandidates } from "@/core/types";

const responseCache = new Map<string, RawAiEnrichment>();

export interface AiEnrichmentInput {
  targetWord: string;
  targetReading: string;
  sentence: string;
  definitions: string[];
  kanjiCandidates: AiKanjiCandidates[];
}

interface RawSynonym {
  word: string;
  reading: string;
  nuance: string;
}

interface RawKanjiExample {
  word: string;
  reading: string;
  meaning: string;
}

interface RawKanjiNote {
  character: string;
  meaning: string;
  examples: RawKanjiExample[];
}

interface RawAiEnrichment {
  synonyms: RawSynonym[];
  kanji: RawKanjiNote[];
  association: string;
}

export interface AiSession {
  generate(input: AiEnrichmentInput, force?: boolean): Promise<RawAiEnrichment>;
  destroy(): void;
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    synonyms: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          reading: { type: "string" },
          nuance: { type: "string" },
        },
        required: ["word", "reading", "nuance"],
        additionalProperties: false,
      },
    },
    kanji: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          character: { type: "string", maxLength: 2 },
          meaning: { type: "string", maxLength: 30 },
          examples: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                reading: { type: "string" },
                meaning: { type: "string", maxLength: 40 },
              },
              required: ["word", "reading", "meaning"],
              additionalProperties: false,
            },
          },
        },
        required: ["character", "meaning", "examples"],
        additionalProperties: false,
      },
    },
    association: { type: "string", maxLength: 220 },
  },
  required: ["synonyms", "kanji", "association"],
  additionalProperties: false,
};

const ASSOCIATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    association: { type: "string", maxLength: 220 },
  },
  required: ["association"],
  additionalProperties: false,
};

function parseRawEnrichment(value: string): RawAiEnrichment {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Réponse IA invalide");
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.synonyms) || !Array.isArray(record.kanji)) {
    throw new Error("Réponse IA incomplète");
  }
  return {
    synonyms: record.synonyms as RawSynonym[],
    kanji: record.kanji as RawKanjiNote[],
    association: typeof record.association === "string" ? record.association : "",
  };
}

function buildPrompt(input: AiEnrichmentInput, template: string): string {
  const values: Record<string, string> = {
    targetWord: input.targetWord,
    targetReading: input.targetReading || "inconnue",
    sentence: input.sentence,
    definitions: input.definitions.join(" ; ") || "aucune",
    kanjiCandidates: JSON.stringify(input.kanjiCandidates),
  };
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (placeholder, key: string) =>
    values[key] ?? placeholder,
  );
}

function associationCoversEveryKanji(input: AiEnrichmentInput, association: string): boolean {
  return input.kanjiCandidates.every(({ character }) => association.includes(character));
}

function buildAssociationRepairPrompt(
  input: AiEnrichmentInput,
  enrichment: RawAiEnrichment,
): string {
  const components = input.kanjiCandidates
    .map(({ character }) => {
      const meaning = enrichment.kanji.find((item) => item.character === character)?.meaning;
      return `${character} (« ${meaning || "sens à préciser"} »)`;
    })
    .join(" + ");
  return `Corrige uniquement la phrase d'association du mot ${input.targetWord}.
Elle doit commencer par « ${components} », citer tous les kanjis dans cet ordre, puis expliquer en une seule phrase comment leurs sens combinés donnent le sens de ${input.targetWord} dans le contexte.
Ne parle pas de la lecture d'un kanji isolé et ne présente pas la phrase comme une étymologie certaine.`;
}

function parseRepairedAssociation(value: string): string {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") return "";
  const association = (parsed as Record<string, unknown>).association;
  return typeof association === "string" ? association : "";
}

function cacheKey(input: AiEnrichmentInput, promptTemplate: string): string {
  return JSON.stringify({ input, promptTemplate });
}

/** Connect to the configured Cloudflare Worker from the learner's explicit button click. */
export async function createAiSession(onStatus: (message: string) => void): Promise<AiSession> {
  onStatus("Connexion à Gemini…");
  const { enrichmentPrompt } = await getAiSettings();
  const promptTemplate = enrichmentPrompt || DEFAULT_ENRICHMENT_PROMPT;
  return {
    async generate(input, force = false) {
      const key = cacheKey(input, promptTemplate);
      const cached = responseCache.get(key);
      if (cached && !force) return cached;

      onStatus("Analyse du mot et de tes exemples…");
      const response = await sendMessage("ai:generateEnrichment", {
        prompt: buildPrompt(input, promptTemplate),
        responseSchema: RESPONSE_SCHEMA,
      });
      const parsed = parseRawEnrichment(response.text);
      if (
        input.kanjiCandidates.length > 1 &&
        parsed.association &&
        !associationCoversEveryKanji(input, parsed.association)
      ) {
        onStatus("Correction de l’association des kanjis…");
        const repairedResponse = await sendMessage("ai:generateEnrichment", {
          prompt: buildAssociationRepairPrompt(input, parsed),
          responseSchema: ASSOCIATION_SCHEMA,
        });
        parsed.association = parseRepairedAssociation(repairedResponse.text);
      }
      responseCache.set(key, parsed);
      return parsed;
    },
    destroy() {
      // Remote requests are scoped to the current generation and need no session cleanup.
    },
  };
}

function singleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function withReading(word: string, reading: string): string {
  return reading && reading !== word ? `${word}（${reading}）` : word;
}

async function validateSynonym(
  synonym: RawSynonym,
  targetWord: string,
): Promise<{ word: string; reading: string; nuance: string } | null> {
  const requestedWord = singleLine(synonym.word, 40);
  const nuance = singleLine(synonym.nuance, 220);
  if (!requestedWord || !nuance) return null;
  const { entry } = await sendMessage("dict:lookup", { lemma: requestedWord });
  if (!entry || !entry.common) return null;
  const targetKey = canonicalizeLexicalKey(targetWord);
  const entryForms = [entry.headword, entry.reading, ...(entry.aliases ?? [])];
  if (entryForms.some((form) => canonicalizeLexicalKey(form) === targetKey)) {
    return null;
  }
  return { word: entry.headword, reading: entry.reading, nuance };
}

function findCandidate(
  candidates: AiKanjiCandidates,
  requestedWord: string,
): AiKanjiCandidates["words"][number] | null {
  const key = canonicalizeLexicalKey(requestedWord);
  return (
    candidates.words.find((candidate) => canonicalizeLexicalKey(candidate.word) === key) ?? null
  );
}

/** Validate model choices against JMdict and the exact local shortlist, then format editable text. */
export async function formatValidatedAiEnrichment(
  raw: RawAiEnrichment,
  input: AiEnrichmentInput,
): Promise<string> {
  const validatedSynonyms = (
    await Promise.all(
      raw.synonyms.slice(0, 2).map((synonym) => validateSynonym(synonym, input.targetWord)),
    )
  ).filter((synonym): synonym is NonNullable<typeof synonym> => synonym !== null);
  const synonyms = validatedSynonyms.filter(
    (synonym, index) =>
      validatedSynonyms.findIndex(
        (candidate) =>
          canonicalizeLexicalKey(candidate.word) === canonicalizeLexicalKey(synonym.word),
      ) === index,
  );

  const lines: string[] = [];
  for (const synonym of synonyms) {
    if (lines.length > 0) lines.push("");
    lines.push(`Synonyme : ${withReading(synonym.word, synonym.reading)}`);
    lines.push(`Nuance : ${synonym.nuance}`);
  }

  for (const candidates of input.kanjiCandidates) {
    const rawKanji = raw.kanji.find((item) => item.character === candidates.character);
    if (!rawKanji) continue;
    const meaning = singleLine(rawKanji.meaning, 30);
    if (!meaning) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`${candidates.character} — ${meaning}`);

    const used = new Set<string>();
    for (const rawExample of rawKanji.examples.slice(0, 2)) {
      const candidate = findCandidate(candidates, rawExample.word);
      if (!candidate || used.has(candidate.word)) continue;
      used.add(candidate.word);
      const exampleMeaning = singleLine(rawExample.meaning, 40);
      lines.push(
        `・${withReading(candidate.word, candidate.reading)}${exampleMeaning ? ` ${exampleMeaning}` : ""}`,
      );
    }
  }

  const targetKanjiCount = input.kanjiCandidates.length;
  const association = singleLine(raw.association, 220);
  if (
    targetKanjiCount > 1 &&
    association &&
    associationCoversEveryKanji(input, association)
  ) {
    if (lines.length > 0) lines.push("");
    lines.push(`Association : ${association}`);
  }

  return lines.join("\n");
}

/** Only exported so the modal can type its in-flight raw model response. */
export type GeneratedAiEnrichment = RawAiEnrichment;
