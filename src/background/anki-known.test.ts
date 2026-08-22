import { describe, expect, it } from "vitest";
import { extractKnownAnkiWords, normalizeAnkiWord } from "@/background/anki-known";

describe("Anki known-word import", () => {
  it("normalizes Migaku word syntax and ruby HTML", () => {
    expect(normalizeAnkiWord("着[つ;k1,o]く")).toBe("着く");
    expect(normalizeAnkiWord("<ruby>食べる<rt>たべる</rt></ruby>")).toBe("食べる");
  });

  it("extracts unique Mot values", () => {
    expect(
      extractKnownAnkiWords([
        { fields: { Mot: { value: "着[つ;k1,o]く" } } },
        { fields: { Mot: { value: "着く" } } },
      ]),
    ).toEqual(["着く"]);
  });
});
