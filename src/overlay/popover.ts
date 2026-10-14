// ---------------------------------------------------------------------------
// SubJap — word popover (vanilla DOM)
// ---------------------------------------------------------------------------

import {
  tokenCanonicalKey,
  tokenDictionaryForm,
  type DictionaryEntry,
  type PitchAccent,
  type Token,
  type WordStatus,
} from "@/core/types";
import { toHiragana } from "@/core/kana";
import { dictionaryReadingForToken } from "@/dictionary/match";
import { forgetVideoSurface, mountVideoSurface } from "./mount";

// ── Constants ─────────────────────────────────────────────────────────────

const POPOVER_ID = "subjap-popover";
const POPOVER_WIDTH = 306;
const POPOVER_HEIGHT = 422;
const VIEWPORT_MARGIN = 8;
const SUBTITLE_GAP = 12;
const SUBTITLE_SELECTOR = ":scope > .subjap-cue-line, :scope > .subjap-translation-line";
const POS_LABELS: Record<string, string> = {
  名詞: "Noun",
  動詞: "Verb",
  形容詞: "Adj (i)",
  形容動詞: "Adj (na)",
  助詞: "Particle",
  助動詞: "Aux",
  副詞: "Adverb",
  連体詞: "Pre-noun",
  接続詞: "Conj",
  感動詞: "Interj",
  接頭辞: "Prefix",
  接尾辞: "Suffix",
  記号: "Symbol",
  フィラー: "Filler",
};

// ── Event interface ───────────────────────────────────────────────────────

export interface PopoverCallbacks {
  /** Called when the user clicks "Mark Known" / "Mark Unknown" */
  onToggleKnown: (lemma: string, currentStatus: WordStatus | null) => void;
  /** Called when the user clicks "Ignore" / "Unignore" */
  onToggleIgnored: (lemma: string, currentStatus: WordStatus | null) => void;
  /** Called when the user clicks "Mine this" */
  onMine: (token: Token, entry: DictionaryEntry | null) => void;
}
// ── Class ─────────────────────────────────────────────────────────────────

export class WordPopover {
  private el: HTMLDivElement;
  private callbacks: PopoverCallbacks;
  private visible = false;
  private currentLemma = "";
  private currentStatus: WordStatus | null = null;
  private currentFrequencyRank: number | undefined;
  private currentAnkiNoteCount = 0;
  private currentToken: Token | null = null;
  private currentEntry: DictionaryEntry | null = null;
  private boundOnKeydown: (e: KeyboardEvent) => void;
  private boundOnClickOutside: (e: MouseEvent) => void;

  constructor(callbacks: PopoverCallbacks) {
    this.callbacks = callbacks;
    this.el = this.buildElement();
    this.boundOnKeydown = this.onKeydown.bind(this);
    this.boundOnClickOutside = this.onClickOutside.bind(this);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Show the popover positioned near `anchor` with the given data.
   */
  show(params: {
    anchor: HTMLElement;
    token: Token;
    entry?: DictionaryEntry | null;
    pitchAccent?: PitchAccent | null;
    wordStatus?: WordStatus | null;
    /** Rank from the subtitle frequency list, shown whenever it exists. */
    frequencyRank?: number;
    /** Number of existing Anki notes whose normalized `Mot` matches the lemma. */
    ankiNoteCount?: number;
  }): void {
    const { anchor, token, entry, pitchAccent, wordStatus, frequencyRank, ankiNoteCount } = params;

    this.currentToken = token;
    this.currentEntry = entry ?? null;
    this.currentLemma = tokenCanonicalKey(token);
    this.currentStatus = wordStatus ?? null;
    this.currentFrequencyRank = frequencyRank;
    this.currentAnkiNoteCount = Math.max(0, ankiNoteCount ?? 0);

    this.populateContent(
      token,
      entry,
      pitchAccent,
      wordStatus,
      frequencyRank,
      this.currentAnkiNoteCount,
    );
    // A mining action may have hidden the popover with display:none so the
    // browser screenshot cannot catch its opacity transition mid-flight.
    this.el.style.removeProperty("display");
    this.positionNear(anchor);
    this.el.classList.add("subjap-popover--visible");
    this.visible = true;

    // Delay listener registration to avoid immediate close from the click
    // that triggered this show.
    requestAnimationFrame(() => {
      document.addEventListener("keydown", this.boundOnKeydown);
      document.addEventListener("mousedown", this.boundOnClickOutside, true);
    });
  }

  /** Hide the popover, optionally without leaving an opacity transition. */
  hide(options: { immediate?: boolean } = {}): void {
    if (!this.visible) return;
    this.el.classList.remove("subjap-popover--visible");
    this.visible = false;
    if (options.immediate) this.el.style.display = "none";
    document.removeEventListener("keydown", this.boundOnKeydown);
    document.removeEventListener("mousedown", this.boundOnClickOutside, true);
  }

  /** Tear down the popover and remove its DOM. */
  destroy(): void {
    this.hide();
    forgetVideoSurface(this.el);
    this.el.remove();
  }

  /** Returns the root element (for mounting). */
  getElement(): HTMLDivElement {
    return this.el;
  }

  // ── Build ──────────────────────────────────────────────────────────────

  private buildElement(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = POPOVER_ID;
    el.className = "subjap-popover";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Détails du mot japonais");
    el.innerHTML = `
      <div class="subjap-popover__header">
        <div class="subjap-popover__surface"></div>
        <div class="subjap-popover__reading"></div>
        <div class="subjap-popover__pos"></div>
        <div class="subjap-popover__grammar"></div>
        <div class="subjap-popover__freq"></div>
      </div>
      <div class="subjap-popover__content">
        <div class="subjap-popover__defs"></div>
        <div class="subjap-popover__anki"></div>
        <div class="subjap-popover__pitch"></div>
      </div>
      <div class="subjap-popover__actions">
        <button class="subjap-btn subjap-btn--toggle-known"></button>
        <button class="subjap-btn subjap-btn--toggle-ignored"></button>
        <button class="subjap-btn subjap-btn--mine">⛏ Mine this</button>
      </div>
    `;

    // Event delegation on the actions area
    el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("subjap-btn--toggle-known")) {
        this.handleToggleKnown();
      } else if (target.classList.contains("subjap-btn--toggle-ignored")) {
        this.handleToggleIgnored();
      } else if (target.classList.contains("subjap-btn--mine")) {
        this.handleMine();
      }
    });

    // Inject popover styles (once)
    this.injectPopoverStyles();

    return el;
  }

  private injectPopoverStyles(): void {
    if (document.getElementById("subjap-popover-styles")) return;
    const s = document.createElement("style");
    s.id = "subjap-popover-styles";
    s.textContent = `
      .subjap-popover {
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: min(${POPOVER_WIDTH}px, calc(100vw - 16px));
        height: ${POPOVER_HEIGHT}px;
        max-height: calc(100vh - 16px);
        max-height: calc(100dvh - 16px);
        overflow: hidden;
        background: #14161b;
        color: #f4f1ea;
        border: 1px solid #343842;
        border-radius: 10px;
        padding: 12px 14px;
        font-family: "IBM Plex Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        user-select: text;
        box-shadow: 0 6px 8px rgba(0,0,0,0.38);
        opacity: 0;
        transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: none;
      }
      .subjap-popover--visible {
        opacity: 1;
        pointer-events: auto;
      }
      .subjap-popover__surface {
        font-size: 24px;
        font-weight: 600;
        color: #f4f1ea;
      }
      .subjap-popover__header,
      .subjap-popover__actions {
        flex: none;
      }
      .subjap-popover__content {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      .subjap-popover__reading {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #b2b6bf;
        margin-top: 3px;
      }
      .subjap-popover__pos {
        font-size: 10px;
        color: #b2b6bf;
        margin-top: 4px;
      }
      .subjap-popover__grammar {
        font-size: 12px;
        color: #b2b6bf;
        margin-top: 4px;
        line-height: 1.5;
        white-space: pre-line;
      }
      .subjap-popover__grammar:empty {
        display: none;
      }
      .subjap-popover__defs {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #343842;
      }
      .subjap-popover__def {
        font-size: 13px;
        color: #f4f1ea;
      }
      .subjap-popover__def + .subjap-popover__def {
        margin-top: 2px;
      }
      .subjap-popover__freq {
        font-size: 13px;
        font-weight: 500;
        color: #b2b6bf;
        margin-top: 6px;
      }
      .subjap-popover__anki {
        font-size: 12px;
        font-weight: 600;
        color: #d3a0ff;
        margin-top: 6px;
      }
      .subjap-popover__pitch {
        font-size: 12px;
        color: #f1b46d;
        margin-top: 4px;
        font-family: monospace;
      }
      .subjap-popover__actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #343842;
      }
      .subjap-btn {
        padding: 5px 12px;
        border: 1px solid #343842;
        border-radius: 6px;
        background: #1b1e24;
        color: #f4f1ea;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
        transition: background 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
        white-space: nowrap;
      }
      .subjap-btn:hover {
        background: #252932;
      }
      .subjap-btn:focus-visible {
        outline: 2px solid #ff624d;
        outline-offset: 2px;
      }
      .subjap-btn:active {
        transform: translateY(1px);
      }
      .subjap-btn--toggle-known {
        flex: 1;
      }
      .subjap-btn--toggle-ignored {
        flex: 1;
      }
      .subjap-btn--mine {
        flex: 1;
        background: #ff624d;
        border-color: #ff624d;
        color: #0c0d10;
      }
      .subjap-btn--mine:hover {
        background: #ff7966;
      }
      @media (prefers-reduced-motion: reduce) {
        .subjap-popover {
          transition: none;
        }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Content ────────────────────────────────────────────────────────────

  private populateContent(
    token: Token,
    entry: DictionaryEntry | null | undefined,
    pitchAccent: PitchAccent | null | undefined,
    wordStatus: WordStatus | null | undefined,
    frequencyRank: number | undefined,
    ankiNoteCount: number,
  ): void {
    // Base form and reading
    const surfaceEl = this.el.querySelector(".subjap-popover__surface")!;
    const dictionaryForm = tokenDictionaryForm(token);
    surfaceEl.textContent = dictionaryForm;

    const readingEl = this.el.querySelector(".subjap-popover__reading")!;
    const baseReading = dictionaryReadingForToken(token, entry);
    readingEl.textContent = baseReading ? toHiragana(baseReading) : "";

    // Part of speech
    const posEl = this.el.querySelector(".subjap-popover__pos")!;
    const posLabels = token.partOfSpeech.map((p) => POS_LABELS[p] ?? p).filter(Boolean);
    posEl.textContent = posLabels.length > 0 ? posLabels.join(" · ") : "";

    const grammarEl = this.el.querySelector(".subjap-popover__grammar")!;
    const annotations = (token.grammar ?? [])
      .map((annotation) =>
        annotation.kind === "plural-suffix"
          ? `${annotation.surface} — suffixe pluriel`
          : annotation.label ? `${annotation.surface} — ${annotation.label}` : annotation.surface,
      )
      .join("\n");
    const base = token.components?.[0];
    const decomposition =
      base &&
      (token.dictionaryCompound ||
        token.grammar?.some((annotation) => annotation.kind === "inflection"))
      ? `${token.components!.map((component) => component.surface.replace(/\n/gu, "")).join(" + ")}\n`
      : "";
    grammarEl.textContent = decomposition + annotations;

    // Definitions
    const defsContainer = this.el.querySelector(".subjap-popover__defs")!;
    defsContainer.replaceChildren();
    const glosses = entry?.senses.flatMap((sense) => sense.glosses) ?? [];
    if (glosses.length > 0) {
      for (const gloss of glosses) {
        const defDiv = document.createElement("div");
        defDiv.className = "subjap-popover__def";
        defDiv.textContent = gloss;
        defsContainer.appendChild(defDiv);
      }
    } else {
      const defDiv = document.createElement("div");
      defDiv.className = "subjap-popover__def";
      defDiv.textContent = "Definition not found";
      defsContainer.appendChild(defDiv);
    }

    // Frequency
    const freqEl = this.el.querySelector(".subjap-popover__freq")!;
    freqEl.textContent = frequencyRank != null ? `Frequency rank: #${frequencyRank}` : "";

    const ankiEl = this.el.querySelector<HTMLElement>(".subjap-popover__anki");
    if (ankiEl) {
      ankiEl.textContent =
        ankiNoteCount > 0
          ? `Déjà dans Anki · ${ankiNoteCount} carte${ankiNoteCount === 1 ? "" : "s"}`
          : "";
    }

    // Pitch accent
    const pitchEl = this.el.querySelector(".subjap-popover__pitch")!;
    if (pitchAccent) {
      pitchEl.textContent = `Pitch: ${pitchAccent.pattern} (${pitchAccent.moraCount} mora${
        pitchAccent.moraCount !== 1 ? "s" : ""
      })`;
    } else {
      pitchEl.textContent = "";
    }

    // Toggle button
    const toggleBtn = this.el.querySelector(".subjap-btn--toggle-known") as HTMLButtonElement;
    if (wordStatus === "known") {
      toggleBtn.textContent = "✓ Known";
      toggleBtn.style.background = "#2b3a33";
      toggleBtn.style.borderColor = "#78d6a3";
    } else {
      toggleBtn.textContent = "Mark Known";
      toggleBtn.style.background = "#1b1e24";
      toggleBtn.style.borderColor = "#343842";
    }

    const ignoreBtn = this.el.querySelector(".subjap-btn--toggle-ignored") as HTMLButtonElement;
    if (wordStatus === "ignored") {
      ignoreBtn.textContent = "Unignore";
      ignoreBtn.style.background = "#2b3a33";
      ignoreBtn.style.borderColor = "#78d6a3";
    } else {
      ignoreBtn.textContent = "Ignore";
      ignoreBtn.style.background = "#1b1e24";
      ignoreBtn.style.borderColor = "#343842";
    }
  }

  // ── Positioning ────────────────────────────────────────────────────────

  private positionNear(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const subtitleTop = this.getSubtitleBlockTop(anchor);

    // Keep the fixed card height when the same popover is reused for another word.
    this.el.style.removeProperty("max-height");

    const popoverHeight = this.el.offsetHeight || 180;
    const popoverWidth = this.el.offsetWidth || 260;

    // Center horizontally over the anchor, then clamp to viewport
    let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const margin = VIEWPORT_MARGIN;
    left = Math.max(margin, Math.min(left, viewW - popoverWidth - margin));

    let top: number;
    if (subtitleTop !== null) {
      // Subtitles are a protected region: keep the entire popover above them.
      top = Math.max(margin, subtitleTop - SUBTITLE_GAP - popoverHeight);
    } else {
      // Generic fallback for anchors outside the SubJap subtitle overlay.
      top = anchorRect.top - popoverHeight - margin;
      if (top < margin) {
        top = anchorRect.bottom + margin;
        if (top + popoverHeight > viewH - margin) {
          top = viewH - popoverHeight - margin;
        }
      }
    }
    const maxTop = Math.max(margin, viewH - popoverHeight - margin);
    top = Math.max(margin, Math.min(top, maxTop));

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  private getSubtitleBlockTop(anchor: HTMLElement): number | null {
    const overlay = anchor.closest<HTMLElement>("#subjap-overlay-container");
    if (!overlay) return null;

    const tops = Array.from(
      overlay.querySelectorAll<HTMLElement>(SUBTITLE_SELECTOR),
      (element) => element.getBoundingClientRect().top,
    ).filter(Number.isFinite);
    return tops.length > 0 ? Math.min(...tops) : null;
  }

  // ── Handlers ───────────────────────────────────────────────────────────

  private handleToggleKnown(): void {
    this.callbacks.onToggleKnown(this.currentLemma, this.currentStatus);
    // Update local state optimistically
    this.currentStatus = this.currentStatus === "known" ? "unknown" : "known";
    this.populateContent(
      this.currentToken!,
      this.currentEntry,
      null,
      this.currentStatus,
      this.currentFrequencyRank,
      this.currentAnkiNoteCount,
    );
  }

  private handleToggleIgnored(): void {
    this.callbacks.onToggleIgnored(this.currentLemma, this.currentStatus);
    // Unignore always returns the word to the regular unknown state.
    this.currentStatus = this.currentStatus === "ignored" ? "unknown" : "ignored";
    this.populateContent(
      this.currentToken!,
      this.currentEntry,
      null,
      this.currentStatus,
      this.currentFrequencyRank,
      this.currentAnkiNoteCount,
    );
  }

  private handleMine(): void {
    if (!this.currentToken) return;
    // The callback starts screenshot capture synchronously. Hide first and do
    // it immediately, otherwise the 180 ms opacity transition can be baked
    // into the captured frame as a translucent popover.
    this.hide({ immediate: true });
    this.callbacks.onMine(this.currentToken, this.currentEntry);
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.hide();
    }
  }

  private onClickOutside(e: MouseEvent): void {
    if (!this.el.contains(e.target as Node)) {
      this.hide();
    }
  }
}

// ── Singleton helpers ─────────────────────────────────────────────────────

let singleton: WordPopover | null = null;

/**
 * Get or create the singleton popover instance mounted to `document.body`.
 */
export function getPopover(callbacks: PopoverCallbacks): WordPopover {
  if (!singleton) {
    singleton = new WordPopover(callbacks);
    mountVideoSurface(singleton.getElement());
  }
  return singleton;
}

/**
 * Show the singleton popover.
 */
export function showPopover(params: Parameters<WordPopover["show"]>[0]): void {
  if (!singleton) return;
  singleton.show(params);
}

/** Hide the singleton popover (if it exists). */
export function hidePopover(): void {
  if (!singleton) return;
  singleton.hide();
}

/** Hide and destroy the singleton popover. */
export function destroyPopover(): void {
  if (singleton) {
    singleton.destroy();
    singleton = null;
  }
}
