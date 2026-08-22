import { NetflixAdapter } from "../../src/adapters/netflix";
import { OverlayRenderer } from "../../src/overlay/renderer";
import { getPopover, hidePopover, showPopover } from "../../src/overlay/popover";
import type {
  DictionaryEntry,
  RenderedCue,
  SubtitleCue,
  Token,
} from "../../src/core/types";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const nativeSubtitles = document.querySelector<HTMLDivElement>("#timedtext")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const furiganaToggle = document.querySelector<HTMLInputElement>("#furigana")!;

const adapter = new NetflixAdapter();
let overlay: OverlayRenderer | null = null;
let currentVideo: HTMLVideoElement | null = null;
let currentCues: SubtitleCue[] = [];
let knownLemmas = new Set<string>(["日本語"]);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hovered: HTMLElement | null = null;

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

function setStatus(message: string): void {
  status.textContent = message;
}

function nativeLine(text: string, start = "12", end = "16"): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  line.dataset.start = start;
  line.dataset.end = end;
  line.textContent = text;
  return line;
}

function renderedCue(cue: SubtitleCue): RenderedCue {
  return {
    cue,
    spans: tokens.map((token, index) => ({
      index,
      token,
      wordState: knownLemmas.has(token.lemma)
        ? { key: token.lemma, status: "known", source: "manual" }
        : null,
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
  const renderer = ensureOverlay();
  if (!renderer) {
    setStatus("Aucune vidéo détectée");
    return;
  }
  if (cues.length === 0) {
    renderer.updateCues([]);
    renderer.hide();
    hidePopover();
    setStatus("Cues reçus : 0 — overlay masqué");
    return;
  }
  renderer.updateCues(cues.map(renderedCue));
  renderer.show();
  setStatus(`Cues reçus : ${cues.length} — overlay visible`);
}

const popoverCallbacks = {
  onToggleKnown: (lemma: string) => {
    if (knownLemmas.has(lemma)) knownLemmas.delete(lemma);
    else knownLemmas.add(lemma);
    render(currentCues);
    setStatus(`État modifié : ${lemma}`);
  },
  onMine: (minedToken: Token) => {
    setStatus(`Mining demandé : ${minedToken.surface}`);
  },
};

function showPopoverForToken(anchor: HTMLElement, token: Token): void {
  const entry = token.lemma === dictionaryEntry.headword ? dictionaryEntry : null;
  const currentStatus = knownLemmas.has(token.lemma) ? "known" : null;
  showPopover({ anchor, token, entry, wordStatus: currentStatus });
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
  const token = tokens[Number(span.dataset.index)];
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
  const token = tokens[Number(span.dataset.index)];
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
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。"));
});

document.querySelector<HTMLButtonElement>("#clear")!.addEventListener("click", () => {
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
  const nextVideo = document.createElement("video");
  nextVideo.id = "video";
  nextVideo.setAttribute("aria-label", "Vidéo simulée remplacée");
  stage.insertBefore(nextVideo, nativeSubtitles);
  nativeSubtitles.replaceChildren(nativeLine("Lecteur remplacé, nouvelle phrase."));
  setStatus("Navigation SPA simulée : nouveau lecteur détecté");
});

furiganaToggle.addEventListener("change", () => {
  overlay?.setOptions({ showFurigana: furiganaToggle.checked });
});

getPopover(popoverCallbacks);

adapter.subscribeCues(render);
adapter.setNativeSubtitlesVisible(false);
nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。"));

window.addEventListener("beforeunload", () => {
  clearTimers();
  overlay?.destroy();
  adapter.destroy();
});
