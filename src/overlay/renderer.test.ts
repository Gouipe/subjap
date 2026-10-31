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
        frequencyRank: 1,
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

    const overlay = new OverlayRenderer(video, { showFurigana: true });
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

  it("colore les mots inconnus selon leur rang et le vocabulaire connu", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 640, 360),
    );

    const cue = renderedCue();
    cue.spans[0]!.frequencyRank = 1;
    cue.spans[1]!.frequencyRank = 1;
    const overlay = new OverlayRenderer(video);
    overlay.setKnownWordCount(2);
    overlay.updateCues([cue]);
    overlay.show();

    const tokens = document.querySelectorAll(".subjap-token");
    expect(tokens[0]?.classList.contains("subjap-known")).toBe(true);
    expect(tokens[0]?.classList.contains("subjap-unknown--relevant")).toBe(
      false,
    );
    expect(tokens[1]?.classList.contains("subjap-unknown--relevant")).toBe(
      true,
    );

    overlay.destroy();
  });

  it("encadre le seul mot vert ou bleu quand la phrase n’a aucun orange", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    cue.spans[1]!.frequencyRank = 1;
    const overlay = new OverlayRenderer(video);
    overlay.setKnownWordCount(1);
    overlay.updateCues([cue]);

    let tokens = document.querySelectorAll(".subjap-token");
    expect(tokens[0]?.classList.contains("subjap-token--mine-candidate")).toBe(
      false,
    );
    expect(tokens[1]?.classList.contains("subjap-token--mine-candidate")).toBe(
      true,
    );
    expect(
      tokens[1]?.classList.contains("subjap-token--mine-candidate--relevant"),
    ).toBe(true);

    cue.spans.push({
      ...cue.spans[1]!,
      index: 2,
      token: {
        ...cue.spans[1]!.token,
        surface: "遠い",
        lemma: "遠い",
      },
      frequencyRank: 999,
    });
    overlay.updateCues([cue]);
    tokens = document.querySelectorAll(".subjap-token--mine-candidate");
    expect(tokens).toHaveLength(0);

    overlay.destroy();
  });

  it("ignore les tokens d’espacement pour détecter un candidat", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    cue.spans = [
      {
        ...cue.spans[0]!,
        index: 0,
        token: {
          ...cue.spans[0]!.token,
          surface: "発表",
          lemma: "発表",
          reading: "はっぴょう",
        },
        wordState: null,
        frequencyRank: 1,
      },
      {
        ...cue.spans[1]!,
        index: 1,
        token: {
          ...cue.spans[1]!.token,
          surface: " ",
          lemma: " ",
          reading: " ",
          partOfSpeech: ["記号"],
        },
        wordState: null,
        frequencyRank: undefined,
      },
    ];
    const overlay = new OverlayRenderer(video);
    overlay.setKnownWordCount(1);
    overlay.updateCues([cue]);

    expect(
      document
        .querySelector('[data-surface="発表"]')
        ?.classList.contains("subjap-token--mine-candidate"),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-surface=" "]')
        ?.classList.contains("subjap-token--punctuation"),
    ).toBe(true);

    overlay.destroy();
  });

  it("affiche les états Anki explicites en violet, orange et blanc", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    const first = cue.spans[0];
    const second = cue.spans[1];
    if (!first || !second) throw new Error("Expected fixture spans");
    cue.spans = [
      { ...first, wordState: { key: "a", status: "learning", source: "import" } },
      { ...second, wordState: { key: "b", status: "unknown", source: "import" } },
      { ...second, wordState: { key: "c", status: "ignored", source: "import" } },
    ];
    const overlay = new OverlayRenderer(video);
    overlay.updateCues([cue]);
    const tokens = document.querySelectorAll(".subjap-token");
    expect(tokens[0]?.classList.contains("subjap-learning")).toBe(true);
    expect(tokens[1]?.classList.contains("subjap-unknown")).toBe(true);
    expect(tokens[2]?.classList.contains("subjap-known")).toBe(true);
    overlay.destroy();
  });

  it("masque la traduction quand tous les mots lexicaux sont connus", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    cue.spans[1]!.wordState = {
      key: "を",
      status: "ignored",
      source: "manual",
    };
    cue.spans.push({
      index: 2,
      token: {
        surface: "。",
        lemma: "。",
        reading: "。",
        partOfSpeech: ["記号"],
      },
      wordState: null,
    });
    const parentheticalCue: RenderedCue = {
      cue: {
        id: "fixture-2",
        start: 3,
        end: 5,
        text: "（注釈）",
      },
      spans: [
        {
          index: 3,
          token: {
            surface: "注釈",
            lemma: "注釈",
            reading: "ちゅうしゃく",
            partOfSpeech: ["名詞"],
          },
          wordState: null,
          isParenthetical: true,
        },
      ],
    };
    const overlay = new OverlayRenderer(video, {
      knownSentenceSubtitles: "hide-translation",
    });
    overlay.updateContent(
      [cue, parentheticalCue],
      { text: "Known sentence", language: "en" },
      0,
    );

    expect(document.querySelector(".subjap-translation-line")).toBeNull();
    overlay.destroy();
  });

  it("conserve la traduction si un mot lexical reste à apprendre", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const overlay = new OverlayRenderer(video, {
      knownSentenceSubtitles: "hide-translation",
    });
    overlay.updateContent(
      [renderedCue()],
      { text: "Sentence to keep", language: "fr" },
      0,
    );

    expect(document.querySelector(".subjap-translation-line")?.textContent).toBe(
      "Sentence to keep",
    );
    overlay.destroy();
  });

  it("réaffiche immédiatement la traduction quand le réglage est désactivé", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    cue.spans[1]!.wordState = {
      key: "を",
      status: "ignored",
      source: "manual",
    };
    const overlay = new OverlayRenderer(video, {
      knownSentenceSubtitles: "hide-translation",
    });
    overlay.updateContent([cue], { text: "Sentence", language: "fr" }, 0);
    overlay.setOptions({ knownSentenceSubtitles: "show" });

    expect(document.querySelector(".subjap-translation-line")?.textContent).toBe(
      "Sentence",
    );
    overlay.destroy();
  });

  it("affiche les lectures UniDic en hiragana", () => {
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

  it("n’ajoute pas de furigana au-dessus d’un token entièrement en hiragana", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const video = document.createElement("video");
    document.body.appendChild(video);
    const cue = renderedCue();
    cue.spans = [
      {
        ...cue.spans[0]!,
        token: {
          ...cue.spans[0]!.token,
          surface: "てんだ",
          reading: "てるのだ",
        },
      },
      {
        ...cue.spans[0]!,
        index: 1,
        token: {
          ...cue.spans[0]!.token,
          surface: "コイツ",
          reading: "こいつ",
        },
      },
    ];
    const overlay = new OverlayRenderer(video, { showFurigana: true });
    overlay.updateCues([cue]);

    expect(
      document.querySelector('[data-surface="てんだ"] .subjap-furigana'),
    ).toBeNull();
    expect(
      document.querySelector('[data-surface="コイツ"] .subjap-furigana')?.textContent,
    ).toBe("こいつ");

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
    expect(styles?.textContent).toContain("vertical-align: bottom");
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
