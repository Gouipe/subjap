// ---------------------------------------------------------------------------
// SubJap — Known-word triage
// ---------------------------------------------------------------------------
//
// Lets a learner declare, batch after batch, the frequent words they already
// know. A batch walks the frequency list from the last triaged rank and keeps
// only words without any stored state or Anki card. Unchecked words stay
// unknown: only the rank reached is remembered, so they never come back
// in the triage.

import { db } from "@/core/db";
import { toHiragana } from "@/core/kana";
import { canonicalizeLexicalKey, lexicalKeyCandidates } from "@/core/lexical-key";
import { selectDictionaryEntry } from "@/dictionary/match";
import type { DictionaryEntry, KnownTriageBatch, KnownTriageItem } from "@/core/types";

export const KNOWN_TRIAGE_BATCH_SIZE = 20;
// Named after the frequency list: a rank reached in another list means other words.
const KNOWN_TRIAGE_RANK_SETTING_KEY = "knownTriage:rank:jpdb";
const SCAN_CHUNK = 100;
const HAS_KANJI = /\p{Script=Han}/u;
const NOT_VOCABULARY_TAG =
  /^(?:int|prt|cop|cop-da|aux|aux-v|aux-adj)$|interjection|particle|copula|auxiliary/iu;

export async function triagedRank(): Promise<number> {
  const setting = await db.settings.get(KNOWN_TRIAGE_RANK_SETTING_KEY);
  return typeof setting?.value === "number" ? setting.value : 0;
}

/** Interjections, particles, auxiliaries and copulas are not words to sort. */
function isNotVocabulary(entry: DictionaryEntry): boolean {
  return (
    entry.partOfSpeech.length > 0 &&
    entry.partOfSpeech.every((tag) => NOT_VOCABULARY_TAG.test(tag))
  );
}

function shortMeaning(entry: DictionaryEntry): string {
  return entry.senses
    .slice(0, 2)
    .map((sense) => sense.glosses.slice(0, 3).join(", "))
    .filter(Boolean)
    .join(" ; ");
}

async function dictionaryEntries(terms: string[]): Promise<DictionaryEntry[]> {
  const unique = [...new Set(terms)];
  const matches = await Promise.all([
    db.dictionaryEntries.where("headword").anyOf(unique).toArray(),
    db.dictionaryEntries.where("aliases").anyOf(unique).toArray(),
    db.dictionaryEntries.where("reading").anyOf(unique).toArray(),
  ]);
  return [...new Set(matches.flat())];
}

/** The next frequent words without any state, after the last triaged rank. */
export async function nextKnownTriageBatch(): Promise<KnownTriageBatch> {
  const fromRank = await triagedRank();
  const last = await db.frequencyEntries.orderBy("rank").last();
  const totalRanks = last?.rank ?? 0;
  const items: KnownTriageItem[] = [];
  const offered = new Set<string>();
  let scannedRank = fromRank;

  while (items.length < KNOWN_TRIAGE_BATCH_SIZE && scannedRank < totalRanks) {
    const chunk = await db.frequencyEntries
      .where("rank")
      .above(scannedRank)
      .limit(SCAN_CHUNK)
      .sortBy("rank");
    if (chunk.length === 0) break;

    const keys = chunk.map((entry) => entry.key);
    const entries = await dictionaryEntries([
      ...keys,
      ...keys.map((key) => toHiragana(key.normalize("NFKC"))),
    ]);
    const lookups = keys.map(
      (key) =>
        selectDictionaryEntry(entries, [key], "orthography") ??
        selectDictionaryEntry(entries, [key], "reading"),
    );

    const flat = [...new Set(keys.flatMap((key) => lexicalKeyCandidates(key)))];
    const [states, ankiWords] = await Promise.all([
      db.wordStates.bulkGet(flat),
      db.ankiWords.bulkGet(flat),
    ]);
    const tracked = new Set(
      flat.filter(
        (_key, index) => states[index] !== undefined || (ankiWords[index]?.noteCount ?? 0) > 0,
      ),
    );

    for (const [index, frequencyEntry] of chunk.entries()) {
      scannedRank = frequencyEntry.rank;
      const key = frequencyEntry.key;
      if (offered.has(key) || lexicalKeyCandidates(key).some((identity) => tracked.has(identity)))
        continue;
      const entry = lookups[index] ?? null;
      if (entry && isNotVocabulary(entry)) continue;

      const reading = entry && HAS_KANJI.test(key) ? toHiragana(entry.reading) : "";
      const meaning = entry ? shortMeaning(entry) : "";
      offered.add(key);
      items.push({
        key,
        rank: frequencyEntry.rank,
        ...(reading && reading !== key ? { reading } : {}),
        ...(meaning ? { meaning } : {}),
      });
      if (items.length === KNOWN_TRIAGE_BATCH_SIZE) break;
    }
  }

  return { items, fromRank, throughRank: scannedRank, totalRanks };
}

/** Adopt the sorting progress made on another PC (0 forgets it). */
export async function setTriagedRank(rank: number): Promise<void> {
  if (rank > 0) await db.settings.put({ key: KNOWN_TRIAGE_RANK_SETTING_KEY, value: rank });
  else await db.settings.delete(KNOWN_TRIAGE_RANK_SETTING_KEY);
}

/** Mark the checked words known, as a manual decision, and move the cursor. */
export async function commitKnownTriage(keys: string[], throughRank: number): Promise<void> {
  const knownAt = Date.now();
  await db.transaction("rw", db.wordStates, db.settings, async () => {
    await db.wordStates.bulkPut(
      [...new Set(keys.map(canonicalizeLexicalKey).filter(Boolean))].map((key) => ({
        key,
        status: "known" as const,
        source: "manual" as const,
        knownAt,
      })),
    );
    await db.settings.put({
      key: KNOWN_TRIAGE_RANK_SETTING_KEY,
      value: Math.max(throughRank, await triagedRank()),
    });
  });
}
