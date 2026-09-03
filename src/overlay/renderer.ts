// ---------------------------------------------------------------------------
// SubJap — vanilla-DOM subtitle overlay renderer
// ---------------------------------------------------------------------------

import { tokenCanonicalKey } from "@/core/types";
import type {
  OverlayOptions,
  RenderedCue,
  SpanToken,
  SubtitleCue,
  SubtitleTranslation,
} from "@/core/types";
import { DEFAULT_OPTIONS } from "@/core/options";
import { containsKanjiOrKatakana, toHiragana } from "@/core/kana";
import {
  getFrequencyHighlight,
  isJapaneseOnlyEligible,
  isNonLexicalToken,
  isSingleMiningCandidate,
  type FrequencyHighlight,
} from "@/core/frequency";

const CONTAINER_ID = "subjap-overlay-container";
const STYLE_ID = "subjap-overlay-styles";
type MiningCandidateHighlight = "relevant" | "near";

// ── CSS ───────────────────────────────────────────────────────────────────

function injectStyles(opts: OverlayOptions): HTMLStyleElement {
  // Remove any previous injected style
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${CONTAINER_ID} {
      --sj-canvas: #0c0d10;
      --sj-text: #f4f1ea;
      --sj-muted: #b2b6bf;
      --sj-accent: #ff624d;
      --sj-learning: #aab3ff;
      --sj-priority-high: #78d6a3;
      --sj-priority-mid: #73b9f8;
      --sj-priority-low: #f1b46d;
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
      color: var(--sj-text);
      background-color: rgba(12, 13, 16, 0.82);
      border-radius: 0.18em;
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
    #${CONTAINER_ID} .subjap-cue-line--pending {
      pointer-events: none;
    }
    #${CONTAINER_ID} .subjap-translation-line {
      /* Keep the secondary language attached to the Japanese subtitle block
         instead of letting a long translation feel detached from it. */
      align-self: center;
      width: fit-content;
      max-width: 95%;
      margin-top: 0.16em;
      padding: 0.08em 0.3em 0.12em;
      pointer-events: none;
      font-size: ${Math.round(opts.fontSize * 0.72)}px;
      font-family: ${opts.fontFamily};
      color: var(--sj-muted);
      line-height: 1.3;
      text-align: center;
      white-space: normal;
      overflow-wrap: break-word;
      text-shadow:
        0 2px 4px rgba(0, 0, 0, 0.95),
        0 0 1px #000,
        0 0 8px rgba(0, 0, 0, 0.55);
    }
    #${CONTAINER_ID} .subjap-translation-line--hidden {
      opacity: 0;
      cursor: default;
      pointer-events: auto;
      transition: opacity 0.12s ease;
    }
    #${CONTAINER_ID} .subjap-translation-line--hidden:hover {
      opacity: 1;
    }
    #${CONTAINER_ID} .subjap-translation-line--exercise-hidden,
    #${CONTAINER_ID} .subjap-translation-line--exercise-hidden:hover {
      opacity: 0;
      pointer-events: none;
    }
    #${CONTAINER_ID} .subjap-subtitles--hidden {
      visibility: hidden;
    }
    #${CONTAINER_ID} .subjap-token {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      white-space: nowrap;
      padding-inline: 0.02em;
      cursor: pointer;
      border-bottom: 0.08em solid transparent;
      border-radius: 0.16em;
      transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1), background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate {
      /* Keep the signal local to the word while making it unmistakable. An
         outline does not change the phrase layout like a border would. */
      position: relative;
      z-index: 0;
      outline: 2px solid transparent;
      outline-offset: 2px;
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate--relevant {
      outline-color: ${opts.highlightKnown ? opts.knownColor : "#78d6a3"};
      background-color: rgba(120, 214, 163, 0.16);
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate--near {
      outline-color: var(--sj-priority-mid);
      background-color: rgba(115, 185, 248, 0.16);
    }
    #${CONTAINER_ID} .subjap-token:not(.subjap-token--parenthetical):hover {
      background-color: rgba(244, 241, 234, 0.14);
    }
    #${CONTAINER_ID} .subjap-token:not(.subjap-token--parenthetical):focus-visible {
      outline: 2px solid var(--sj-accent);
      outline-offset: 2px;
      background-color: rgba(244, 241, 234, 0.14);
    }
    #${CONTAINER_ID} .subjap-token--punctuation {
      margin-left: -0.16em;
    }
    #${CONTAINER_ID} .subjap-known {
      color: var(--sj-text);
      border-bottom-color: transparent;
    }
    #${CONTAINER_ID} .subjap-unknown {
      color: var(--sj-priority-low);
      border-bottom-color: currentColor;
      border-bottom-style: dotted;
    }
    #${CONTAINER_ID} .subjap-unknown--relevant {
      color: ${opts.highlightKnown ? opts.knownColor : "#78d6a3"};
      border-bottom-style: solid;
    }
    #${CONTAINER_ID} .subjap-unknown--near {
      color: var(--sj-priority-mid);
      border-bottom-style: dashed;
    }
    #${CONTAINER_ID} .subjap-learning {
      color: var(--sj-learning);
      border-bottom-color: currentColor;
      border-bottom-style: double;
    }
    #${CONTAINER_ID} .subjap-neutral {
      color: var(--sj-text);
      border-bottom-color: transparent;
    }
    #${CONTAINER_ID} .subjap-token--parenthetical,
    #${CONTAINER_ID} .subjap-token--parenthetical:hover {
      color: var(--sj-muted);
      opacity: 0.7;
      cursor: default;
      pointer-events: none;
    }
    #${CONTAINER_ID} .subjap-token--parenthetical .subjap-furigana {
      color: var(--sj-muted);
    }
    #${CONTAINER_ID} .subjap-furigana {
      display: ${opts.showFurigana ? "block" : "none"};
      /* Furigana sits above its word, not below it. */
      order: -1;
      font-size: ${Math.round(opts.fontSize * 0.45)}px;
      line-height: 1;
      margin-bottom: 0.08em;
      color: var(--sj-muted);
      font-weight: 500;
      white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 1px #000;
    }
    @media (prefers-reduced-motion: reduce) {
      #${CONTAINER_ID} .subjap-token,
      #${CONTAINER_ID} .subjap-translation-line--hidden {
        transition: none;
      }
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
  private pendingCueTexts: string[] | null = null;
  private translation: SubtitleTranslation | null = null;
  private styleEl: HTMLStyleElement;
  private rafId: number | null = null;
  private visible = false;
  private subtitleVisibilityOverride: {
    japanese: boolean;
    /** null keeps the normal translation mode (including hover-to-reveal). */
    translation: boolean | null;
  } | null = null;

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

  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Show the overlay (make it visible). */
  show(): void {
    this.visible = true;
    this.container.style.display = "";
    this.syncPosition();
    this.startRepositionLoop();
  }

  /** Hide the overlay. */
  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
    this.stopRepositionLoop();
  }

  /** Update all render inputs in one DOM pass. */
  updateContent(
    cues: RenderedCue[],
    translation: SubtitleTranslation | null,
    knownWordCount: number,
  ): void {
    this.cues = cues;
    this.pendingCueTexts = null;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.render();
  }

  /** Show cue text immediately while tokenisation/enrichment catches up. */
  updatePendingContent(
    cueTexts: string[],
    translation: SubtitleTranslation | null,
    knownWordCount: number,
  ): void {
    this.cues = [];
    this.pendingCueTexts = cueTexts;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.render();
  }

  /**
   * Replace the current cues and re-render.
   * Pass an empty array to clear the overlay.
   */
  updateCues(cues: RenderedCue[]): void {
    this.cues = cues;
    this.pendingCueTexts = null;
    this.render();
  }

  updateTranslation(translation: SubtitleTranslation | null): void {
    this.translation = translation;
    this.render();
  }

  /** Temporarily hide/reveal the two subtitle layers without changing options. */
  setSubtitleVisibility(japanese: boolean, translation: boolean | null): void {
    this.subtitleVisibilityOverride = { japanese, translation };
    this.render();
  }

  /** Restore the normal visibility rules after an exercise ends. */
  clearSubtitleVisibilityOverride(): void {
    this.subtitleVisibilityOverride = null;
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

    if (this.cues.length === 0 && !this.pendingCueTexts?.length) return;

    if (this.pendingCueTexts?.length) {
      for (const text of this.pendingCueTexts) {
        const line = document.createElement("div");
        line.className = "subjap-cue-line subjap-cue-line--pending";
        line.textContent = text;
        if (this.subtitleVisibilityOverride?.japanese === false) {
          line.classList.add("subjap-subtitles--hidden");
        }
        this.container.appendChild(line);
      }
    } else {
      for (const rc of this.cues) {
        const line = this.buildCueLine(rc);
        if (this.subtitleVisibilityOverride?.japanese === false) {
          line.classList.add("subjap-subtitles--hidden");
        }
        this.container.appendChild(line);
      }
    }
    if (this.translation) {
      const line = document.createElement("div");
      line.className = "subjap-translation-line";
      if (this.subtitleVisibilityOverride?.translation === false) {
        line.classList.add("subjap-translation-line--exercise-hidden");
      } else if (
        this.subtitleVisibilityOverride?.translation !== true &&
        !this.shouldShowTranslation()
      ) {
        line.classList.add("subjap-translation-line--hidden");
      }
      line.lang = this.translation.language;
      line.dataset.language = this.translation.language;
      // A timed-text track may split one translated sentence over several
      // source lines. Keep the sentence on one visual line whenever it fits,
      // while still allowing the browser to wrap it on narrow players.
      line.textContent = this.translation.text.replace(/\s+/gu, " ").trim();
      this.container.appendChild(line);
    }

    // Re-sync position after render
    if (this.visible) this.syncPosition();
  }

  private buildCueLine(rc: RenderedCue): HTMLDivElement {
    const line = document.createElement("div");
    line.className = "subjap-cue-line";
    const candidateHighlights = this.getMiningCandidateHighlights(rc);

    for (const st of rc.spans) {
      const span = this.buildTokenSpan(st, candidateHighlights.get(st.index));
      line.appendChild(span);
    }

    return line;
  }

  private buildTokenSpan(
    st: SpanToken,
    candidateHighlight: MiningCandidateHighlight | undefined = undefined,
  ): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "subjap-token";
    const isNonWord = this.isNonWord(st);
    if (isNonWord) {
      span.classList.add("subjap-token--punctuation");
    }
    const reading = toHiragana(st.token.reading);
    span.dataset.lemma = tokenCanonicalKey(st.token);
    span.dataset.reading = reading;
    span.dataset.surface = st.token.surface;
    span.dataset.pos = st.token.partOfSpeech.join(",");
    span.dataset.index = String(st.index);
    if (st.isParenthetical) {
      span.classList.add("subjap-token--parenthetical");
      span.dataset.parenthetical = "true";
    }
    if (!isNonWord && !st.isParenthetical && !st.isPending) {
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", `${st.token.surface} — ouvrir les détails`);
    }
    if (candidateHighlight) {
      span.classList.add("subjap-token--mine-candidate");
      span.classList.add(`subjap-token--mine-candidate--${candidateHighlight}`);
    }

    if (isNonWord || st.isPending) {
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
    if (
      this.options.showFurigana &&
      containsKanjiOrKatakana(st.token.surface) &&
      reading &&
      reading !== st.token.surface
    ) {
      const ruby = document.createElement("span");
      ruby.className = "subjap-furigana";
      ruby.textContent = reading;
      span.appendChild(ruby);
    }

    return span;
  }

  private getMiningCandidateHighlights(
    rc: RenderedCue,
  ): Map<number, MiningCandidateHighlight> {
    if (rc.spans.some((span) => span.isPending)) return new Map();
    const highlights: Array<FrequencyHighlight | null> = rc.spans.map((st) => {
      if (st.isParenthetical || this.isNonWord(st)) return null;
      return getFrequencyHighlight(
        st.wordState,
        st.frequencyRank,
        this.knownWordCount,
        st.ankiNoteCount,
      );
    });
    if (!isSingleMiningCandidate(highlights)) return new Map();

    return new Map(
      rc.spans
        .flatMap((st, index) => {
          const highlight = highlights[index];
          return highlight === "relevant" || highlight === "near"
            ? [[st.index, highlight]]
            : [];
        })
    );
  }

  private isNonWord(st: SpanToken): boolean {
    return isNonLexicalToken(st.token);
  }

  /**
   * When enabled, keep the secondary translation visible until every lexical
   * word in all currently displayed Japanese cues is explicitly known or
   * ignored. Punctuation, whitespace and parenthetical annotations do not
   * participate in the decision.
   */
  private shouldShowTranslation(): boolean {
    if (!this.options.hideSecondarySubtitlesWhenAllKnown) return true;
    if (
      this.pendingCueTexts?.length ||
      this.cues.some((cue) => cue.spans.some((span) => span.isPending))
    ) {
      return true;
    }
    return !isJapaneseOnlyEligible(
      this.cues.flatMap((cue) => cue.spans),
      this.knownWordCount,
    );
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
    if (this.rafId !== null) return;
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
