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
  isAllKnownOrIgnored,
  isNonLexicalToken,
  isSingleMiningCandidate,
  type FrequencyHighlight,
} from "@/core/frequency";
import { normalizeCueText } from "@/subtitles";
import { subtitleCueKey } from "@/subtitles/timeline";
import { forgetVideoSurface, mountVideoSurface } from "./mount";

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
      --sj-learning: #d3a0ff;
      --sj-priority-high: #78d6a3;
      --sj-priority-mid: #55b8ff;
      --sj-priority-low: #f1b46d;
      --sj-danger: #ff8490;
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
      /* Inline layout, not a wrapping flexbox: a multi-line flex container
         sizes itself to all its tokens laid end to end, so the backdrop would
         span the width of every line combined instead of the longest one. */
      display: block;
      text-align: center;
      /* A tight line keeps underlines against their word; the spacing between
         wrapped lines comes from the tokens' top margin instead. */
      margin: 0;
      padding: 0 0.24em 0.16em;
      pointer-events: auto;
      font-size: ${opts.fontSize}px;
      font-family: ${opts.fontFamily};
      font-weight: 600;
      line-height: 1.2;
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
    #${CONTAINER_ID} .subjap-runtime-notice {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(92%, 620px);
      margin-bottom: 8px;
      padding: 10px 12px;
      box-sizing: border-box;
      pointer-events: auto;
      font: 500 13px/1.5 IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif;
      color: var(--sj-text);
      background: #14161b;
      border: 1px solid var(--sj-danger);
      border-radius: 8px;
      box-shadow: 0 6px 8px rgba(0, 0, 0, 0.38);
    }
    #${CONTAINER_ID} .subjap-runtime-notice__text {
      min-width: 0;
    }
    #${CONTAINER_ID} .subjap-runtime-notice__button {
      flex: none;
      padding: 8px 12px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      font: 600 12px/1.35 IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif;
      color: var(--sj-canvas);
      background: var(--sj-accent);
    }
    #${CONTAINER_ID} .subjap-runtime-notice__button:hover {
      background: #ff7966;
    }
    #${CONTAINER_ID} .subjap-runtime-notice__button:focus-visible {
      outline: 2px solid var(--sj-text);
      outline-offset: 2px;
    }
    #${CONTAINER_ID} .subjap-cue-line--pending {
      pointer-events: none;
      display: block;
      padding-top: 0.16em;
      line-height: 1.5;
      text-align: center;
      white-space: pre-wrap;
    }
    #${CONTAINER_ID} .subjap-line-break {
      white-space: pre;
    }
    #${CONTAINER_ID} .subjap-token--separator {
      white-space: pre;
      padding: 0;
      border: 0;
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
      font-weight: 400;
      /* Same compact backdrop as the Japanese line so it stays legible on
         bright scenes, but muted so the Japanese remains the protagonist. */
      color: var(--sj-muted);
      background-color: rgba(12, 13, 16, 0.82);
      border-radius: 0.18em;
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
      /* Bottom-align words so those carrying furigana grow upward. Japanese
         is written without spaces: tokens touch, and their bounds show
         through hover, focus and vocabulary underlines instead. */
      vertical-align: bottom;
      min-width: 0;
      white-space: nowrap;
      margin-top: 0.24em;
      padding-inline: 0.02em;
      cursor: pointer;
      border-bottom: max(2px, 0.08em) solid transparent;
      border-radius: 0.16em;
      transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1), background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    #${CONTAINER_ID} .subjap-token:not(.subjap-token--parenthetical):hover {
      background-color: rgba(244, 241, 234, 0.14);
    }
    #${CONTAINER_ID} .subjap-token:not(.subjap-token--parenthetical):focus-visible {
      outline: 2px solid var(--sj-accent);
      outline-offset: 2px;
      background-color: rgba(244, 241, 234, 0.14);
    }
    #${CONTAINER_ID} .subjap-known {
      color: var(--sj-text);
      border-bottom-color: transparent;
    }
    /* A coloured word is a word to mine now: the only unknown of an i+1
       sentence. Every other unknown, however frequent, is greyed with a
       dotted underline, so white reads as understood; words already in Anki
       stay white with an underline only. */
    #${CONTAINER_ID} .subjap-unknown {
      color: var(--sj-muted);
      border-bottom-color: var(--sj-muted);
      border-bottom-style: dotted;
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate.subjap-unknown--relevant {
      color: var(--sj-priority-high);
      border-bottom-color: currentColor;
      border-bottom-style: solid;
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate.subjap-unknown--near {
      color: var(--sj-priority-mid);
      border-bottom-color: currentColor;
      border-bottom-style: dashed;
    }
    #${CONTAINER_ID} .subjap-learning {
      color: var(--sj-text);
      border-bottom-color: var(--sj-learning);
      border-bottom-style: double;
      /* A double border needs 3px to draw two distinct lines. */
      border-bottom-width: max(3px, 0.12em);
    }
    #${CONTAINER_ID} .subjap-neutral {
      color: var(--sj-text);
      border-bottom-color: transparent;
    }
    #${CONTAINER_ID} .subjap-token--unavailable {
      cursor: default;
      pointer-events: none;
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
      #${CONTAINER_ID} .subjap-translation-line--hidden,
      #${CONTAINER_ID} .subjap-runtime-notice__button {
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
  private runtimeUnavailable = false;
  private styleEl: HTMLStyleElement;
  private rafId: number | null = null;
  private visible = false;
  /** Cue identity for the last translation revealed with X. */
  private revealedSecondarySubtitleKey: string | null = null;
  /** Last all-known decision, reused while the same Japanese text re-renders. */
  private resolvedTranslationVisibility: { textKey: string; show: boolean } | null = null;
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
    const previousKey = this.currentSubtitleKey();
    const previousTextKey = this.currentSubtitleTextKey();
    const revealedPreviousCue = this.revealedSecondarySubtitleKey === previousKey;
    this.cues = cues;
    this.pendingCueTexts = null;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.preserveSecondaryRevealForSameCue(
      revealedPreviousCue,
      previousTextKey,
      this.currentSubtitleTextKey(),
    );
    this.render();
  }

  /** Show cue text immediately while tokenisation/enrichment catches up. */
  updatePendingContent(
    cueTexts: string[],
    translation: SubtitleTranslation | null,
    knownWordCount: number,
  ): void {
    const previousKey = this.currentSubtitleKey();
    const previousTextKey = this.currentSubtitleTextKey();
    const revealedPreviousCue = this.revealedSecondarySubtitleKey === previousKey;
    this.cues = [];
    this.pendingCueTexts = cueTexts;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.preserveSecondaryRevealForSameCue(
      revealedPreviousCue,
      previousTextKey,
      this.currentSubtitleTextKey(),
    );
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

  /** Reveal the current secondary subtitle until the displayed cue changes. */
  revealSecondarySubtitle(): void {
    if (!this.translation) return;
    this.revealedSecondarySubtitleKey = this.currentSubtitleKey();
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

  /** Keep vocabulary neutral and ask for a reload when this content script is stale. */
  setRuntimeUnavailable(unavailable: boolean): void {
    if (this.runtimeUnavailable === unavailable) return;
    this.runtimeUnavailable = unavailable;
    this.render();
  }

  /** Tear down the overlay completely: cancel animation, remove DOM nodes. */
  destroy(): void {
    this.stopRepositionLoop();
    forgetVideoSurface(this.container);
    this.container.remove();
    this.styleEl.remove();
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private render(): void {
    // Clear container
    this.container.replaceChildren();

    if (this.runtimeUnavailable) {
      this.container.appendChild(this.buildRuntimeNotice());
    }

    if (
      this.cues.length === 0 &&
      !this.pendingCueTexts?.length &&
      !this.translation
    ) return;

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
        this.revealedSecondarySubtitleKey !== this.currentSubtitleKey() &&
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
      const fragments = st.token.surface.split("\n");
      let fragmentOffset = st.token.startOffset ?? 0;
      fragments.forEach((fragment, fragmentIndex) => {
        if (fragmentIndex > 0) {
          const lineBreak = document.createElement("span");
          lineBreak.className = "subjap-line-break";
          lineBreak.textContent = "\n";
          lineBreak.setAttribute("aria-hidden", "true");
          line.appendChild(lineBreak);
          fragmentOffset += 1;
        }
        if (fragment) {
          // A group spanning lines keeps one lexical identity and click target.
          // Only show a fragment reading when its whole morphemes align with it.
          const components = st.token.components?.filter((component) =>
            component.startOffset != null && component.endOffset != null &&
            component.startOffset >= fragmentOffset &&
            component.endOffset <= fragmentOffset + fragment.length,
          ) ?? [];
          const reading = fragments.length === 1 ? st.token.reading :
            components.map((component) => component.surface).join("") === fragment
              ? components.map((component) => component.reading).join("") : "";
          const span = this.buildTokenSpan(st, candidateHighlights.get(st.index), fragment, reading);
          if (fragmentIndex > 0) span.removeAttribute("tabindex");
          line.appendChild(span);
        }
        fragmentOffset += fragment.length;
      });
    }

    return line;
  }

  private buildRuntimeNotice(): HTMLDivElement {
    const notice = document.createElement("div");
    notice.className = "subjap-runtime-notice";
    notice.setAttribute("role", "alert");

    const text = document.createElement("span");
    text.className = "subjap-runtime-notice__text";
    text.textContent =
      "SubJap a été mis à jour. Rechargez la page pour retrouver vos états de vocabulaire.";

    const button = document.createElement("button");
    button.className = "subjap-runtime-notice__button";
    button.type = "button";
    button.textContent = "Recharger";
    button.addEventListener("click", () => window.location.reload());

    notice.append(text, button);
    return notice;
  }

  private buildTokenSpan(
    st: SpanToken,
    candidateHighlight: MiningCandidateHighlight | undefined = undefined,
    surface = st.token.surface,
    surfaceReading = st.token.reading,
  ): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "subjap-token";
    const isNonWord = this.isNonWord(st);
    const interactionUnavailable = this.runtimeUnavailable || st.isPending;
    if (isNonWord) {
      span.classList.add("subjap-token--punctuation");
    }
    if (!surface.trim()) span.classList.add("subjap-token--separator");
    const reading = toHiragana(surfaceReading);
    span.dataset.lemma = tokenCanonicalKey(st.token);
    span.dataset.reading = reading;
    span.dataset.surface = st.token.surface;
    span.dataset.pos = st.token.partOfSpeech.join(",");
    span.dataset.index = String(st.index);
    if (st.isParenthetical) {
      span.classList.add("subjap-token--parenthetical");
      span.dataset.parenthetical = "true";
    }
    if (!isNonWord && !st.isParenthetical && !interactionUnavailable) {
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", `${st.token.surface} — ouvrir les détails`);
    }
    if (candidateHighlight) {
      span.classList.add("subjap-token--mine-candidate");
      span.classList.add(`subjap-token--mine-candidate--${candidateHighlight}`);
    }

    if (this.runtimeUnavailable) {
      span.classList.add("subjap-token--unavailable");
    }
    // Parenthetical annotations (speaker names, sound cues) are not
    // vocabulary: they carry no learning state, hence no underline.
    if (isNonWord || interactionUnavailable || st.isParenthetical) {
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
    span.textContent = surface;

    // Optionally append furigana
    if (
      this.options.showFurigana &&
      containsKanjiOrKatakana(surface) &&
      reading &&
      reading !== surface
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
    if (this.runtimeUnavailable || rc.spans.some((span) => span.isPending)) {
      return new Map();
    }
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
    if (this.runtimeUnavailable) return true;
    if (this.cues.length === 0 && !this.pendingCueTexts?.length) return true;

    // Re-rendering the same Japanese text (a seek with S, a new translation
    // line) keeps its known decision instead of flashing the translation
    // while vocabulary metadata is reloaded.
    const textKey = this.currentSubtitleTextKey();
    const resolved = this.resolvedTranslationVisibility?.textKey === textKey
      ? this.resolvedTranslationVisibility.show
      : null;
    // Untokenized text only lasts while the tokenizer warms up (or failed):
    // keep the translation available. Tokenized text awaiting metadata is
    // resolved within moments, so do not show what may be hidden right after.
    if (this.pendingCueTexts?.length) return resolved ?? true;
    if (this.cues.some((cue) => cue.spans.some((span) => span.isPending))) {
      return resolved ?? false;
    }

    const show = !isAllKnownOrIgnored(this.cues.flatMap((cue) => cue.spans));
    this.resolvedTranslationVisibility = { textKey, show };
    return show;
  }

  private currentSubtitleKey(): string {
    if (this.pendingCueTexts?.length) {
      return `pending:${JSON.stringify(this.pendingCueTexts)}`;
    }
    if (this.cues.length === 0 && this.translation) {
      return `translation:${this.translation.cueKey ?? JSON.stringify([
        this.translation.language,
        normalizeCueText(this.translation.text),
      ])}`;
    }
    return `cues:${this.cues.map((cue) => subtitleCueKey(cue.cue)).join("|")}`;
  }

  private currentSubtitleTextKey(): string {
    if (this.pendingCueTexts?.length) {
      return JSON.stringify(this.pendingCueTexts.map((text) => normalizeCueText(text)));
    }
    if (this.cues.length === 0 && this.translation) {
      return `translation:${this.translation.cueKey ?? JSON.stringify([
        this.translation.language,
        normalizeCueText(this.translation.text),
      ])}`;
    }
    const texts = this.cues.map((cue) => cue.cue.text);
    return JSON.stringify(texts.map((text) => normalizeCueText(text)));
  }

  private preserveSecondaryRevealForSameCue(
    revealedPreviousCue: boolean,
    previousTextKey: string,
    nextTextKey: string,
  ): void {
    if (revealedPreviousCue && previousTextKey === nextTextKey) {
      this.revealedSecondarySubtitleKey = this.currentSubtitleKey();
    }
  }

  // ── Mounting ──────────────────────────────────────────────────────────

  private mountContainer(): void {
    // Mount on document.body so the overlay escapes the platform player's own
    // stacking contexts. An in-player mount can be trapped under transparent
    // platform layers (e.g. Netflix's control backdrop), which would paint over
    // it and swallow pointer events — the overlay stays visible but dead.
    mountVideoSurface(this.container);
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
