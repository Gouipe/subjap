// ---------------------------------------------------------------------------
// SubJap — vanilla-DOM subtitle overlay renderer
// ---------------------------------------------------------------------------

import type {
  OverlayOptions,
  RenderedCue,
  SpanToken,
  SubtitleCue,
  SubtitleTranslation,
} from "@/core/types";
import { DEFAULT_OPTIONS } from "@/core/options";
import { toHiragana } from "@/core/kana";
import { getFrequencyHighlight } from "@/core/frequency";

const CONTAINER_ID = "subjap-overlay-container";
const STYLE_ID = "subjap-overlay-styles";

// ── CSS ───────────────────────────────────────────────────────────────────

function injectStyles(opts: OverlayOptions): HTMLStyleElement {
  // Remove any previous injected style
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${CONTAINER_ID} {
      position: fixed;
      pointer-events: none;
      z-index: 2147483646;
      overflow: visible;
      line-height: 1.6;
      user-select: text;
      /* The container exactly covers the video; cue lines are bottom-anchored
         (justify-content: flex-end) with a padding-bottom inset so the text
         clears the platform's bottom control bar instead of sliding under it. */
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
    }
    #${CONTAINER_ID} .subjap-cue-line {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: flex-end;
      column-gap: 0.16em;
      margin: 0;
      padding: 0.08em 0.16em 0.12em;
      pointer-events: auto;
      font-size: ${opts.fontSize}px;
      font-family: ${opts.fontFamily};
      color: #ffffff;
      white-space: normal;
      overflow-wrap: break-word;
      text-shadow:
        0 2px 4px rgba(0, 0, 0, 0.95),
        0 0 1px #000,
        0 0 8px rgba(0, 0, 0, 0.55);
    }
    #${CONTAINER_ID} .subjap-cue-line + .subjap-cue-line {
      margin-top: 4px;
    }
    #${CONTAINER_ID} .subjap-translation-line {
      margin-top: 5px;
      padding: 0.08em 0.3em 0.12em;
      pointer-events: none;
      font-size: ${Math.round(opts.fontSize * 0.72)}px;
      font-family: ${opts.fontFamily};
      color: #e2e8f0;
      line-height: 1.35;
      white-space: pre-wrap;
      text-shadow:
        0 2px 4px rgba(0, 0, 0, 0.95),
        0 0 1px #000,
        0 0 8px rgba(0, 0, 0, 0.55);
    }
    #${CONTAINER_ID} .subjap-token {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      white-space: nowrap;
      padding-inline: 0.02em;
      cursor: pointer;
      border-radius: 0.16em;
      transition: color 0.15s, background-color 0.15s;
    }
    #${CONTAINER_ID} .subjap-token:hover {
      color: #facc15;
      background-color: rgba(250, 204, 21, 0.16);
    }
    #${CONTAINER_ID} .subjap-token--punctuation {
      margin-left: -0.16em;
    }
    #${CONTAINER_ID} .subjap-known {
      color: #ffffff;
    }
    #${CONTAINER_ID} .subjap-unknown {
      color: #fb923c;
    }
    #${CONTAINER_ID} .subjap-unknown--relevant {
      color: ${opts.highlightKnown ? opts.knownColor : "#22c55e"};
    }
    #${CONTAINER_ID} .subjap-unknown--near {
      color: #60a5fa;
    }
    #${CONTAINER_ID} .subjap-learning {
      color: #c084fc;
    }
    #${CONTAINER_ID} .subjap-neutral {
      color: #ffffff;
    }
    #${CONTAINER_ID} .subjap-furigana {
      display: ${opts.showFurigana ? "block" : "none"};
      /* Furigana sits above its word, not below it. */
      order: -1;
      font-size: ${Math.round(opts.fontSize * 0.45)}px;
      line-height: 1;
      margin-bottom: 0.08em;
      color: #e2e8f0;
      font-weight: 500;
      white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 1px #000;
    }
  `;
  document.head.appendChild(style);
  return style;
}

// ── Class ─────────────────────────────────────────────────────────────────

export class OverlayRenderer {
  private container: HTMLDivElement;
  private video: HTMLVideoElement;
  private options: OverlayOptions;
  private knownWordCount = 0;
  private cues: RenderedCue[] = [];
  private translation: SubtitleTranslation | null = null;
  private styleEl: HTMLStyleElement;
  private rafId: number | null = null;
  private visible = false;

  constructor(video: HTMLVideoElement, options?: Partial<OverlayOptions>) {
    this.video = video;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Inject/update styles
    this.styleEl = injectStyles(this.options);

    // Create container
    this.container = document.createElement("div");
    this.container.id = CONTAINER_ID;
    // Mount inside the video's parent so it scrolls/resizes with the layout
    this.mountContainer();

    // Start the reposition loop
    this.startRepositionLoop();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Show the overlay (make it visible). */
  show(): void {
    this.visible = true;
    this.container.style.display = "";
    this.syncPosition();
  }

  /** Hide the overlay. */
  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  /**
   * Replace the current cues and re-render.
   * Pass an empty array to clear the overlay.
   */
  updateCues(cues: RenderedCue[]): void {
    this.cues = cues;
    this.render();
  }

  updateTranslation(translation: SubtitleTranslation | null): void {
    this.translation = translation;
    this.render();
  }

  /**
   * Update styling options and re-render.
   */
  setOptions(opts: Partial<OverlayOptions>): void {
    this.options = { ...this.options, ...opts };
    this.styleEl = injectStyles(this.options);
    this.render();
  }

  /** Update the learner vocabulary size used by frequency highlighting. */
  setKnownWordCount(count: number): void {
    this.knownWordCount = Math.max(0, Math.floor(count));
    this.render();
  }

  /** Tear down the overlay completely: cancel animation, remove DOM nodes. */
  destroy(): void {
    this.stopRepositionLoop();
    this.container.remove();
    this.styleEl.remove();
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private render(): void {
    // Clear container
    this.container.replaceChildren();

    if (this.cues.length === 0) return;

    for (const rc of this.cues) {
      const line = this.buildCueLine(rc);
      this.container.appendChild(line);
    }
    if (this.translation) {
      const line = document.createElement("div");
      line.className = "subjap-translation-line";
      line.lang = this.translation.language;
      line.dataset.language = this.translation.language;
      line.textContent = this.translation.text;
      this.container.appendChild(line);
    }

    // Re-sync position after render
    if (this.visible) this.syncPosition();
  }

  private buildCueLine(rc: RenderedCue): HTMLDivElement {
    const line = document.createElement("div");
    line.className = "subjap-cue-line";

    for (const st of rc.spans) {
      const span = this.buildTokenSpan(st);
      line.appendChild(span);
    }

    return line;
  }

  private buildTokenSpan(st: SpanToken): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "subjap-token";
    const isPunctuation =
      st.token.partOfSpeech.includes("記号") ||
      /^[、。！？!?.,，．：；「」『』（）()…]+$/.test(st.token.surface);
    if (isPunctuation) {
      span.classList.add("subjap-token--punctuation");
    }
    const reading = toHiragana(st.token.reading);
    span.dataset.lemma = st.token.lemma;
    span.dataset.reading = reading;
    span.dataset.surface = st.token.surface;
    span.dataset.pos = st.token.partOfSpeech.join(",");
    span.dataset.index = String(st.index);

    if (isPunctuation) {
      span.classList.add("subjap-neutral");
    } else {
      const highlight = getFrequencyHighlight(
        st.wordState,
        st.frequencyRank,
        this.knownWordCount,
        st.ankiNoteCount,
      );
      if (highlight === "known" || highlight === "ignored") {
        span.classList.add("subjap-known");
      } else if (highlight === "learning") {
        span.classList.add("subjap-learning");
      } else {
        span.classList.add("subjap-unknown");
        if (highlight === "relevant") {
          span.classList.add("subjap-unknown--relevant");
        } else if (highlight === "near") {
          span.classList.add("subjap-unknown--near");
        }
      }
    }

    // Text content
    span.textContent = st.token.surface;

    // Optionally append furigana
    if (this.options.showFurigana && reading && reading !== st.token.surface) {
      const ruby = document.createElement("span");
      ruby.className = "subjap-furigana";
      ruby.textContent = reading;
      span.appendChild(ruby);
    }

    return span;
  }

  // ── Mounting ──────────────────────────────────────────────────────────

  private mountContainer(): void {
    // Mount on document.body so the overlay escapes the platform player's own
    // stacking contexts. An in-player mount can be trapped under transparent
    // platform layers (e.g. Netflix's control backdrop), which would paint over
    // it and swallow pointer events — the overlay stays visible but dead.
    document.body.appendChild(this.container);
  }

  // ── Positioning ───────────────────────────────────────────────────────

  private syncPosition(): void {
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // video not laid out yet

    // The container is position: fixed → viewport coordinates map directly
    // from getBoundingClientRect(); no offset-parent math needed.
    this.container.style.left = `${rect.left}px`;
    this.container.style.top = `${rect.top}px`;
    this.container.style.width = `${rect.width}px`;

    // Cover the video exactly and bottom-anchor the cue lines (the container is
    // display:flex + justify-content:flex-end). The padding-bottom inset keeps
    // the text above the platform's bottom control bar — Netflix's bar overlays
    // the bottom ~10-13% of the player — while growing upward for taller text.
    this.container.style.height = `${rect.height}px`;
    this.container.style.paddingTop = "0";
    this.container.style.paddingBottom = `${Math.max(120, rect.height * 0.13)}px`;
  }

  private startRepositionLoop(): void {
    let lastCheck = 0;
    const loop = (_timestamp: number) => {
      if (_timestamp - lastCheck > 200) {
        // throttle to ~5fps for reposition checks
        lastCheck = _timestamp;
        if (this.visible) this.syncPosition();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopRepositionLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────

/**
 * Quick helper: create an overlay for a set of raw cues (no token data).
 * Useful for testing / placeholder before the tokenizer pipeline is wired.
 */
export function createPlaceholderOverlay(
  video: HTMLVideoElement,
  cues: SubtitleCue[],
  options?: Partial<OverlayOptions>,
): OverlayRenderer {
  const rendered: RenderedCue[] = cues.map((cue) => ({
    cue,
    spans: cue.text.split(/(\s+)/g).map((chunk, i) => {
      const trimmed = chunk.trim();
      if (trimmed.length === 0) {
        return {
          index: i,
          token: {
            surface: chunk,
            lemma: chunk,
            reading: chunk,
            partOfSpeech: [],
          },
          wordState: null,
        } satisfies SpanToken;
      }
      return {
        index: i,
        token: {
          surface: trimmed,
          lemma: trimmed,
          reading: trimmed,
          partOfSpeech: [],
        },
        wordState: null,
      } satisfies SpanToken;
    }),
  }));

  const overlay = new OverlayRenderer(video, options);
  overlay.updateCues(rendered);
  overlay.show();
  return overlay;
}
