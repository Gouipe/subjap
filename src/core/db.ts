// ---------------------------------------------------------------------------
// SubJap — IndexedDB schema (Dexie)
// ---------------------------------------------------------------------------

import Dexie, { type Table } from "dexie";
import type {
  AnkiWordPresence,
  WordState,
  MineCard,
  DictionaryEntry,
  PendingMine,
} from "@/core/types";
import type { FrequencyEntry } from "@/dictionary/frequency";
import { stripLexemeGloss } from "@/core/lexical-key";

export class SubJapDb extends Dexie {
  ankiWords!: Table<AnkiWordPresence, string>; // primary key = lemma
  wordStates!: Table<WordState, string>; // primary key = lemma
  mineCards!: Table<MineCard, string>; // primary key = uuid
  pendingMines!: Table<PendingMine, string>; // primary key = uuid
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

    this.version(3).stores({
      wordStates: "key,status,source",
      mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
      dictionaryEntries: "++id,headword,reading,*aliases,partOfSpeech,common,frequencyRank",
      frequencyEntries: "key,rank",
      settings: "key",
    });

    this.version(4).stores({
      ankiWords: "key,noteCount",
      wordStates: "key,status,source",
      mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
      dictionaryEntries: "++id,headword,reading,*aliases,partOfSpeech,common,frequencyRank",
      frequencyEntries: "key,rank",
      settings: "key",
    });

    this.version(5).stores({
      ankiWords: "key,noteCount",
      wordStates: "key,status,source",
      mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
      pendingMines: "id,createdAt,key",
      dictionaryEntries: "++id,headword,reading,*aliases,partOfSpeech,common,frequencyRank",
      frequencyEntries: "key,rank",
      settings: "key",
    });

    // Words were stored under UniDic's glossed lexeme (テレビ-television).
    this.version(6)
      .stores({
        ankiWords: "key,noteCount",
        wordStates: "key,status,source",
        mineCards: "id,createdAt,targetWord,srs.state,srs.due,tags",
        pendingMines: "id,createdAt,key",
        dictionaryEntries: "++id,headword,reading,*aliases,partOfSpeech,common,frequencyRank",
        frequencyEntries: "key,rank",
        settings: "key",
      })
      .upgrade(async (tx) => {
        const states = tx.table<WordState, string>("wordStates");
        const glossed = (await states.toArray()).filter(
          (state) => stripLexemeGloss(state.key) !== state.key,
        );
        const renamed: string[] = [];
        for (const state of glossed) {
          const key = stripLexemeGloss(state.key);
          const current = await states.get(key);
          if (!current || isMoreRecent(state, current)) await states.put({ ...state, key });
          await states.delete(state.key);
          renamed.push(state.key, key);
        }
        if (renamed.length > 0) {
          await tx
            .table("settings")
            .put({ key: LEXEME_KEY_MIGRATION_SETTING_KEY, value: [...new Set(renamed)] });
        }
        await tx
          .table<PendingMine, string>("pendingMines")
          .toCollection()
          .modify((item) => {
            item.key = stripLexemeGloss(item.key);
          });
      });
  }
}

/** Keys renamed by the version 6 upgrade, still to send to the account. */
export const LEXEME_KEY_MIGRATION_SETTING_KEY = "lexemeKeyMigration";

/** Between two states of one word, the manual and latest decision wins. */
function isMoreRecent(state: WordState, other: WordState): boolean {
  const manual = (candidate: WordState): number => (candidate.source === "manual" ? 1 : 0);
  const time = (candidate: WordState): number => candidate.updatedAt ?? candidate.knownAt ?? 0;
  return (
    manual(state) - manual(other) > 0 ||
    (manual(state) === manual(other) && time(state) > time(other))
  );
}

/** Singleton instance — initialize once in the service worker. */
export const db = new SubJapDb();
