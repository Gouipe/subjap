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
import { DEFAULT_OPTIONS, subtitleFontSize } from "@/core/options";
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
import { videoPictureRect } from "@/core/video-picture";
import { forgetVideoSurface, mountVideoSurface } from "./mount";

/** Space between the player's subtitles and SubJap's, as a share of the picture height. */
const PLAYER_SUBTITLE_GAP = 0.02;

const CONTAINER_ID = "subjap-overlay-container";
const STYLE_ID = "subjap-overlay-styles";
const SUBTITLE_FONT =
  "'IBM Plex Sans JP', 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif";
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
      /* Pure white and bold like native subtitles; the warmer --sj-text
         stays for interface surfaces. */
      --sj-subtitle: #ffffff;
      --sj-muted: #b2b6bf;
      --sj-unknown: #9ca1aa;
      --sj-accent: #ff624d;
      --sj-priority-high: #78d6a3;
      --sj-priority-mid: #55b8ff;
      --sj-priority-low: #f1b46d;
      --sj-danger: #ff8490;
      /* No backdrop behind subtitles, like the platform's own: a soft dark
         glow, with no hard outline, keeps them legible on bright scenes. A
         black stroke under the glyphs was tried and read as a cartoon
         sticker, eating into thin glyphs. */
      --sj-shadow:
        0 0 0.08em #000,
        0 0 0.2em rgba(0, 0, 0, 0.85),
        0 0 0.2em rgba(0, 0, 0, 0.6),
        0 0.04em 0.45em rgba(0, 0, 0, 0.65);
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
         sizes itself to all its tokens laid end to end, so the line box would
         span the width of every line combined instead of the longest one. */
      display: block;
      text-align: center;
      /* A tight line keeps underlines against their word; the spacing between
         wrapped lines comes from the tokens' top margin instead. */
      margin: 0;
      padding: 0 0.24em 0.16em;
      pointer-events: auto;
      font-size: var(--sj-font-size, 28px);
      font-family: ${SUBTITLE_FONT};
      font-weight: 700;
      line-height: 1.2;
      color: var(--sj-subtitle);
      white-space: normal;
      overflow-wrap: break-word;
      text-shadow: var(--sj-shadow);
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
      font-size: calc(var(--sj-font-size, 28px) * 0.72);
      font-family: ${SUBTITLE_FONT};
      font-weight: 400;
      /* White like the Japanese: without a backdrop a muted grey turns muddy
         against its outline. Smaller size and lighter weight keep it
         secondary. */
      color: var(--sj-subtitle);
      line-height: 1.3;
      text-align: center;
      white-space: normal;
      overflow-wrap: break-word;
      text-shadow: var(--sj-shadow);
    }
    /* A known sentence's hidden layers: the next one X reveals is blurred
       over a dark band that shows it on any scene, those after it invisible.
       Each stays readable on hover, or with X. The band sits on the line and
       the blur on its content, so the band keeps sharp edges. */
    #${CONTAINER_ID} .subjap-translation-line--hidden {
      opacity: 0;
      cursor: default;
      pointer-events: auto;
      transition: opacity 0.12s ease, background-color 0.12s ease;
    }
    #${CONTAINER_ID} .subjap-translation-line--hidden.subjap-translation-line--blurred {
      opacity: 1;
    }
    #${CONTAINER_ID} .subjap-translation-line--hidden:hover {
      opacity: 1;
    }
    #${CONTAINER_ID} .subjap-cue-line--hidden,
    #${CONTAINER_ID} .subjap-translation-line--blurred {
      background-color: rgba(0, 0, 0, 0.45);
      border-radius: 0.3em;
      transition: opacity 0.12s ease, background-color 0.12s ease;
    }
    /* Doubled classes outrank the token's own transition. */
    #${CONTAINER_ID} .subjap-cue-line.subjap-cue-line--hidden > *,
    #${CONTAINER_ID} .subjap-translation-line.subjap-translation-line--blurred > * {
      filter: blur(0.15em);
      transition: filter 0.12s ease;
    }
    #${CONTAINER_ID} .subjap-cue-line--hidden:hover,
    #${CONTAINER_ID} .subjap-translation-line--blurred:hover {
      background-color: transparent;
    }
    #${CONTAINER_ID} .subjap-cue-line--hidden:hover > *,
    #${CONTAINER_ID} .subjap-translation-line--blurred:hover > * {
      filter: none;
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
      /* Square bottom corners keep vocabulary underlines straight. */
      border-radius: 0.16em 0.16em 0 0;
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
      color: var(--sj-subtitle);
      border-bottom-color: transparent;
    }
    /* Studied in Anki but not mature yet: still white (readable), with a
       discreet dotted underline so the word gets noticed in context. A solid
       coloured underline stays reserved for words to mine. */
    #${CONTAINER_ID} .subjap-known.subjap-young {
      border-bottom-style: dotted;
      border-bottom-color: rgba(255, 255, 255, 0.9);
      /* Dots read lighter than a solid line: thicken them, and pull the
         extra width back with a negative margin so the text stays on the
         same baseline as its neighbours. */
      border-bottom-width: max(3px, 0.12em);
      margin-bottom: calc(max(2px, 0.08em) - max(3px, 0.12em));
    }
    /* A coloured word is a word to mine now: the only unknown of an i+1
       sentence. Every other word that cannot be read yet, including words
       already in Anki but not acquired, is only greyed, so white reads as
       understood. */
    #${CONTAINER_ID} .subjap-unknown {
      color: var(--sj-unknown);
      border-bottom-color: transparent;
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate.subjap-unknown--relevant {
      color: var(--sj-priority-high);
      border-bottom-color: currentColor;
    }
    #${CONTAINER_ID} .subjap-token--mine-candidate.subjap-unknown--near {
      color: var(--sj-priority-mid);
      border-bottom-color: currentColor;
    }
    #${CONTAINER_ID} .subjap-learning {
      color: var(--sj-unknown);
      border-bottom-color: transparent;
    }
    #${CONTAINER_ID} .subjap-neutral {
      color: var(--sj-subtitle);
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
      font-size: calc(var(--sj-font-size, 28px) * 0.45);
      line-height: 1;
      margin-bottom: 0.08em;
      /* White, not grey: grey means "unknown word" in the colour code. */
      color: var(--sj-subtitle);
      font-weight: 500;
      white-space: nowrap;
      text-shadow: var(--sj-shadow);
    }
    @media (prefers-reduced-motion: reduce) {
      #${CONTAINER_ID} .subjap-token,
      #${CONTAINER_ID} .subjap-translation-line--hidden,
      #${CONTAINER_ID} .subjap-cue-line--hidden,
      #${CONTAINER_ID} .subjap-translation-line--blurred,
      #${CONTAINER_ID} .subjap-cue-line.subjap-cue-line--hidden > *,
      #${CONTAINER_ID} .subjap-translation-line.subjap-translation-line--blurred > *,
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
  /**
   * Cue identity for the last X reveal, and how many hidden layers it has
   * revealed so far (Japanese first, then the translation).
   */
  private revealedSubtitle: { key: string; layers: number } | null = null;
  /** Last all-known decision, reused while the same Japanese text re-renders. */
  private resolvedKnownSentence: { textKey: string; known: boolean } | null = null;
  /**
   * Key of the translation last shown with a known Japanese sentence. Shown
   * alone afterwards (its Japanese line ended first, or the silence before the
   * next one), it keeps that sentence's hidden state.
   */
  private translationOfKnownSentence: string | null = null;
  /** Translation and X reveals of the last Japanese lines displayed, kept through an empty overlay. */
  private lastSentenceReveal: { translationKey: string; layers: number } | null = null;
  private playerSubtitleRoom: () => number = () => 0;

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

  /** Room to leave at the bottom of the picture for the player's own subtitles. */
  setPlayerSubtitleRoom(provider: () => number): void {
    this.playerSubtitleRoom = provider;
    if (this.visible) this.syncPosition();
  }

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
    const revealedPreviousCue = this.revealedSubtitle?.key === previousKey;
    const previousSentence = this.translationRevealOfSentence();
    this.cues = cues;
    this.pendingCueTexts = null;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.preserveSecondaryRevealForSameCue(
      revealedPreviousCue,
      previousTextKey,
      this.currentSubtitleTextKey(),
    );
    this.carryKnownSentenceToTranslationAlone(previousSentence);
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
    const revealedPreviousCue = this.revealedSubtitle?.key === previousKey;
    const previousSentence = this.translationRevealOfSentence();
    this.cues = [];
    this.pendingCueTexts = cueTexts;
    this.translation = translation;
    this.knownWordCount = Math.max(0, Math.floor(knownWordCount));
    this.preserveSecondaryRevealForSameCue(
      revealedPreviousCue,
      previousTextKey,
      this.currentSubtitleTextKey(),
    );
    this.carryKnownSentenceToTranslationAlone(previousSentence);
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

  /**
   * Reveal the next hidden layer of the current sentence (Japanese, then the
   * translation) until the displayed cue changes.
   */
  revealHiddenSubtitle(): void {
    const key = this.currentSubtitleKey();
    const revealed = this.revealedSubtitle?.key === key ? this.revealedSubtitle.layers : 0;
    const count = this.hiddenLayerCount();
    if (revealed >= count) return;
    // Shown alone, the translation is the only layer left: reveal it at once.
    this.revealedSubtitle = { key, layers: this.isTranslationAlone() ? count : revealed + 1 };
    this.render();
  }

  /**
   * Update styling options and re-render.
   */
  setOptions(opts: Partial<OverlayOptions>): void {
    this.options = { ...this.options, ...opts };
    this.styleEl = injectStyles(this.options);
    this.syncPosition();
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

    const { hideJapanese, hideTranslation } = this.hiddenLayers();
    if (this.pendingCueTexts?.length) {
      for (const text of this.pendingCueTexts) {
        const line = document.createElement("div");
        line.className = "subjap-cue-line subjap-cue-line--pending";
        line.appendChild(lineText(text));
        if (hideJapanese) line.classList.add("subjap-cue-line--hidden");
        this.container.appendChild(line);
      }
    } else {
      for (const rc of this.cues) {
        const line = this.buildCueLine(rc);
        if (hideJapanese) line.classList.add("subjap-cue-line--hidden");
        this.container.appendChild(line);
      }
    }
    if (this.translation) {
      const line = document.createElement("div");
      line.className = "subjap-translation-line";
      if (hideTranslation) {
        line.classList.add("subjap-translation-line--hidden");
        // Blurred when it is the next layer X reveals, invisible behind hidden Japanese.
        if (!hideJapanese) line.classList.add("subjap-translation-line--blurred");
      }
      line.lang = this.translation.language;
      line.dataset.language = this.translation.language;
      // A timed-text track may split one translated sentence over several
      // source lines. Keep the sentence on one visual line whenever it fits,
      // while still allowing the browser to wrap it on narrow players.
      line.appendChild(lineText(this.translation.text.replace(/\s+/gu, " ").trim()));
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
        // A word set aside is grey like a mined one until its card exists.
        (st.ankiNoteCount ?? 0) + (st.minedLater ? 1 : 0),
      );
      if (highlight === "known" || highlight === "ignored") {
        span.classList.add("subjap-known");
        if (highlight === "known" && st.wordState?.young && this.options.markYoungWords) {
          span.classList.add("subjap-young");
        }
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
        // A word set aside is grey like a mined one until its card exists.
        (st.ankiNoteCount ?? 0) + (st.minedLater ? 1 : 0),
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

  /** Layers hidden by the known-sentence setting, minus those revealed with X. */
  private hiddenLayers(): { hideJapanese: boolean; hideTranslation: boolean } {
    const mode = this.options.knownSentenceSubtitles;
    if (mode === "show" || !this.isKnownSentence()) {
      return { hideJapanese: false, hideTranslation: false };
    }
    const key = this.currentSubtitleKey();
    const revealed = this.revealedSubtitle?.key === key ? this.revealedSubtitle.layers : 0;
    if (this.isTranslationAlone()) {
      return { hideJapanese: false, hideTranslation: revealed < this.translationLayer() };
    }
    if (mode === "hide-translation") {
      return { hideJapanese: false, hideTranslation: revealed < 1 };
    }
    return { hideJapanese: revealed < 1, hideTranslation: revealed < 2 };
  }

  /** Number of layers X can reveal on the current sentence. */
  private hiddenLayerCount(): number {
    const mode = this.options.knownSentenceSubtitles;
    if (mode === "show" || !this.isKnownSentence()) return 0;
    if (this.isTranslationAlone()) return this.translationLayer();
    const translation = this.translation ? 1 : 0;
    return mode === "hide-all" ? 1 + translation : translation;
  }

  /**
   * True when every lexical word in all currently displayed Japanese cues is
   * explicitly known or ignored. Punctuation, whitespace and parenthetical
   * annotations do not participate in the decision.
   */
  private isKnownSentence(): boolean {
    if (this.runtimeUnavailable) return false;
    const alone = this.aloneTranslation();
    if (alone) return this.translationOfKnownSentence === this.translationKey(alone);
    if (this.cues.length === 0 && !this.pendingCueTexts?.length) return false;

    // Re-rendering the same Japanese text (a seek with S, a new translation
    // line) keeps its known decision instead of flashing hidden subtitles
    // while vocabulary metadata is reloaded.
    const textKey = this.currentSubtitleTextKey();
    const resolved = this.resolvedKnownSentence?.textKey === textKey
      ? this.resolvedKnownSentence.known
      : null;
    // Untokenized text only lasts while the tokenizer warms up (or failed):
    // keep the subtitles available. Tokenized text awaiting metadata is
    // resolved within moments, so do not show what may be hidden right after.
    if (this.pendingCueTexts?.length) return resolved ?? false;
    if (this.cues.some((cue) => cue.spans.some((span) => span.isPending))) {
      return resolved ?? true;
    }

    const known = isAllKnownOrIgnored(this.cues.flatMap((cue) => cue.spans));
    this.resolvedKnownSentence = { textKey, known };
    return known;
  }

  private currentSubtitleKey(): string {
    if (this.pendingCueTexts?.length) {
      return `pending:${JSON.stringify(this.pendingCueTexts)}`;
    }
    const alone = this.aloneTranslation();
    if (alone) return this.translationKey(alone);
    return `cues:${this.cues.map((cue) => subtitleCueKey(cue.cue)).join("|")}`;
  }

  private currentSubtitleTextKey(): string {
    if (this.pendingCueTexts?.length) {
      return JSON.stringify(this.pendingCueTexts.map((text) => normalizeCueText(text)));
    }
    const alone = this.aloneTranslation();
    if (alone) return this.translationKey(alone);
    const texts = this.cues.map((cue) => cue.cue.text);
    return JSON.stringify(texts.map((text) => normalizeCueText(text)));
  }

  private preserveSecondaryRevealForSameCue(
    revealedPreviousCue: boolean,
    previousTextKey: string,
    nextTextKey: string,
  ): void {
    if (revealedPreviousCue && this.revealedSubtitle && previousTextKey === nextTextKey) {
      this.revealedSubtitle = { ...this.revealedSubtitle, key: this.currentSubtitleKey() };
    }
  }

  /** The translation, when it is displayed without any Japanese line. */
  private aloneTranslation(): SubtitleTranslation | null {
    return this.cues.length === 0 && !this.pendingCueTexts?.length ? this.translation : null;
  }

  private isTranslationAlone(): boolean {
    return this.aloneTranslation() !== null;
  }

  /** 1-based layer of the translation in the X reveal order. */
  private translationLayer(): number {
    return this.options.knownSentenceSubtitles === "hide-all" ? 2 : 1;
  }

  private translationKey(translation: SubtitleTranslation): string {
    return `translation:${translation.cueKey ?? JSON.stringify([
      translation.language,
      normalizeCueText(translation.text),
    ])}`;
  }

  /** The translation shown with Japanese lines, and the layers X revealed on them. */
  private translationRevealOfSentence(): { translationKey: string; layers: number } | null {
    if (!this.translation || (this.cues.length === 0 && !this.pendingCueTexts?.length)) return null;
    const key = this.currentSubtitleKey();
    return {
      translationKey: this.translationKey(this.translation),
      layers: this.revealedSubtitle?.key === key ? this.revealedSubtitle.layers : 0,
    };
  }

  /**
   * A translation shown with a known sentence keeps its hidden state when it
   * stays alone after it, revealed or not. A translation never shown with
   * Japanese (a translated sign) is not concerned and stays visible.
   */
  private carryKnownSentenceToTranslationAlone(
    previousSentence: { translationKey: string; layers: number } | null,
  ): void {
    // The overlay may be emptied briefly before the translation shows alone.
    if (previousSentence) this.lastSentenceReveal = previousSentence;
    const sentence = this.lastSentenceReveal;
    const alone = this.aloneTranslation();
    if (alone) {
      const key = this.translationKey(alone);
      if (sentence?.translationKey === key && sentence.layers > 0 && this.revealedSubtitle?.key !== key) {
        this.revealedSubtitle = { key, layers: sentence.layers };
      }
      return;
    }
    if (this.cues.length === 0 && !this.pendingCueTexts?.length) return;
    this.translationOfKnownSentence = this.translation && this.isKnownSentence()
      ? this.translationKey(this.translation)
      : null;
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
    // Subtitles scale with the player, like native ones.
    this.container.style.setProperty(
      "--sj-font-size",
      `${subtitleFontSize(this.options.subtitleScale, rect.height).toFixed(1)}px`,
    );

    // Cover the video exactly and bottom-anchor the cue lines (the container is
    // display:flex + justify-content:flex-end). The padding-bottom inset keeps
    // the text above the platform's bottom control bar — Netflix's bar overlays
    // the bottom ~10-13% of the player — while growing upward for taller text.
    this.container.style.height = `${rect.height}px`;
    this.container.style.paddingTop = "0";
    let inset = Math.max(120, rect.height * 0.13);
    const room = this.playerSubtitleRoom();
    if (room > 0) {
      // Stay above the player's own lines at a steady height, whatever the
      // size of the player: they scale with the picture, not with the inset.
      const picture = videoPictureRect(this.video);
      inset = Math.max(inset, rect.bottom - picture.bottom + picture.height * (room + PLAYER_SUBTITLE_GAP));
    }
    this.container.style.paddingBottom = `${inset}px`;
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

/** Plain line text in its own element, so a hidden line blurs it without its band. */
function lineText(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

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
