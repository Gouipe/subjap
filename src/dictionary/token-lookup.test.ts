import { describe, expect, it, vi } from "vitest";
import type { DictionaryEntry, Token } from "@/core/types";
import {
  getTokenLookupTerms,
  lookupTokenDictionaryEntry,
} from "./token-lookup";

const token: Token = {
  surface: "ケンカ",
  lemma: "ケンカ",
  reading: "けんか",
  partOfSpeech: ["名詞"],
};

const entry: DictionaryEntry = {
  headword: "喧嘩",
  reading: "けんか",
  partOfSpeech: ["名詞"],
  senses: [{ glosses: ["quarrel"] }],
  common: true,
};

describe("token dictionary lookup", () => {
  it("tries lemma, surface, and normalized reading without duplicates", () => {
    expect(getTokenLookupTerms(token)).toEqual(["ケンカ", "けんか"]);
  });

  it("finds a word through its reading when the lemma spelling differs", async () => {
    const localLookup = vi.fn(() => null);
    const remoteLookup = vi.fn((term: string) =>
      term === "けんか" ? entry : null,
    );

    await expect(
      lookupTokenDictionaryEntry(token, localLookup, remoteLookup),
    ).resolves.toBe(entry);
    expect(remoteLookup).toHaveBeenCalledWith("ケンカ");
    expect(remoteLookup).toHaveBeenCalledWith("けんか");
  });
});
