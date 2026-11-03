import { describe, expect, it } from "vitest";
import type { Token } from "@/core/types";
import { WordPopover } from "./popover";

const token: Token = {
  surface: "ケンカ",
  lemma: "ケンカ",
  reading: "けんか",
  partOfSpeech: ["名詞"],
};

describe("WordPopover", () => {
  it("shows a fallback when no dictionary entry is available", () => {
    const popover = new WordPopover({
      onToggleKnown: () => undefined,
      onToggleIgnored: () => undefined,
      onMine: () => undefined,
    });
    document.body.appendChild(popover.getElement());

    popover.show({ anchor: popover.getElement(), token, entry: null });

    expect(
      popover.getElement().querySelector(".subjap-popover__defs")?.textContent,
    ).toBe("Aucune définition dans le dictionnaire");

    popover.destroy();
  });

  it("shows the dictionary form and its reading without redundant labels", () => {
    const inflectedToken: Token = {
      surface: "取れた",
      dictionaryForm: "取れる",
      lemma: "取れる",
      reading: "とれた",
      partOfSpeech: ["動詞"],
    };
    const popover = new WordPopover({
      onToggleKnown: () => undefined,
      onToggleIgnored: () => undefined,
      onMine: () => undefined,
    });
    document.body.appendChild(popover.getElement());

    popover.show({
      anchor: popover.getElement(),
      token: inflectedToken,
      entry: {
        headword: "取れる",
        reading: "トレル",
        partOfSpeech: ["動詞"],
        senses: [{ glosses: ["to come off"] }],
        common: true,
      },
    });

    expect(
      popover.getElement().querySelector(".subjap-popover__surface")?.textContent,
    ).toBe("取れる");
    expect(
      popover.getElement().querySelector(".subjap-popover__dictionary"),
    ).toBeNull();
    expect(
      popover.getElement().querySelector(".subjap-popover__reading")?.textContent,
    ).toBe("とれる");

    popover.destroy();
  });

  it("hides immediately before the mining callback starts", () => {
    let callbackPopover: WordPopover | null = null;
    const popover = new WordPopover({
      onToggleKnown: () => undefined,
      onToggleIgnored: () => undefined,
      onMine: () => {
        expect(callbackPopover?.getElement().style.display).toBe("none");
      },
    });
    callbackPopover = popover;
    document.body.appendChild(popover.getElement());

    popover.show({ anchor: popover.getElement(), token, entry: null });
    popover.getElement().querySelector<HTMLButtonElement>(".subjap-btn--mine")?.click();

    expect(popover.getElement().classList.contains("subjap-popover--visible")).toBe(false);
    popover.destroy();
  });
});
