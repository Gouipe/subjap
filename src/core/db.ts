// ---------------------------------------------------------------------------
// SubJap — IndexedDB schema (Dexie)
// ---------------------------------------------------------------------------

import Dexie, { type Table } from "dexie";
import type {
  WordState,
  MineCard,
  DictionaryEntry,
} from "@/core/types";
import type { FrequencyEntry } from "@/dictionary/frequency";

export class SubJapDb extends Dexie {
  wordStates!: Table<WordState, string>; // primary key = lemma
  mineCards!: Table<MineCard, string>; // primary key = uuid
  dictionaryEntries!: Table<DictionaryEntry, number>; // auto-increment pk
  frequencyEntries!: Table<FrequencyEntry, string>; // primary key = word
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("SubJap");

    this.version(1).stores({
      wordStates: "key,status,source",
      mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
      dictionaryEntries: "++id,headword,reading,partOfSpeech,common,frequencyRank",
      settings: "key",
    });

    this.version(2).stores({
      wordStates: "key,status,source",
      mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
      dictionaryEntries: "++id,headword,reading,partOfSpeech,common,frequencyRank",
      frequencyEntries: "key,rank",
      settings: "key",
    });
  }
}

/** Singleton instance — initialize once in the service worker. */
export const db = new SubJapDb();
