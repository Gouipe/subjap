import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayRenderer } from "@/overlay/renderer";
import type { RenderedCue } from "@/core/types";

function renderedCue(): RenderedCue {
  return {
    cue: {
      id: "fixture-1",
      start: 1,
      end: 3,
      text: "日本語を勉強します。",
    },
    spans: [
      {
        index: 0,
        token: {
          surface: "日本語",
          lemma: "日本語",
          reading: "にほんご",
          partOfSpeech: ["名詞"],
        },
        wordState: { key: "日本語", status: "known", source: "manual" },
      },
      {
        index: 1,
        token: {
          surface: "を",
          lemma: "を",
          reading: "を",
          partOfSpeech: ["助詞"],
        },
        wordState: null,
      },
    ],
  };
}

describe("OverlayRenderer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#subjap-overlay-styles")
      .forEach((style) => style.remove());
    vi.restoreAllMocks();
  });

  it("monte l’overlay sur body et rend les tokens avec leur état", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 640, 360),
    );

    const overlay = new OverlayRenderer(video, {
      showFurigana: true,
      highlightKnown: true,
    });
    overlay.updateCues([renderedCue()]);
    overlay.show();

    const container = document.getElementById("subjap-overlay-container");
    expect(container?.parentElement).toBe(document.body);
    expect(container?.querySelectorAll(".subjap-token")).toHaveLength(2);
    expect(container?.querySelector(".subjap-known")).not.toBeNull();
    expect(container?.querySelector(".subjap-furigana")?.textContent).toBe(
      "にほんご",
    );

    overlay.destroy();
    expect(document.getElementById("subjap-overlay-container")).toBeNull();
  });

  it("affiche les lectures kuromoji en hiragana", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 640, 360),
    );

    const cue = renderedCue();
    const firstSpan = cue.spans[0];
    if (!firstSpan) throw new Error("Expected a token span");
    firstSpan.token.reading = "ニホンゴ";
    const overlay = new OverlayRenderer(video, { showFurigana: true });
    overlay.updateCues([cue]);
    overlay.show();

    expect(
      document.querySelector(".subjap-furigana")?.textContent,
    ).toBe("にほんご");

    overlay.destroy();
  });

  it("structure les tokens pour une lecture pédagogique", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 640, 360),
    );

    const overlay = new OverlayRenderer(video, { showFurigana: true });
    overlay.updateCues([
      {
        ...renderedCue(),
        spans: [
          ...renderedCue().spans,
          {
            index: 2,
            token: {
              surface: "。",
              lemma: "。",
              reading: "。",
              partOfSpeech: ["記号"],
            },
            wordState: null,
          },
        ],
      },
    ]);
    overlay.show();

    const styles = document.getElementById("subjap-overlay-styles");
    expect(styles?.textContent).toContain("align-items: flex-end");
    expect(styles?.textContent).toContain("column-gap: 0.16em");
    expect(styles?.textContent).toContain("font-size: 13px");
    expect(styles?.textContent).toContain("margin-bottom: 0.08em");
    expect(
      document.querySelector(".subjap-token--punctuation"),
    ).not.toBeNull();

    overlay.destroy();
  });

  it("positionne le conteneur sur la vidéo et réserve l’espace des contrôles", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(11, 22, 800, 400),
    );

    const overlay = new OverlayRenderer(video);
    overlay.updateCues([renderedCue()]);
    overlay.show();

    const container = document.getElementById(
      "subjap-overlay-container",
    ) as HTMLDivElement;
    expect(container.style.left).toBe("11px");
    expect(container.style.top).toBe("22px");
    expect(container.style.width).toBe("800px");
    expect(container.style.height).toBe("400px");
    expect(container.style.paddingBottom).toBe("120px");

    overlay.destroy();
  });
});
