import { describe, expect, it } from "vitest";
import {
  countAnkiWordPresenceChanges,
  extractAnkiWordPresences,
  extractAnkiWordStates,
  normalizeAnkiWord,
  planImportedStateReconciliation,
} from "@/background/anki-known";

describe("Anki word-state import", () => {
  it("partage l’identité UniDic entre les graphies d’un même lexème", () => {
    expect(normalizeAnkiWord("コイツ")).toBe("此奴");
    expect(normalizeAnkiWord("<ruby>こいつ<rt>こいつ</rt></ruby>")).toBe("此奴");
  });

  it("normalise ruby, syntaxe Migaku et ponctuation périphérique", () => {
    expect(normalizeAnkiWord("着[つ;k1,o]く")).toBe("着く");
    expect(normalizeAnkiWord("<ruby>食べる<rt>たべる</rt></ruby>")).toBe("食べる");
    expect(normalizeAnkiWord("男性{。}")).toBe("男性");
  });

  it("importe tous les statuts et donne priorité aux mots à travailler", () => {
    expect(
      extractAnkiWordStates([
        { fields: { Mot: { value: "着く" } }, tags: ["KNOWN"] },
        { fields: { Mot: { value: "着く" } }, tags: ["LEARNING"] },
        { fields: { Mot: { value: "猫" } }, tags: ["IGNORED"] },
        { fields: { Mot: { value: "犬" } }, tags: ["UNKNOWN"] },
      ]),
    ).toEqual([
      { key: "着く", status: "learning" },
      { key: "猫", status: "ignored" },
      { key: "犬", status: "unknown" },
    ]);
  });

  it("fait primer IGNORED sur les autres tags du même mot", () => {
    expect(
      extractAnkiWordStates([
        { fields: { Mot: { value: "やる" } }, tags: ["LEARNING"] },
        { fields: { Mot: { value: "やる" } }, tags: ["IGNORED"] },
      ]),
    ).toEqual([{ key: "やる", status: "ignored" }]);
  });

  it("compte toutes les cartes Anki par mot, même sans tag de statut", () => {
    expect(
      extractAnkiWordPresences([
        { fields: { Mot: { value: "<ruby>感動<rt>かんどう</rt></ruby>" } } },
        { fields: { Mot: { value: "感動" } }, tags: ["UNKNOWN"] },
        { fields: { Mot: { value: "猫" } }, tags: [] },
        { fields: { Front: { value: "sans champ Mot" } }, tags: ["KNOWN"] },
      ]),
    ).toEqual([
      { key: "感動", noteCount: 2 },
      { key: "猫", noteCount: 1 },
    ]);
  });

  it("détecte les ajouts, suppressions et changements de quantité", () => {
    expect(
      countAnkiWordPresenceChanges(
        [
          { key: "感動", noteCount: 1 },
          { key: "猫", noteCount: 1 },
        ],
        [
          { key: "感動", noteCount: 2 },
          { key: "犬", noteCount: 1 },
        ],
      ),
    ).toBe(3);
  });

  it("retire les imports obsolètes sans écraser les décisions manuelles", () => {
    const result = planImportedStateReconciliation(
      [
        { key: "古い", status: "known", source: "import" },
        { key: "手動", status: "unknown", source: "manual" },
      ],
      [
        { key: "新しい", status: "known" },
        { key: "手動", status: "known" },
      ],
      123,
    );
    expect(result.removals).toEqual(["古い"]);
    expect(result.upserts).toEqual([
      { key: "新しい", status: "known", knownAt: 123, source: "import" },
    ]);
  });
});
