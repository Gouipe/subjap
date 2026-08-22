import { describe, expect, it } from "vitest";
import { lexicalKeyCandidates } from "@/core/lexical-key";

describe("lexicalKeyCandidates", () => {
  it("keeps all exact lexical forms available for lookup", () => {
    expect(lexicalKeyCandidates("色んな", "いろんな")).toEqual([
      "色んな",
      "いろんな",
    ]);
  });

  it("preserves the existing compatibility aliases", () => {
    expect(lexicalKeyCandidates("此奴", "こいつ")).toEqual([
      "此奴",
      "こいつ",
      "コイツ",
    ]);
  });
});
