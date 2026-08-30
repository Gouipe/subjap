import { db } from "@/core/db";
import { canonicalizeLexicalKey } from "@/core/lexical-key";
import type {
  AiKanjiCandidates,
  AiWordCandidate,
  AiWordFamiliarity,
  DictionaryEntry,
  WordState,
} from "@/core/types";

const MAX_CANDIDATES_PER_KANJI = 10;

interface FamiliarWord {
  word: string;
  familiarity: AiWordFamiliarity;
  knownAt?: number;
}

function extractKanji(text: string): string[] {
  return [...new Set(text.match(/\p{Script=Han}/gu) ?? [])];
}

async function lookupDictionaryEntry(term: string): Promise<DictionaryEntry | null> {
  const byHeadword = await db.dictionaryEntries.where("headword").equals(term).first();
  if (byHeadword) return byHeadword;
  const byAlias = await db.dictionaryEntries.where("aliases").equals(term).first();
  return byAlias ?? null;
}

function familiarityRank(familiarity: AiWordFamiliarity): number {
  if (familiarity === "known") return 0;
  if (familiarity === "learning") return 1;
  return 2;
}

function collectFamiliarWords(states: WordState[], ankiWords: string[]): FamiliarWord[] {
  const byWord = new Map<string, FamiliarWord>();
  const ignored = new Set(
    states.filter((state) => state.status === "ignored").map((state) => state.key),
  );

  for (const state of states) {
    if (state.status !== "known" && state.status !== "learning") continue;
    byWord.set(state.key, {
      word: state.key,
      familiarity: state.status,
      knownAt: state.knownAt,
    });
  }

  for (const word of ankiWords) {
    if (!ignored.has(word) && !byWord.has(word)) {
      byWord.set(word, { word, familiarity: "anki" });
    }
  }

  return [...byWord.values()];
}

async function buildCandidatesForKanji(
  character: string,
  targetKey: string,
  familiarWords: FamiliarWord[],
): Promise<AiWordCandidate[]> {
  const matching = familiarWords.filter(
    ({ word }) => word.includes(character) && canonicalizeLexicalKey(word) !== targetKey,
  );
  const resolved = await Promise.all(
    matching.map(async (familiar) => {
      const entry = await lookupDictionaryEntry(familiar.word);
      if (!entry) return null;
      const rank =
        (await db.frequencyEntries.get(familiar.word))?.rank ??
        (await db.frequencyEntries.get(entry.headword))?.rank;
      return {
        familiar,
        common: entry.common,
        candidate: {
          word: familiar.word,
          reading: entry.reading,
          definitions: entry.senses.flatMap((sense) => sense.glosses).slice(0, 3),
          familiarity: familiar.familiarity,
          ...(rank == null ? undefined : { frequencyRank: rank }),
        } satisfies AiWordCandidate,
      };
    }),
  );

  const unique = new Map<string, NonNullable<(typeof resolved)[number]>>();
  for (const item of resolved) {
    if (!item) continue;
    const current = unique.get(item.candidate.word);
    if (
      !current ||
      familiarityRank(item.candidate.familiarity) < familiarityRank(current.candidate.familiarity)
    ) {
      unique.set(item.candidate.word, item);
    }
  }

  return [...unique.values()]
    .sort((left, right) => {
      const familiarityDifference =
        familiarityRank(left.candidate.familiarity) - familiarityRank(right.candidate.familiarity);
      if (familiarityDifference !== 0) return familiarityDifference;
      if (left.common !== right.common) return left.common ? -1 : 1;
      const frequencyDifference =
        (left.candidate.frequencyRank ?? Number.MAX_SAFE_INTEGER) -
        (right.candidate.frequencyRank ?? Number.MAX_SAFE_INTEGER);
      if (frequencyDifference !== 0) return frequencyDifference;
      const knownAtDifference =
        (left.familiar.knownAt ?? Number.MAX_SAFE_INTEGER) -
        (right.familiar.knownAt ?? Number.MAX_SAFE_INTEGER);
      if (knownAtDifference !== 0) return knownAtDifference;
      return left.candidate.word.localeCompare(right.candidate.word, "ja");
    })
    .slice(0, MAX_CANDIDATES_PER_KANJI)
    .map(({ candidate }) => candidate);
}

/** Build a small, local shortlist; the full learner vocabulary never reaches the model. */
export async function prepareAiEnrichmentCandidates(
  targetWord: string,
): Promise<AiKanjiCandidates[]> {
  const characters = extractKanji(targetWord);
  if (characters.length === 0) return [];

  const [states, ankiPresences] = await Promise.all([
    db.wordStates.toArray(),
    db.ankiWords.toArray(),
  ]);
  const familiarWords = collectFamiliarWords(
    states,
    ankiPresences.map(({ key }) => key),
  );
  const targetKey = canonicalizeLexicalKey(targetWord);

  return Promise.all(
    characters.map(async (character) => ({
      character,
      words: await buildCandidatesForKanji(character, targetKey, familiarWords),
    })),
  );
}
