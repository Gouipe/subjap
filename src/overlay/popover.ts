// ---------------------------------------------------------------------------
// SubJap — word popover (vanilla DOM)
// ---------------------------------------------------------------------------

import type { DictionaryEntry, PitchAccent, Token, WordStatus } from "@/core/types";

// ── Constants ─────────────────────────────────────────────────────────────

const POPOVER_ID = "subjap-popover";
const POS_LABELS: Record<string, string> = {
  "名詞": "Noun",
  "動詞": "Verb",
  "形容詞": "Adj (i)",
  "形容動詞": "Adj (na)",
  "助詞": "Particle",
  "助動詞": "Aux",
  "副詞": "Adverb",
  "連体詞": "Pre-noun",
  "接続詞": "Conj",
  "感動詞": "Interj",
  "接頭辞": "Prefix",
  "接尾辞": "Suffix",
  "記号": "Symbol",
  "フィラー": "Filler",
};

// ── Event interface ───────────────────────────────────────────────────────

export interface PopoverCallbacks {
  /** Called when the user clicks "Mark Known" / "Mark Unknown" */
  onToggleKnown: (lemma: string, currentStatus: WordStatus | null) => void;
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
    /** Rank from the subtitle frequency list, shown for green/blue words. */
    frequencyRank?: number;
  }): void {
    const {
      anchor,
      token,
      entry,
      pitchAccent,
      wordStatus,
      frequencyRank,
    } = params;

    this.currentToken = token;
    this.currentEntry = entry ?? null;
    this.currentLemma = token.lemma;
    this.currentStatus = wordStatus ?? null;
    this.currentFrequencyRank = frequencyRank;

    this.populateContent(token, entry, pitchAccent, wordStatus, frequencyRank);
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

  /** Hide the popover. */
  hide(): void {
    if (!this.visible) return;
    this.el.classList.remove("subjap-popover--visible");
    this.visible = false;
    document.removeEventListener("keydown", this.boundOnKeydown);
    document.removeEventListener("mousedown", this.boundOnClickOutside, true);
  }

  /** Tear down the popover and remove its DOM. */
  destroy(): void {
    this.hide();
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
    el.setAttribute("role", "tooltip");
    el.innerHTML = `
      <div class="subjap-popover__surface"></div>
      <div class="subjap-popover__reading"></div>
      <div class="subjap-popover__pos"></div>
      <div class="subjap-popover__defs"></div>
      <div class="subjap-popover__freq"></div>
      <div class="subjap-popover__pitch"></div>
      <div class="subjap-popover__actions">
        <button class="subjap-btn subjap-btn--toggle-known"></button>
        <button class="subjap-btn subjap-btn--mine">⛏ Mine this</button>
      </div>
    `;

    // Event delegation on the actions area
    el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("subjap-btn--toggle-known")) {
        this.handleToggleKnown();
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
        min-width: 220px;
        max-width: 340px;
        background: #1e1e2e;
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 12px 14px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.18s, transform 0.18s;
        pointer-events: none;
      }
      .subjap-popover--visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .subjap-popover__surface {
        font-size: 22px;
        font-weight: 700;
        color: #fff;
      }
      .subjap-popover__reading {
        font-size: 14px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .subjap-popover__pos {
        font-size: 11px;
        text-transform: uppercase;
        color: #64748b;
        margin-top: 4px;
      }
      .subjap-popover__defs {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #334155;
      }
      .subjap-popover__def {
        font-size: 13px;
        color: #cbd5e1;
      }
      .subjap-popover__def + .subjap-popover__def {
        margin-top: 2px;
      }
      .subjap-popover__freq {
        font-size: 11px;
        color: #64748b;
        margin-top: 6px;
      }
      .subjap-popover__pitch {
        font-size: 12px;
        color: #facc15;
        margin-top: 4px;
        font-family: monospace;
      }
      .subjap-popover__actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #334155;
      }
      .subjap-btn {
        padding: 5px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #334155;
        color: #e2e8f0;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
      }
      .subjap-btn:hover {
        background: #475569;
      }
      .subjap-btn--toggle-known {
        flex: 1;
      }
      .subjap-btn--mine {
        flex: 1;
        background: #3b82f6;
        border-color: #3b82f6;
        color: #fff;
      }
      .subjap-btn--mine:hover {
        background: #2563eb;
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
  ): void {
    // Surface
    const surfaceEl = this.el.querySelector(".subjap-popover__surface")!;
    surfaceEl.textContent = token.surface;

    // Reading
    const readingEl = this.el.querySelector(".subjap-popover__reading")!;
    readingEl.textContent = token.reading ? `読み: ${token.reading}` : "";

    // Part of speech
    const posEl = this.el.querySelector(".subjap-popover__pos")!;
    const posLabels = token.partOfSpeech
      .map((p) => POS_LABELS[p] ?? p)
      .filter(Boolean);
    posEl.textContent = posLabels.length > 0 ? posLabels.join(" · ") : "";

    // Definitions
    const defsContainer = this.el.querySelector(".subjap-popover__defs")!;
    defsContainer.replaceChildren();
    if (entry?.senses) {
      for (const sense of entry.senses) {
        for (const gloss of sense.glosses) {
          const defDiv = document.createElement("div");
          defDiv.className = "subjap-popover__def";
          defDiv.textContent = gloss;
          defsContainer.appendChild(defDiv);
        }
      }
    }

    // Frequency
    const freqEl = this.el.querySelector(".subjap-popover__freq")!;
    freqEl.textContent =
      frequencyRank != null ? `Frequency rank: #${frequencyRank}` : "";

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
    const toggleBtn = this.el.querySelector(
      ".subjap-btn--toggle-known",
    ) as HTMLButtonElement;
    if (wordStatus === "known") {
      toggleBtn.textContent = "✓ Known";
      toggleBtn.style.background = "#166534";
      toggleBtn.style.borderColor = "#166534";
    } else {
      toggleBtn.textContent = "Mark Known";
      toggleBtn.style.background = "#334155";
      toggleBtn.style.borderColor = "#475569";
    }
  }

  // ── Positioning ────────────────────────────────────────────────────────

  private positionNear(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverHeight = this.el.offsetHeight || 180;
    const popoverWidth = this.el.offsetWidth || 260;

    // Center horizontally over the anchor, then clamp to viewport
    let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
    const viewW = window.innerWidth;
    const margin = 8;
    left = Math.max(margin, Math.min(left, viewW - popoverWidth - margin));

    // Prefer above the anchor; if not enough room, place below
    let top = anchorRect.top - popoverHeight - margin;
    if (top < margin) {
      top = anchorRect.bottom + margin;
      if (top + popoverHeight > window.innerHeight - margin) {
        top = window.innerHeight - popoverHeight - margin;
      }
    }

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
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
      this.currentStatus === "known" ? undefined : this.currentFrequencyRank,
    );
  }

  private handleMine(): void {
    if (!this.currentToken) return;
    this.callbacks.onMine(this.currentToken, this.currentEntry);
    this.hide();
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
    document.body.appendChild(singleton.getElement());
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
