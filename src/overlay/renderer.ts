// ---------------------------------------------------------------------------
// SubJap — vanilla-DOM subtitle overlay renderer
// ---------------------------------------------------------------------------

import type {
  OverlayOptions,
  RenderedCue,
  SpanToken,
  SubtitleCue,
} from "@/core/types";
import { DEFAULT_OPTIONS } from "@/core/options";

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
      align-items: center;
      column-gap: 0.2em;
      margin: 0;
      padding: 0;
      pointer-events: auto;
      font-size: ${opts.fontSize}px;
      font-family: ${opts.fontFamily};
      color: #ffffff;
      white-space: normal;
      overflow-wrap: break-word;
      text-shadow:
        -1px -1px 0 #000,
         1px -1px 0 #000,
        -1px  1px 0 #000,
         1px  1px 0 #000;
    }
    #${CONTAINER_ID} .subjap-cue-line + .subjap-cue-line {
      margin-top: 4px;
    }
    #${CONTAINER_ID} .subjap-token {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      cursor: pointer;
      transition: color 0.15s;
    }
    #${CONTAINER_ID} .subjap-token:hover {
      color: #facc15;
    }
    #${CONTAINER_ID} .subjap-known {
      color: ${opts.highlightKnown ? opts.knownColor : "#ffffff"};
    }
    #${CONTAINER_ID} .subjap-unknown {
      color: #ffffff;
    }
    #${CONTAINER_ID} .subjap-furigana {
      display: ${opts.showFurigana ? "block" : "none"};
      /* Furigana sits above its word, not below it. */
      order: -1;
      font-size: ${Math.round(opts.fontSize * 0.45)}px;
      line-height: 1.2;
      color: #cbd5e1;
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
  private cues: RenderedCue[] = [];
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

  /**
   * Update styling options and re-render.
   */
  setOptions(opts: Partial<OverlayOptions>): void {
    this.options = { ...this.options, ...opts };
    this.styleEl = injectStyles(this.options);
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
    span.dataset.lemma = st.token.lemma;
    span.dataset.reading = st.token.reading;
    span.dataset.surface = st.token.surface;
    span.dataset.pos = st.token.partOfSpeech.join(",");
    span.dataset.index = String(st.index);

    // Known / unknown
    if (st.wordState) {
      span.classList.add(
        st.wordState.status === "known" ? "subjap-known" : "subjap-unknown",
      );
    } else {
      span.classList.add("subjap-unknown");
    }

    // Text content
    span.textContent = st.token.surface;

    // Optionally append furigana
    if (this.options.showFurigana && st.token.reading && st.token.reading !== st.token.surface) {
      const ruby = document.createElement("span");
      ruby.className = "subjap-furigana";
      ruby.textContent = st.token.reading;
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