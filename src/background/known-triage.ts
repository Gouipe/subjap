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
const KNOWN_TRIAGE_RANK_SETTING_KEY = "knownTriage:rank";
const SCAN_CHUNK = 100;
const HAS_KANJI = /\p{Script=Han}/u;

/** Godan continuative ending → dictionary ending (話し → 話す). */
const GODAN_STEM_ENDINGS: Readonly<Record<string, string>> = {
  い: "う",
  き: "く",
  ぎ: "ぐ",
  し: "す",
  ち: "つ",
  に: "ぬ",
  び: "ぶ",
  み: "む",
  り: "る",
};

export async function triagedRank(): Promise<number> {
  const setting = await db.settings.get(KNOWN_TRIAGE_RANK_SETTING_KEY);
  return typeof setting?.value === "number" ? setting.value : 0;
}

function isInterjectionOnly(entry: DictionaryEntry): boolean {
  return (
    entry.partOfSpeech.length > 0 &&
    entry.partOfSpeech.every((tag) => tag === "int" || /interjection/iu.test(tag))
  );
}

/** A real verb, not a noun that merely takes する. */
function isVerb(entry: DictionaryEntry): boolean {
  return entry.partOfSpeech.some(
    (tag) =>
      /^v(?:1|2|4|5|k|n|r|z)/u.test(tag) ||
      (/\bverb\b/iu.test(tag) && !/aux\. verb suru/iu.test(tag)),
  );
}

function shortMeaning(entry: DictionaryEntry): string {
  return entry.senses
    .slice(0, 2)
    .map((sense) => sense.glosses.slice(0, 3).join(", "))
    .filter(Boolean)
    .join(" ; ");
}

/**
 * The subtitle frequency list keeps verb stems (受け取, 出会, 話し, 教え).
 * Candidate dictionary forms, most likely first. A stem ending in kanji is
 * only completed when it is not a word by itself (上 must not become 上る).
 */
function verbCandidates(key: string, isWord: boolean): string[] {
  if (!HAS_KANJI.test(key)) return [];
  const last = key.slice(-1);
  if (HAS_KANJI.test(last)) return isWord ? [] : [`${key}る`, `${key}う`];
  const godanEnding = GODAN_STEM_ENDINGS[last];
  return [`${key}る`, ...(godanEnding ? [`${key.slice(0, -1)}${godanEnding}`] : [])];
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
    const allVerbCandidates = keys.flatMap((key) => verbCandidates(key, false));
    const entries = await dictionaryEntries([
      ...keys,
      ...keys.map((key) => toHiragana(key.normalize("NFKC"))),
      ...allVerbCandidates,
    ]);
    const lookups = keys.map((key) => {
      const spelled = selectDictionaryEntry(entries, [key], "orthography");
      const verb = verbCandidates(key, spelled !== null)
        .map((candidate) => ({
          key: candidate,
          entry: selectDictionaryEntry(entries, [candidate], "orthography"),
        }))
        .find((candidate) => candidate.entry !== null && isVerb(candidate.entry));
      return {
        exact: spelled ?? selectDictionaryEntry(entries, [key], "reading"),
        verb,
      };
    });

    const flat = [
      ...new Set(
        keys.flatMap((key, index) =>
          lexicalKeyCandidates(key, ...(lookups[index]?.verb ? [lookups[index].verb.key] : [])),
        ),
      ),
    ];
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
      const { exact, verb } = lookups[index] ?? { exact: null, verb: undefined };
      const key = verb?.key ?? frequencyEntry.key;
      const identities = lexicalKeyCandidates(key, frequencyEntry.key);
      if (offered.has(key) || identities.some((identity) => tracked.has(identity))) continue;
      const entry = verb?.entry ?? exact;
      if (!verb && entry && isInterjectionOnly(entry)) continue;

      const reading = entry && HAS_KANJI.test(key) ? toHiragana(entry.reading) : "";
      const meaning = entry ? shortMeaning(entry) : "";
      offered.add(key);
      items.push({
        key,
        rank: frequencyEntry.rank,
        ...(verb ? { alsoKeys: [frequencyEntry.key] } : {}),
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
