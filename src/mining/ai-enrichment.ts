import { canonicalizeLexicalKey } from "@/core/lexical-key";
import { sendMessage } from "@/core/messaging";
import type { AiKanjiCandidates } from "@/core/types";

const PROMPT_TIMEOUT_MS = 45_000;
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

export interface LocalAiSession {
  generate(input: AiEnrichmentInput, force?: boolean): Promise<RawAiEnrichment>;
  destroy(): void;
}

export class LocalAiUnavailableError extends Error {}

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

function buildPrompt(input: AiEnrichmentInput): string {
  return `Crée une note pédagogique très concise pour un apprenant francophone de japonais.

Mot cible : ${input.targetWord}
Lecture : ${input.targetReading || "inconnue"}
Phrase rencontrée : ${input.sentence}
Définitions sélectionnées : ${input.definitions.join(" ; ") || "aucune"}

Candidats familiers classés par préférence (known, puis learning, puis Anki) :
${JSON.stringify(input.kanjiCandidates)}

Règles impératives :
- Propose au maximum deux synonymes, seulement s'ils sont très importants et réellement substituables dans un sens proche du contexte. Sinon retourne un tableau vide.
- Pour chaque synonyme, explique en une seule phrase française la différence d'usage avec ${input.targetWord}.
- Donne pour chaque kanji du mot cible une définition française en un seul mot.
- Les exemples de kanji doivent provenir exactement des candidats familiers fournis.
- Ne retiens un exemple que si le kanji y possède la même lecture que dans le mot cible. En cas de doute, ne le retiens pas.
- Maximum deux exemples par kanji. Il est parfaitement valide de n'en donner aucun.
- Si le mot contient plusieurs kanjis, la phrase d'association doit citer chacun d'eux dans l'ordre, rappeler brièvement leur sens et expliquer comment leurs sens se combinent pour produire celui du mot cible. Par exemple : « 全 (« totalité ») + 国 (« pays ») désignent l'ensemble du pays, donc 全国. » Ne donne pas seulement la définition ou la lecture d'un kanji isolé.
- Présente cette association comme une aide mnémotechnique, jamais comme une étymologie certaine. Si l'association serait trompeuse, retourne une chaîne vide.
- N'ajoute aucune justification, avertissement ou texte hors du JSON.`;
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

function cacheKey(input: AiEnrichmentInput): string {
  return JSON.stringify(input);
}

/** Start Chrome's on-device model from the learner's explicit button click. */
export async function createLocalAiSession(
  onStatus: (message: string) => void,
): Promise<LocalAiSession> {
  if (typeof LanguageModel === "undefined") {
    throw new LocalAiUnavailableError("L’IA locale n’est pas disponible dans ce navigateur.");
  }

  const modelOptions: LanguageModelCreateCoreOptions = {
    expectedInputs: [{ type: "text", languages: ["fr", "ja", "en"] }],
    expectedOutputs: [{ type: "text", languages: ["fr"] }],
  };
  const availability = await LanguageModel.availability(modelOptions);
  if (availability === "unavailable") {
    throw new LocalAiUnavailableError(
      "Ce PC ou cette version de Chrome ne permet pas l’IA locale.",
    );
  }
  if (availability === "downloadable" || availability === "downloading") {
    onStatus("Téléchargement du modèle local…");
  } else {
    onStatus("Préparation de l’analyse locale…");
  }

  const session = await LanguageModel.create({
    ...modelOptions,
    initialPrompts: [
      {
        role: "system",
        content:
          "Tu aides à mémoriser le vocabulaire japonais. Tu privilégies l'exactitude, la concision et l'absence de réponse quand aucun enrichissement fiable n'existe.",
      },
    ],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const percent = Math.round(event.loaded * 100);
        onStatus(`Téléchargement du modèle local… ${percent}%`);
      });
    },
  });

  return {
    async generate(input, force = false) {
      const key = cacheKey(input);
      const cached = responseCache.get(key);
      if (cached && !force) return cached;

      onStatus("Analyse du mot et de tes exemples…");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
      try {
        const response = await session.prompt(buildPrompt(input), {
          responseConstraint: RESPONSE_SCHEMA,
          signal: controller.signal,
        });
        const parsed = parseRawEnrichment(response);
        if (
          input.kanjiCandidates.length > 1 &&
          parsed.association &&
          !associationCoversEveryKanji(input, parsed.association)
        ) {
          onStatus("Correction de l’association des kanjis…");
          const repairedResponse = await session.prompt(
            buildAssociationRepairPrompt(input, parsed),
            {
              responseConstraint: ASSOCIATION_SCHEMA,
              signal: controller.signal,
            },
          );
          parsed.association = parseRepairedAssociation(repairedResponse);
        }
        responseCache.set(key, parsed);
        return parsed;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    destroy() {
      session.destroy();
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
