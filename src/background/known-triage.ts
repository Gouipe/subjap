// ---------------------------------------------------------------------------
// SubJap — Known-word triage
// ---------------------------------------------------------------------------
//
// Lets a learner declare, batch after batch, the frequent words they already
// know. A batch walks the frequency list from the last triaged rank and keeps
// only words without any stored state or Anki card. Unchecked words stay
// unknown: only the rank reached is remembered, so they never come back
// until the learner restarts from the beginning.

import { db } from "@/core/db";
import { toHiragana } from "@/core/kana";
import { canonicalizeLexicalKey, lexicalKeyCandidates } from "@/core/lexical-key";
import { selectDictionaryEntry } from "@/dictionary/match";
import type { DictionaryEntry, KnownTriageBatch, KnownTriageItem } from "@/core/types";

export const KNOWN_TRIAGE_BATCH_SIZE = 50;
const KNOWN_TRIAGE_RANK_SETTING_KEY = "knownTriage:rank";
const SCAN_CHUNK = 200;
const HAS_KANJI = /\p{Script=Han}/u;

async function triagedRank(): Promise<number> {
  const setting = await db.settings.get(KNOWN_TRIAGE_RANK_SETTING_KEY);
  return typeof setting?.value === "number" ? setting.value : 0;
}

function isInterjectionOnly(entry: DictionaryEntry): boolean {
  return (
    entry.partOfSpeech.length > 0 &&
    entry.partOfSpeech.every((tag) => tag === "int" || /interjection/iu.test(tag))
  );
}

function shortMeaning(entry: DictionaryEntry): string {
  return entry.senses
    .slice(0, 2)
    .map((sense) => sense.glosses.slice(0, 3).join(", "))
    .filter(Boolean)
    .join(" ; ");
}

async function dictionaryEntriesByKey(keys: string[]): Promise<Map<string, DictionaryEntry | null>> {
  const readings = keys.map((key) => toHiragana(key.normalize("NFKC")));
  const terms = [...new Set([...keys, ...readings])];
  const matches = (
    await Promise.all([
      db.dictionaryEntries.where("headword").anyOf(terms).toArray(),
      db.dictionaryEntries.where("aliases").anyOf(terms).toArray(),
      db.dictionaryEntries.where("reading").anyOf(terms).toArray(),
    ])
  ).flat();
  const entries = [...new Set(matches)];
  return new Map(
    keys.map((key) => [
      key,
      selectDictionaryEntry(entries, [key], "orthography") ??
        selectDictionaryEntry(entries, [key], "reading"),
    ]),
  );
}

/** The next frequent words without any state, after the last triaged rank. */
export async function nextKnownTriageBatch(): Promise<KnownTriageBatch> {
  const fromRank = await triagedRank();
  const last = await db.frequencyEntries.orderBy("rank").last();
  const totalRanks = last?.rank ?? 0;
  const items: KnownTriageItem[] = [];
  let scannedRank = fromRank;

  while (items.length < KNOWN_TRIAGE_BATCH_SIZE && scannedRank < totalRanks) {
    const chunk = await db.frequencyEntries
      .where("rank")
      .above(scannedRank)
      .limit(SCAN_CHUNK)
      .sortBy("rank");
    if (chunk.length === 0) break;

    const flat = [...new Set(chunk.flatMap((entry) => lexicalKeyCandidates(entry.key)))];
    const [states, ankiWords, dictionary] = await Promise.all([
      db.wordStates.bulkGet(flat),
      db.ankiWords.bulkGet(flat),
      dictionaryEntriesByKey(chunk.map((entry) => entry.key)),
    ]);
    const tracked = new Set(
      flat.filter(
        (_key, index) => states[index] !== undefined || (ankiWords[index]?.noteCount ?? 0) > 0,
      ),
    );

    for (const entry of chunk) {
      scannedRank = entry.rank;
      if (lexicalKeyCandidates(entry.key).some((key) => tracked.has(key))) continue;
      const dictionaryEntry = dictionary.get(entry.key) ?? null;
      if (dictionaryEntry && isInterjectionOnly(dictionaryEntry)) continue;

      const reading =
        dictionaryEntry && HAS_KANJI.test(entry.key) ? toHiragana(dictionaryEntry.reading) : "";
      const meaning = dictionaryEntry ? shortMeaning(dictionaryEntry) : "";
      items.push({
        key: entry.key,
        rank: entry.rank,
        ...(reading && reading !== entry.key ? { reading } : {}),
        ...(meaning ? { meaning } : {}),
      });
      if (items.length === KNOWN_TRIAGE_BATCH_SIZE) break;
    }
  }

  return { items, fromRank, throughRank: scannedRank, totalRanks };
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

export async function restartKnownTriage(): Promise<void> {
  await db.settings.delete(KNOWN_TRIAGE_RANK_SETTING_KEY);
}
