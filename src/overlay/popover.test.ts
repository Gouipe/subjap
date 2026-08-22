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
    ).toBe("Definition not found");

    popover.destroy();
  });
});
