import { NetflixAdapter } from "../../src/adapters/netflix";
import { OverlayRenderer } from "../../src/overlay/renderer";
import { getPopover, hidePopover, showPopover } from "../../src/overlay/popover";
import {
  CueNavigator,
  installPlaybackShortcuts,
  installSubtitleCopyShortcut,
  subtitleTextForClipboard,
} from "../../src/content/shortcuts";
import { MiningModal } from "../../src/mining/modal";
import { groupTokens } from "../../src/tokenizer/group";
import type {
  DictionaryEntry,
  RenderedCue,
  SubtitleCue,
  SubtitleTranslation,
  Token,
} from "../../src/core/types";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const nativeSubtitles = document.querySelector<HTMLDivElement>("#timedtext")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const furiganaToggle = document.querySelector<HTMLInputElement>("#furigana")!;

const fixtureSeekTransport = {
  seek: async (timeSeconds: number, resume: boolean): Promise<boolean> => {
    const video = document.querySelector<HTMLVideoElement>("#video");
    if (!video || !Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return false;
    }
    video.currentTime = timeSeconds;
    if (resume) await video.play();
    return true;
  },
};

const adapter = new NetflixAdapter(fixtureSeekTransport);
const cueNavigator = new CueNavigator();
let overlay: OverlayRenderer | null = null;
let currentVideo: HTMLVideoElement | null = null;
let currentCues: SubtitleCue[] = [];
let currentTranslation: SubtitleTranslation | null = null;
// One known word gives deterministic green/blue/orange frequency bands.
let knownLemmas = new Set<string>(["日本語"]);
let ignoredLemmas = new Set<string>();
const frequencyRanks = new Map<string, number>([
  ["日本語", 1],
  ["を", 2],
  ["勉強", 1],
  ["する", 3],
  ["し", 3],
  ["ます", 500],
]);
const ankiNoteCounts = new Map<string, number>([["勉強", 2]]);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hovered: HTMLElement | null = null;
let miningModal: MiningModal | null = null;
let nextRenderDelayMs = 0;

const dictionaryEntry: DictionaryEntry = {
  headword: "日本語",
  reading: "ニホンゴ",
  partOfSpeech: ["名詞"],
  senses: [{ glosses: ["Japanese language"] }],
  common: true,
};

const tokens: Token[] = [
  { surface: "日本語", lemma: "日本語", reading: "ニホンゴ", partOfSpeech: ["名詞"] },
  { surface: "を", lemma: "を", reading: "を", partOfSpeech: ["助詞"] },
  { surface: "勉強", lemma: "勉強", reading: "ベンキョウ", partOfSpeech: ["名詞"] },
  { surface: "し", lemma: "する", reading: "し", partOfSpeech: ["動詞"] },
  { surface: "ます", lemma: "ます", reading: "ます", partOfSpeech: ["助動詞"] },
  { surface: "。", lemma: "。", reading: "。", partOfSpeech: ["記号"] },
];
let activeTokens: Token[] = [];

const groupedTokens = groupTokens([
  { surface: "じゃ", lemma: "だ", reading: "じゃ", partOfSpeech: ["助動詞"] },
  { surface: "なくっ", lemma: "ない", reading: "なくっ", partOfSpeech: ["形容詞"] },
  { surface: "て", lemma: "て", reading: "て", partOfSpeech: ["助詞"] },
]);

const explanatoryTokens = groupTokens([
  { surface: "孫", lemma: "孫", reading: "まご", partOfSpeech: ["名詞"] },
  { surface: "な", lemma: "だ", reading: "な", partOfSpeech: ["助動詞"] },
  { surface: "ん", lemma: "ん", reading: "ん", partOfSpeech: ["名詞"] },
  { surface: "です", lemma: "です", reading: "です", partOfSpeech: ["助動詞"] },
]);

function installSimulatedMediaClock(video: HTMLVideoElement): void {
  let currentTime = 0;
  let paused = true;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    },
    paused: { configurable: true, get: () => paused },
  });
  video.play = () => {
    paused = false;
    return Promise.resolve();
  };
  video.pause = () => {
    paused = true;
  };
}

function setStatus(message: string): void {
  status.textContent = message;
}

function nativeLine(
  text: string,
  start: string | null = "12",
  end: string | null = "16",
): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  if (start !== null) line.dataset.start = start;
  if (end !== null) line.dataset.end = end;
  line.textContent = text;
  return line;
}

function renderedCue(cue: SubtitleCue): RenderedCue {
  return {
    cue,
    spans: activeTokens.map((token, index) => ({
      index,
      token,
      wordState: ignoredLemmas.has(token.lemma)
        ? { key: token.lemma, status: "ignored", source: "manual" }
        : knownLemmas.has(token.lemma)
          ? { key: token.lemma, status: "known", source: "manual" }
          : token.lemma === "を"
            ? { key: token.lemma, status: "unknown", source: "import" }
          : token.lemma === "する"
            ? { key: token.lemma, status: "learning", source: "import" }
            : null,
      ankiNoteCount: ankiNoteCounts.get(token.lemma) ?? 0,
      frequencyRank: frequencyRanks.get(token.lemma),
    })),
  };
}

function ensureOverlay(): OverlayRenderer | null {
  const video = adapter.getVideoElement();
  if (!video) return null;

  if (overlay && currentVideo !== video) {
    overlay.destroy();
    overlay = null;
  }
  if (!overlay) {
    overlay = new OverlayRenderer(video, {
      showFurigana: furiganaToggle.checked,
      highlightKnown: true,
    });
    currentVideo = video;
  }
  return overlay;
}

function render(cues: SubtitleCue[]): void {
  currentCues = cues;
  const japaneseCues = cues.filter((cue) => /^ja(?:[-_]|$)/i.test(cue.language ?? ""));
  status.dataset.cue = japaneseCues[0]?.text ?? "";
  status.dataset.cueStart = String(japaneseCues[0]?.start ?? "");
  status.dataset.knownCount = String(knownLemmas.size);
  const renderer = ensureOverlay();
  if (!renderer) {
    setStatus("Aucune vidéo détectée");
    return;
  }
  if (japaneseCues.length === 0) {
    renderer.updateCues([]);
    renderer.updateTranslation(null);
    renderer.hide();
    hidePopover();
    cueNavigator.observe([]);
    setStatus("Cues reçus : 0 — overlay masqué");
    return;
  }
  renderer.setKnownWordCount(knownLemmas.size);
  renderer.updateCues(japaneseCues.map(renderedCue));
  renderer.updateTranslation(currentTranslation);
  renderer.show();
  cueNavigator.observe(japaneseCues);
  setStatus(`Cues reçus : ${japaneseCues.length} — overlay visible`);
}

const popoverCallbacks = {
  onToggleKnown: (lemma: string) => {
    ignoredLemmas.delete(lemma);
    if (knownLemmas.has(lemma)) knownLemmas.delete(lemma);
    else knownLemmas.add(lemma);
    render(currentCues);
    setStatus(`État modifié : ${lemma}`);
  },
  onToggleIgnored: (lemma: string, currentStatus: string | null) => {
    if (currentStatus === "ignored") {
      ignoredLemmas.delete(lemma);
    } else {
      knownLemmas.delete(lemma);
      ignoredLemmas.add(lemma);
    }
    render(currentCues);
    setStatus(`État modifié : ${lemma}`);
  },
  onMine: (minedToken: Token) => {
    setStatus(`Mining demandé : ${minedToken.surface}`);
  },
};

function showPopoverForToken(anchor: HTMLElement, token: Token): void {
  const entry = token.lemma === dictionaryEntry.headword ? dictionaryEntry : null;
  const currentStatus = ignoredLemmas.has(token.lemma)
    ? "ignored"
    : knownLemmas.has(token.lemma)
      ? "known"
      : token.lemma === "を"
        ? "unknown"
        : token.lemma === "する"
          ? "learning"
          : null;
  const frequencyRank = frequencyRanks.get(token.lemma);
  showPopover({
    anchor,
    token,
    entry,
    wordStatus: currentStatus,
    frequencyRank,
    ankiNoteCount: ankiNoteCounts.get(token.lemma) ?? 0,
  });
}

function clearTimers(): void {
  if (hoverTimer !== null) clearTimeout(hoverTimer);
  if (hideTimer !== null) clearTimeout(hideTimer);
  hoverTimer = null;
  hideTimer = null;
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const span = target.closest<HTMLElement>(".subjap-token");
  if (!span) return;
  const token = activeTokens[Number(span.dataset.index)];
  if (token) {
    clearTimers();
    showPopoverForToken(span, token);
  }
}, true);

document.addEventListener("mouseover", (event) => {
  const target = event.target as HTMLElement;
  const span = target.closest<HTMLElement>(".subjap-token");
  if (!span) return;
  clearTimers();
  hovered = span;
  const token = activeTokens[Number(span.dataset.index)];
  if (!token) return;
  hoverTimer = setTimeout(() => {
    if (hovered === span) showPopoverForToken(span, token);
  }, 350);
}, true);

document.addEventListener("mouseout", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest(".subjap-token")) return;
  const related = event.relatedTarget as Node | null;
  if (related instanceof Element && related.closest(".subjap-token, #subjap-popover")) return;
  if (hoverTimer !== null) clearTimeout(hoverTimer);
  hideTimer = setTimeout(() => hidePopover(), 200);
}, true);

document.querySelector<HTMLButtonElement>("#next")!.addEventListener("click", () => {
  activeTokens = tokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。"));
});

document.querySelector<HTMLButtonElement>("#bilingual")!.addEventListener("click", () => {
  activeTokens = tokens;
  currentTranslation = { language: "fr", text: "J’étudie le japonais." };
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#untimed")!.addEventListener("click", () => {
  activeTokens = tokens;
  nativeSubtitles.replaceChildren(
    nativeLine("日本語を勉強します。", null, null),
  );
});

document.querySelector<HTMLButtonElement>("#multiline")!.addEventListener("click", () => {
  activeTokens = tokens;
  nativeSubtitles.replaceChildren(
    nativeLine("日本語を", "20", "24"),
    nativeLine("勉強します。", "20", "24"),
  );
});

document.querySelector<HTMLButtonElement>("#rolling")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;
  video.currentTime = 40;
  nativeSubtitles.replaceChildren(
    nativeLine("生徒が起こした騒動については", null, null),
  );
  setTimeout(() => {
    video.currentTime = 42;
    nativeSubtitles.replaceChildren(
      nativeLine("生徒が起こした騒動については", null, null),
      nativeLine("不問ということにいたしましょう", null, null),
    );
  }, 100);
  setTimeout(() => {
    video.currentTime = 44;
    nativeSubtitles.replaceChildren(
      nativeLine("不問ということにいたしましょう", null, null),
    );
  }, 200);
});

document.querySelector<HTMLButtonElement>("#seek-rebuild")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  // Netflix can briefly remove and recreate one logical cue around a seek.
  // The two DOM builds differ only by presentation whitespace.
  video.currentTime = 50;
  nativeSubtitles.replaceChildren(nativeLine("本当の前の字幕", "50", "52"));
  setTimeout(() => {
    video.currentTime = 59.55;
    nativeSubtitles.replaceChildren(
      nativeLine("（篠原 ）でも すごいですね", null, null),
    );
  }, 100);
  setTimeout(() => {
    video.currentTime = 59.7;
    nativeSubtitles.replaceChildren();
  }, 200);
  setTimeout(() => {
    video.currentTime = 59.85;
    nativeSubtitles.replaceChildren(
      nativeLine("（篠原）でも すごいですね", null, null),
    );
  }, 300);
  setTimeout(() => {
    video.currentTime = 60.5;
    nativeSubtitles.replaceChildren();
  }, 400);
  setTimeout(() => {
    video.currentTime = 61;
    nativeSubtitles.replaceChildren(nativeLine("教育シンポジウムです", "61", "64"));
  }, 500);
});

document.querySelector<HTMLButtonElement>("#delayed")!.addEventListener("click", () => {
  activeTokens = tokens;
  nextRenderDelayMs = 400;
  nativeSubtitles.replaceChildren(
    nativeLine("遅れて表示される字幕", "20", "24"),
  );
});

document.querySelector<HTMLButtonElement>("#grouped")!.addEventListener("click", () => {
  activeTokens = groupedTokens;
  nativeSubtitles.replaceChildren(nativeLine("じゃなくって", "16", "20"));
});

document.querySelector<HTMLButtonElement>("#explanatory")!.addEventListener("click", () => {
  activeTokens = explanatoryTokens;
  nativeSubtitles.replaceChildren(nativeLine("孫なんです", "20", "24"));
});

document.querySelector<HTMLButtonElement>("#mine")!.addEventListener("click", () => {
  const video = adapter.getVideoElement();
  const cue = currentCues[0];
  if (!video || !cue || activeTokens.length === 0) return;

  const rendered = renderedCue(cue);
  miningModal?.destroy();
  miningModal = new MiningModal(video);
  miningModal.open({
    cue: rendered,
    targetToken: rendered.spans[0],
    lemmaReading: rendered.spans[0].token.reading,
    episodeContext: {
      platform: "fixture",
      title: "Fixture episode",
      language: "ja",
      url: window.location.href,
    },
    definitions: ["fixture definition"],
  });
});

document.querySelector<HTMLButtonElement>("#clear")!.addEventListener("click", () => {
  currentTranslation = null;
  nativeSubtitles.replaceChildren();
});

document.querySelector<HTMLButtonElement>("#toggle-native")!.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const hidden = button.dataset.hidden !== "true";
  adapter.setNativeSubtitlesVisible(!hidden);
  button.dataset.hidden = String(hidden);
  button.textContent = hidden ? "Afficher les natifs" : "Masquer les natifs";
  setStatus(`Sous-titres natifs : ${hidden ? "masqués" : "visibles"}`);
});

document.querySelector<HTMLButtonElement>("#swap")!.addEventListener("click", () => {
  const oldVideo = document.querySelector("#video");
  oldVideo?.remove();
  cueNavigator.reset();
  const nextVideo = document.createElement("video");
  nextVideo.id = "video";
  nextVideo.setAttribute("aria-label", "Vidéo simulée remplacée");
  installSimulatedMediaClock(nextVideo);
  stage.insertBefore(nextVideo, nativeSubtitles);
  nativeSubtitles.replaceChildren(nativeLine("Lecteur remplacé, nouvelle phrase."));
  setStatus("Navigation SPA simulée : nouveau lecteur détecté");
});

furiganaToggle.addEventListener("change", () => {
  overlay?.setOptions({ showFurigana: furiganaToggle.checked });
});

getPopover(popoverCallbacks);
const removePlaybackShortcuts = installPlaybackShortcuts(document, adapter, cueNavigator);
const removeSubtitleCopyShortcut = installSubtitleCopyShortcut(document, {
  getText: () =>
    subtitleTextForClipboard(
      currentCues.filter((cue) => /^ja(?:[-_]|$)/i.test(cue.language ?? "")),
    ),
});
installSimulatedMediaClock(document.querySelector<HTMLVideoElement>("#video")!);

adapter.subscribeCues((cues) => {
  const delay = cues.length > 0 ? nextRenderDelayMs : 0;
  nextRenderDelayMs = 0;
  if (delay > 0) {
    setTimeout(() => render(cues), delay);
    return;
  }
  render(cues);
});
adapter.setNativeSubtitlesVisible(false);
nativeSubtitles.replaceChildren(nativeLine("待ってください。", "0", "4"));

window.addEventListener("beforeunload", () => {
  clearTimers();
  removePlaybackShortcuts();
  removeSubtitleCopyShortcut();
  overlay?.destroy();
  miningModal?.destroy();
  adapter.destroy();
});
