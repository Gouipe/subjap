import { db } from "@/core/db";
import { canonicalizeLexicalKey } from "@/core/lexical-key";
import type { FrequencyEntry } from "@/dictionary/frequency";
import type {
  AiKanjiCandidates,
  AiWordCandidate,
  AiWordFamiliarity,
  DictionaryEntry,
  WordState,
} from "@/core/types";

const MAX_CANDIDATES_PER_KANJI = 10;
/** Below this many familiar words, a kanji's shortlist is filled with frequent words. */
const MIN_FAMILIAR_CANDIDATES = 3;
/** Only words this common are offered to a learner who has not marked them. */
const MAX_FREQUENT_RANK = 5000;

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
  if (familiarity === "anki") return 2;
  return 3;
}

function collectIgnoredWords(states: WordState[]): Set<string> {
  return new Set(states.filter((state) => state.status === "ignored").map((state) => state.key));
}

function collectFamiliarWords(
  states: WordState[],
  ankiWords: string[],
  ignored: Set<string>,
): FamiliarWord[] {
  const byWord = new Map<string, FamiliarWord>();

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

async function buildFrequentCandidates(
  character: string,
  targetKey: string,
  frequentWords: FrequencyEntry[],
  excluded: Set<string>,
  limit: number,
): Promise<AiWordCandidate[]> {
  const candidates: AiWordCandidate[] = [];
  for (const { key, rank } of frequentWords) {
    if (candidates.length >= limit) break;
    if (!key.includes(character) || excluded.has(key)) continue;
    if (canonicalizeLexicalKey(key) === targetKey) continue;
    const entry = await lookupDictionaryEntry(key);
    if (!entry) continue;
    excluded.add(key);
    candidates.push({
      word: key,
      reading: entry.reading,
      definitions: entry.senses.flatMap((sense) => sense.glosses).slice(0, 3),
      familiarity: "frequent",
      frequencyRank: rank,
    });
  }
  return candidates;
}

async function buildCandidatesForKanji(
  character: string,
  targetKey: string,
  familiarWords: FamiliarWord[],
  frequentWords: FrequencyEntry[],
  ignored: Set<string>,
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

  const familiar = [...unique.values()]
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
  if (familiar.length >= MIN_FAMILIAR_CANDIDATES) return familiar;

  // A learner with few marked words still deserves examples: complete with
  // common words they will likely meet, never words they chose to ignore.
  const excluded = new Set([...ignored, ...familiarWords.map(({ word }) => word)]);
  const frequent = await buildFrequentCandidates(
    character,
    targetKey,
    frequentWords,
    excluded,
    MAX_CANDIDATES_PER_KANJI - familiar.length,
  );
  return [...familiar, ...frequent];
}

/**
 * Build a small shortlist from all eligible Anki/local vocabulary, completed
 * with frequent words when that vocabulary is sparse; ignored words stay excluded.
 */
export async function prepareAiEnrichmentCandidates(
  targetWord: string,
): Promise<AiKanjiCandidates[]> {
  const characters = extractKanji(targetWord);
  if (characters.length === 0) return [];

  const [states, ankiPresences, frequentWords] = await Promise.all([
    db.wordStates.toArray(),
    db.ankiWords.toArray(),
    db.frequencyEntries.where("rank").belowOrEqual(MAX_FREQUENT_RANK).sortBy("rank"),
  ]);
  const ignored = collectIgnoredWords(states);
  const familiarWords = collectFamiliarWords(
    states,
    ankiPresences.map(({ key }) => key),
    ignored,
  );
  const targetKey = canonicalizeLexicalKey(targetWord);

  return Promise.all(
    characters.map(async (character) => ({
      character,
      words: await buildCandidatesForKanji(
        character,
        targetKey,
        familiarWords,
        frequentWords,
        ignored,
      ),
    })),
  );
}
