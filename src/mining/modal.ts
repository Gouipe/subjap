// ---------------------------------------------------------------------------
// SubJap — Mining modal (DOM vanilla)
// ---------------------------------------------------------------------------
//
// Opened from the content script when the user mines a word from the popover.
// The dialog previews the Anki back card in its order (word sheet, scene,
// notes) and every value is edited in place. A video-frame screenshot and the
// phrase audio are captured automatically, then the card is pushed to the
// local IndexedDB store and (best-effort) to Anki.

import {
  tokenDictionaryForm,
  type RenderedCue,
  type SpanToken,
  type EpisodeContext,
} from "@/core/types";
import { sendMessage } from "@/core/messaging";
import { AI_UNAVAILABLE_MESSAGE } from "@/core/ai-settings";
import { normalizeCueText } from "@/subtitles";
import { forgetVideoSurface, mountVideoSurface } from "@/overlay/mount";
import { captureFrame, hideVideoChromeForCapture } from "./capture";
import {
  createAiSession,
  formatValidatedAiEnrichment,
  type AiEnrichmentInput,
  type AiSession,
} from "./ai-enrichment";
import {
  AI_NOTE_LABEL,
  parseAiNotes,
  serializeAiNotes,
  type AiNoteParagraph,
} from "./ai-notes";
import {
  formatMigakuDefinitions,
  formatMigakuNotes,
  formatMigakuSentence,
  formatMigakuWord,
} from "./migaku";
import type { VideoAudioCapture } from "./audio-capture";

const MODAL_ID = "subjap-mining-modal";

/** Translations shown per dictionary sense: the card stays a reminder, not a dictionary page. */
const MAX_SENSE_GLOSSES = 3;

type CaptureStatus = "pending" | "ready" | "unavailable";

type EditableField =
  | "word"
  | "reading"
  | "sentence"
  | "translation"
  | "kanji-meaning"
  | "kanji-example"
  | "note-line";

interface MiningState {
  cue: RenderedCue;
  targetToken: SpanToken;
  sentenceText: string;
  targetWordText: string;
  readingText: string;
  translationText: string;
  episodeContext: EpisodeContext;
  /** Dictionary senses, each with its English translations. */
  senses: string[][];
  senseSelected: boolean[];
  notesText: string;
  notesOpen: boolean;
  aiParagraphs: AiNoteParagraph[];
  aiGenerating: boolean;
  aiGeneratedOnce: boolean;
  aiStatus: string | null;
  aiError: string | null;
  phraseAudioDataUrl: string | null;
  phraseAudioAttempted: boolean;
  phraseAudioStatus: CaptureStatus;
  screenshotDataUrl: string | null;
  screenshotStatus: CaptureStatus;
  localCardId: string | null;
  ankiError: string | null;
  sending: boolean;
}

interface ActiveEdit {
  element: HTMLElement;
  original: string;
  dirty: boolean;
}

/** Escape HTML so dictionary glosses / surfaces cannot inject markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "a · b · c · …": the ellipsis tells the sense has more translations than shown. */
function senseLabel(glosses: string[]): string {
  const shown = glosses.slice(0, MAX_SENSE_GLOSSES);
  if (glosses.length > MAX_SENSE_GLOSSES) shown.push("…");
  return shown.join(" · ");
}

function selectedSenses(state: MiningState): string[][] {
  return state.senses.filter((_, index) => state.senseSelected[index]);
}

/** One line per kept sense, as shown on the card. */
function selectedDefinitions(state: MiningState): string[] {
  return selectedSenses(state).map(senseLabel);
}

/** Personal notes come last, as in the dialog: the card keeps them after the AI association. */
function combinedNotes(state: MiningState): string {
  return [serializeAiNotes(state.aiParagraphs), state.notesText.trim()]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function defaultSentence(state: MiningState): string {
  return normalizeCueText(state.cue.cue.text) || state.targetToken.token.surface;
}

/** While the sentence and word are untouched, the cue tokens locate the exact target. */
function usesCueSpans(state: MiningState): boolean {
  return (
    state.sentenceText === defaultSentence(state) &&
    state.targetWordText === tokenDictionaryForm(state.targetToken.token)
  );
}

/** Render an edited sentence safely while keeping the target word highlighted. */
function formatEditableSentence(sentence: string, targetWord: string, className = "target"): string {
  const target = targetWord.trim();
  if (!target) return escapeHtml(sentence);
  const targetIndex = sentence.indexOf(target);
  if (targetIndex < 0) return escapeHtml(sentence);
  return `${escapeHtml(sentence.slice(0, targetIndex))}<span class="${className}">${escapeHtml(
    target,
  )}</span>${escapeHtml(sentence.slice(targetIndex + target.length))}`;
}

/** Same highlight as the card: the mined token when untouched, else the edited word. */
function sentencePreviewHtml(state: MiningState): string {
  const { spans } = state.cue;
  if (usesCueSpans(state)) {
    if (spans.some((span) => span.token === state.targetToken.token)) {
      return spans
        .map((span) => {
          const text = escapeHtml(span.token.surface);
          return span.token === state.targetToken.token
            ? `<span class="subjap-target">${text}</span>`
            : text;
        })
        .join("");
    }
    return formatEditableSentence(state.sentenceText, state.targetToken.token.surface, "subjap-target");
  }
  return formatEditableSentence(state.sentenceText, state.targetWordText, "subjap-target");
}

function editableAttributes(field: EditableField, label: string, extra = "", className = ""): string {
  return `class="subjap-editable ${className}" data-edit="${field}" contenteditable="plaintext-only" role="textbox" spellcheck="false" aria-label="${escapeHtml(label)}" ${extra}`;
}

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

const PLAY_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10"/><path d="M8 6l6 4-6 4z"/></svg>';

export class MiningModal {
  private container: HTMLDivElement;
  private video: HTMLVideoElement;
  private audioCapture: VideoAudioCapture | null;
  private state: MiningState | null = null;
  private activeEdit: ActiveEdit | null = null;
  private phraseAudioPromise: Promise<string | undefined> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isOpen = false;

  constructor(video: HTMLVideoElement, audioCapture: VideoAudioCapture | null = null) {
    this.video = video;
    this.audioCapture = audioCapture;
    this.container = this.buildContainer();
    mountVideoSurface(this.container);
    this.injectStyles();
    // Single delegated listeners — sections are re-rendered independently.
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("focusin", (e) => this.onFocusIn(e));
    this.container.addEventListener("focusout", (e) => this.onFocusOut(e));
    this.container.addEventListener("input", (e) => this.onInput(e));
  }

  /** Open the mining modal with the given cue, target word, and episode context. */
  open(state: {
    cue: RenderedCue;
    targetToken: SpanToken;
    lemmaReading: string;
    translation?: string;
    episodeContext: EpisodeContext;
    senses: string[][];
  }): void {
    this.state = {
      cue: state.cue,
      targetToken: state.targetToken,
      sentenceText: normalizeCueText(state.cue.cue.text) || state.targetToken.token.surface,
      targetWordText: tokenDictionaryForm(state.targetToken.token),
      readingText: state.lemmaReading,
      translationText: state.translation ?? "",
      episodeContext: state.episodeContext,
      senses: state.senses,
      // One card tests one meaning: the most common sense until the learner picks the scene's.
      senseSelected: state.senses.map((_, index) => index === 0),
      notesText: "",
      notesOpen: false,
      aiParagraphs: [],
      aiGenerating: false,
      aiGeneratedOnce: false,
      aiStatus: null,
      aiError: null,
      phraseAudioDataUrl: null,
      phraseAudioAttempted: false,
      phraseAudioStatus: "pending",
      screenshotDataUrl: null,
      screenshotStatus: "pending",
      localCardId: null,
      ankiError: null,
      sending: false,
    };
    const modalState = this.state;
    this.activeEdit = null;
    this.isOpen = true;
    this.renderShell();
    this.show();
    this.container.querySelector<HTMLElement>(".subjap-modal-panel")?.focus({ preventScroll: true });
    this.registerKeyboard();
    // Freeze the frame chosen by the learner before phrase replay seeks the
    // Netflix player back to the cue start.
    this.phraseAudioPromise = this.captureScreenshot().then(() => {
      if (this.state !== modalState) return undefined;
      return this.capturePhraseAudio(modalState);
    });
  }

  close(): void {
    this.isOpen = false;
    this.activeEdit = null;
    this.hide();
    this.unregisterKeyboard();
  }

  destroy(): void {
    forgetVideoSurface(this.container);
    this.state = null;
    this.isOpen = false;
    this.close();
    this.phraseAudioPromise = null;
    this.container.remove();
  }

  // ── DOM building ────────────────────────────────────────────────────────

  private buildContainer(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = MODAL_ID;
    el.style.display = "none";
    el.innerHTML = `
      <div class="subjap-modal-backdrop"></div>
      <div class="subjap-modal-panel" role="dialog" aria-modal="true" aria-labelledby="subjap-modal-title" tabindex="-1">
        <div class="subjap-modal-header">
          <div class="subjap-modal-heading">
            <span class="subjap-modal-title" id="subjap-modal-title">Créer une carte</span>
            <span class="subjap-modal-source"></span>
          </div>
          <button class="subjap-modal-close" data-action="close" title="Fermer" aria-label="Fermer">✕</button>
        </div>
        <div class="subjap-modal-body"></div>
        <div class="subjap-modal-footer">
          <div class="subjap-modal-status" role="status" aria-live="polite"></div>
          <button class="subjap-modal-btn subjap-modal-btn-send" data-action="send"></button>
        </div>
      </div>`;
    return el;
  }

  private injectStyles(): void {
    if (document.getElementById("subjap-mining-styles")) return;
    const style = document.createElement("style");
    style.id = "subjap-mining-styles";
    style.textContent = `
      #${MODAL_ID} {
        --sj-canvas: #0c0d10; --sj-surface: #14161b; --sj-raised: #1b1e24;
        --sj-input: #101216; --sj-hairline: #343842; --sj-text: #f4f1ea;
        --sj-muted: #b2b6bf; --sj-accent: #ff624d; --sj-accent-hover: #ff7966;
        --sj-success: #78d6a3; --sj-warning: #f1b46d; --sj-danger: #ff8490;
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
      }
      .subjap-modal-backdrop {
        position: absolute; inset: 0; background: rgba(12,13,16,0.78);
      }
      .subjap-modal-panel {
        position: relative; background: var(--sj-canvas); color: var(--sj-text);
        border: 1px solid var(--sj-hairline); border-radius: 12px; padding: 18px 20px 16px;
        max-width: 760px; width: 94%; box-sizing: border-box; max-height: 90vh; overflow: hidden;
        display: flex; flex-direction: column; box-shadow: 0 8px 8px rgba(0,0,0,0.42);
        font-family: "IBM Plex Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
        font-size: 14px; line-height: 1.55; text-align: left;
      }
      .subjap-modal-panel:focus { outline: none; }
      .subjap-modal-header {
        display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 12px;
        margin-bottom: 14px;
      }
      .subjap-modal-heading { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
      .subjap-modal-title { flex-shrink: 0; font-size: 17px; font-weight: 600; }
      .subjap-modal-source {
        min-width: 0; overflow: hidden; color: var(--sj-muted); font-size: 12px;
        white-space: nowrap; text-overflow: ellipsis;
      }
      .subjap-modal-close {
        flex-shrink: 0; background: none; border: none; color: var(--sj-muted); font-size: 18px;
        cursor: pointer; padding: 4px 8px; border-radius: 6px;
      }
      .subjap-modal-close:hover { background: var(--sj-raised); color: var(--sj-text); }
      .subjap-modal-body {
        flex: 1 1 auto; min-height: 0; overflow-y: auto;
        display: flex; flex-direction: column; gap: 10px;
      }
      .subjap-sheet {
        padding: 14px 18px; border: 1px solid var(--sj-hairline); border-radius: 10px;
        background: var(--sj-surface);
      }
      .subjap-label { color: var(--sj-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }
      .subjap-muted { color: var(--sj-muted); font-size: 13px; }

      .subjap-editable {
        border-radius: 4px; cursor: text; user-select: text; -webkit-user-select: text;
        box-decoration-break: clone; -webkit-box-decoration-break: clone;
        transition: background 120ms cubic-bezier(0.22,1,0.36,1);
      }
      .subjap-editable:hover { background: var(--sj-raised); }
      .subjap-editable:focus {
        outline: 1px solid var(--sj-accent); outline-offset: 2px; background: var(--sj-input);
      }
      .subjap-editable:empty::before { content: attr(data-placeholder); color: var(--sj-muted); }

      .subjap-word-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
      .subjap-word { color: var(--sj-accent-hover); font-size: 36px; font-weight: 600; line-height: 1.25; }
      .subjap-reading { color: var(--sj-muted); font-size: 17px; }
      .subjap-definitions {
        display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-top: 12px;
        border-top: 1px solid var(--sj-hairline);
      }
      /* Kept senses carry a check and full contrast; the others are only set aside, never struck out. */
      .subjap-definition {
        display: inline-flex; align-items: baseline; gap: 6px;
        padding: 4px 10px 4px 8px; border: 1px solid var(--sj-muted); border-radius: 6px;
        background: var(--sj-raised); color: var(--sj-text); font: inherit; font-size: 14px;
        line-height: 1.4; cursor: pointer; text-align: left;
      }
      .subjap-definition::before { content: "✓"; width: 1ch; font-weight: 600; text-align: center; }
      .subjap-definition:hover { border-color: var(--sj-text); }
      .subjap-definition[aria-pressed="false"] {
        border-color: var(--sj-hairline); background: transparent; color: var(--sj-muted);
      }
      .subjap-definition[aria-pressed="false"]::before { content: "+"; opacity: 0; }
      .subjap-definition[aria-pressed="false"]:hover { border-color: var(--sj-muted); color: var(--sj-text); }
      .subjap-definition[aria-pressed="false"]:hover::before,
      .subjap-definition[aria-pressed="false"]:focus-visible::before { opacity: 1; }

      .subjap-scene { display: grid; grid-template-columns: 184px minmax(0, 1fr); gap: 16px; align-items: start; }
      .subjap-scene-image img {
        display: block; width: 100%; max-height: 140px; object-fit: contain;
        border-radius: 6px; background: var(--sj-canvas);
      }
      .subjap-scene-placeholder {
        display: flex; align-items: center; justify-content: center; aspect-ratio: 16 / 9;
        border: 1px dashed var(--sj-hairline); border-radius: 6px; color: var(--sj-muted); font-size: 12px;
      }
      .subjap-sentence { font-size: 22px; line-height: 1.6; white-space: pre-wrap; }
      .subjap-sentence .subjap-target { color: var(--sj-accent-hover); font-weight: 600; }
      .subjap-scene-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
      .subjap-translation { color: var(--sj-muted); font-size: 15px; line-height: 1.55; }

      .subjap-audio-control {
        display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 4px 9px 4px 7px;
        border: 1px solid var(--sj-hairline); border-radius: 6px; background: var(--sj-raised);
        color: var(--sj-text); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .subjap-audio-control svg { width: 18px; height: 18px; }
      .subjap-audio-control svg circle { fill: var(--sj-muted); }
      .subjap-audio-control svg path { fill: var(--sj-raised); }
      .subjap-audio-control:hover:not(:disabled) { border-color: var(--sj-accent); }
      .subjap-audio-control:hover:not(:disabled) svg circle { fill: var(--sj-text); }
      .subjap-audio-control:disabled { opacity: 0.6; cursor: default; }
      .subjap-capture-note { color: var(--sj-muted); font-size: 12px; }

      #${MODAL_ID} kbd {
        padding: 1px 4px; border: 1px solid var(--sj-hairline); border-radius: 3px;
        color: var(--sj-muted); font: inherit; font-size: 11px; font-weight: 500; line-height: 1.2;
      }

      .subjap-notes-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
      .subjap-ai { margin-top: 8px; }
      .subjap-ai:empty { display: none; }
      .subjap-ai-button {
        display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px;
        border: 1px solid var(--sj-hairline); border-radius: 6px; background: var(--sj-raised);
        color: var(--sj-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .subjap-ai-button:hover:not(:disabled) { border-color: var(--sj-accent); }
      .subjap-ai-button:disabled { opacity: 0.6; cursor: default; }
      .subjap-ai-button--quiet { padding: 3px 8px; background: transparent; color: var(--sj-muted); font-weight: 500; }
      .subjap-ai-button--quiet:hover:not(:disabled) { color: var(--sj-text); }
      .subjap-ai-intro { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .subjap-ai-status { color: var(--sj-muted); font-size: 13px; }

      .subjap-kanji-tiles {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 10px;
      }
      .subjap-kanji-tiles:last-child { margin-bottom: 0; }
      .subjap-kanji-tile, .subjap-note-paragraph { position: relative; }
      .subjap-kanji-tile {
        padding: 10px 28px 11px 12px; border: 1px solid var(--sj-hairline); border-radius: 8px;
        background: var(--sj-raised); user-select: text; -webkit-user-select: text;
      }
      .subjap-kanji-tile-head { display: flex; align-items: baseline; gap: 8px; }
      .subjap-kanji-char { font-size: 28px; font-weight: 600; line-height: 1.2; }
      .subjap-kanji-meaning { font-size: 14px; font-weight: 600; line-height: 1.35; }
      .subjap-kanji-examples {
        margin: 6px 0 0; padding: 0; list-style: none; color: var(--sj-muted); font-size: 13px; line-height: 1.5;
      }
      .subjap-kanji-examples li { position: relative; padding-right: 22px; }
      .subjap-kanji-tile .subjap-editable:hover { background: #252932; }
      .subjap-note-paragraph { padding-right: 28px; color: var(--sj-muted); }
      .subjap-note-paragraph + .subjap-note-paragraph { margin-top: 8px; }
      .subjap-notes-term { color: var(--sj-text); font-weight: 600; }
      .subjap-remove {
        position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0;
        border: none; border-radius: 4px; background: transparent; color: var(--sj-muted);
        font-size: 15px; line-height: 22px; cursor: pointer; opacity: 0;
      }
      .subjap-kanji-examples .subjap-remove { top: 0; right: 0; width: 20px; height: 20px; line-height: 20px; font-size: 13px; }
      .subjap-kanji-tile:hover > .subjap-remove, .subjap-note-paragraph:hover > .subjap-remove,
      .subjap-kanji-examples li:hover > .subjap-remove, .subjap-remove:focus-visible { opacity: 1; }
      .subjap-remove:hover { background: var(--sj-canvas); color: var(--sj-danger); }

      .subjap-personal-notes { margin-top: 10px; }
      .subjap-add-note {
        padding: 2px 0; border: none; background: none; color: var(--sj-muted);
        font: inherit; font-size: 13px; cursor: pointer;
      }
      .subjap-add-note:hover { color: var(--sj-text); }
      .subjap-notes {
        display: block; box-sizing: border-box; width: 100%; min-height: 72px; padding: 8px 10px; resize: vertical;
        background: var(--sj-input); color: var(--sj-text); border: 1px solid var(--sj-hairline);
        border-radius: 6px; font: inherit; line-height: 1.5;
      }
      .subjap-notes:focus { outline: 1px solid var(--sj-accent); outline-offset: 1px; }

      .subjap-modal-footer {
        display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px;
        margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--sj-hairline);
      }
      .subjap-modal-status { min-width: 0; font-size: 13px; }
      .subjap-local-info { color: var(--sj-warning); }
      .subjap-error { color: var(--sj-danger); }
      .subjap-modal-btn {
        display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0;
        padding: 10px 16px; border: 1px solid var(--sj-hairline); border-radius: 6px;
        font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        transition: background 160ms cubic-bezier(0.22,1,0.36,1), transform 160ms cubic-bezier(0.22,1,0.36,1);
      }
      .subjap-modal-btn:disabled { opacity: 0.6; cursor: default; }
      .subjap-modal-btn-send { background: var(--sj-accent); border-color: var(--sj-accent); color: var(--sj-canvas); }
      .subjap-modal-btn-send:hover:not(:disabled) { background: var(--sj-accent-hover); }
      #${MODAL_ID} .subjap-modal-btn-send kbd { border-color: rgba(12,13,16,0.35); color: var(--sj-canvas); }
      .subjap-modal-btn:active:not(:disabled) { transform: translateY(1px); }
      #${MODAL_ID} button:focus-visible { outline: 2px solid var(--sj-accent); outline-offset: 2px; }

      @media (max-width: 560px) {
        .subjap-scene { grid-template-columns: minmax(0, 1fr); }
        .subjap-scene-image { max-width: 240px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .subjap-modal-btn, .subjap-editable { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private get body(): HTMLElement | null {
    return this.container.querySelector<HTMLElement>(".subjap-modal-body");
  }

  /** Build the card preview once per opening; later updates only touch their section. */
  private renderShell(): void {
    const state = this.state;
    const body = this.body;
    if (!state || !body) return;

    const source = this.container.querySelector(".subjap-modal-source");
    if (source) source.textContent = state.episodeContext.title;

    body.innerHTML = `
      <section class="subjap-sheet subjap-word-sheet">
        <div class="subjap-word-line">
          <span ${editableAttributes("word", "Mot", 'data-testid="mining-target-word"', "subjap-word subjap-target-word")}>${escapeHtml(state.targetWordText)}</span>
          <span ${editableAttributes("reading", "Lecture", 'data-testid="mining-reading" data-placeholder="Lecture"', "subjap-reading")}>${escapeHtml(state.readingText)}</span>
        </div>
        <div class="subjap-definitions" data-testid="mining-definitions" role="group" aria-label="Définitions"></div>
      </section>
      <section class="subjap-sheet subjap-scene">
        <div class="subjap-scene-image"></div>
        <div class="subjap-scene-text">
          <div ${editableAttributes("sentence", "Phrase", 'data-testid="mining-sentence"', "subjap-sentence")}></div>
          <div class="subjap-scene-controls"></div>
          <div ${editableAttributes("translation", "Traduction", 'data-testid="mining-translation" data-placeholder="Ajouter une traduction"', "subjap-translation")}>${escapeHtml(state.translationText)}</div>
        </div>
      </section>
      <section class="subjap-sheet subjap-notes-sheet">
        <div class="subjap-notes-head">
          <span class="subjap-label">Notes</span>
          <span class="subjap-ai-action"></span>
        </div>
        <div class="subjap-ai"></div>
        <div class="subjap-personal-notes"></div>
      </section>`;

    this.renderSentence();
    this.renderDefinitions();
    this.renderMedia();
    this.renderAi();
    this.renderPersonalNotes();
    this.renderFooter();
  }

  private renderSentence(): void {
    const state = this.state;
    const sentence = this.body?.querySelector<HTMLElement>(".subjap-sentence");
    if (!state || !sentence) return;
    sentence.innerHTML = sentencePreviewHtml(state);
  }

  private renderDefinitions(): void {
    const state = this.state;
    const list = this.body?.querySelector<HTMLElement>(".subjap-definitions");
    if (!state || !list) return;
    list.innerHTML =
      state.senses.length > 0
        ? state.senses
            .map((glosses, index) => {
              const selected = state.senseSelected[index] === true;
              return `<button type="button" class="subjap-definition" data-action="toggle-definition" data-index="${index}" aria-pressed="${selected}" title="${escapeHtml(glosses.join(" · "))}">${escapeHtml(senseLabel(glosses))}</button>`;
            })
            .join("")
        : '<span class="subjap-muted">Aucune définition dans le dictionnaire.</span>';
  }

  /** Screenshot thumbnail and phrase audio control, both filled in by background captures. */
  private renderMedia(): void {
    const state = this.state;
    const body = this.body;
    if (!state || !body) return;

    const image = body.querySelector<HTMLElement>(".subjap-scene-image");
    if (image) {
      image.innerHTML =
        state.screenshotStatus === "ready" && state.screenshotDataUrl
          ? `<img src="${escapeHtml(state.screenshotDataUrl)}" alt="Image de la scène" />`
          : `<div class="subjap-scene-placeholder">${
              state.screenshotStatus === "pending" ? "Capture de l’image…" : "Image indisponible"
            }</div>`;
    }

    const controls = body.querySelector<HTMLElement>(".subjap-scene-controls");
    if (controls) {
      const ready = state.phraseAudioStatus === "ready" && state.phraseAudioDataUrl !== null;
      const note =
        state.phraseAudioStatus === "pending"
          ? '<span class="subjap-capture-note">Capture de l’audio…</span>'
          : state.phraseAudioStatus === "unavailable"
            ? '<span class="subjap-capture-note">Audio de la phrase indisponible</span>'
            : "";
      controls.innerHTML = `
        <button type="button" class="subjap-audio-control" data-action="play-phrase" aria-keyshortcuts="Q" title="Écouter la phrase (Q)" ${ready ? "" : "disabled"}>
          ${PLAY_ICON}<span>Phrase</span><kbd aria-hidden="true">Q</kbd>
        </button>
        ${note}`;
    }
  }

  /** AI enrichment: a launch button until generated, then the editable tiles of the card. */
  private renderAi(): void {
    const state = this.state;
    const body = this.body;
    if (!state || !body) return;
    const action = body.querySelector<HTMLElement>(".subjap-ai-action");
    const section = body.querySelector<HTMLElement>(".subjap-ai");
    if (!action || !section) return;
    if (this.activeEdit && section.contains(this.activeEdit.element)) this.activeEdit = null;

    const disabled = state.aiGenerating || state.sending ? "disabled" : "";
    const status = state.aiStatus
      ? `<span class="subjap-ai-status">${escapeHtml(state.aiStatus)}</span>`
      : "";
    const error = state.aiError
      ? `<div class="subjap-error">${escapeHtml(state.aiError)}</div>`
      : "";

    if (!state.aiGeneratedOnce) {
      action.innerHTML = "";
      section.innerHTML = `
        <div class="subjap-ai-intro">
          <button type="button" class="subjap-ai-button subjap-modal-btn-ai" data-action="ai" data-testid="mining-ai-enrich" aria-keyshortcuts="I" ${disabled}>
            ${state.aiGenerating ? "Analyse en cours…" : "✨ Enrichir avec l’IA"}<kbd aria-hidden="true">I</kbd>
          </button>
          ${status || '<span class="subjap-ai-status">Kanjis, synonymes et association</span>'}
        </div>
        ${error}`;
      return;
    }

    action.innerHTML = `
      <button type="button" class="subjap-ai-button subjap-ai-button--quiet subjap-modal-btn-ai" data-action="ai" data-testid="mining-ai-enrich" aria-keyshortcuts="I" ${disabled}>
        ${state.aiGenerating ? "Analyse en cours…" : "↻ Régénérer"}<kbd aria-hidden="true">I</kbd>
      </button>`;

    const tiles: string[] = [];
    const texts: string[] = [];
    state.aiParagraphs.forEach((paragraph, p) => {
      if (paragraph.kind === "kanji") {
        const examples = paragraph.examples
          .map(
            (example, i) => `<li>
              <span ${editableAttributes("kanji-example", `Exemple pour ${paragraph.character}`, `data-paragraph="${p}" data-index="${i}"`)}>${escapeHtml(example)}</span>
              <button type="button" class="subjap-remove" data-action="remove-example" data-paragraph="${p}" data-index="${i}" title="Supprimer l’exemple" aria-label="Supprimer l’exemple">×</button>
            </li>`,
          )
          .join("");
        tiles.push(`<div class="subjap-kanji-tile">
          <div class="subjap-kanji-tile-head">
            <span class="subjap-kanji-char">${escapeHtml(paragraph.character)}</span>
            <span ${editableAttributes("kanji-meaning", `Sens de ${paragraph.character}`, `data-paragraph="${p}"`, "subjap-kanji-meaning")}>${escapeHtml(paragraph.meaning)}</span>
          </div>
          ${examples ? `<ul class="subjap-kanji-examples">${examples}</ul>` : ""}
          <button type="button" class="subjap-remove" data-action="remove-paragraph" data-paragraph="${p}" title="Supprimer la tuile" aria-label="Supprimer la tuile ${escapeHtml(paragraph.character)}">×</button>
        </div>`);
        return;
      }
      const lines = paragraph.lines
        .map((line, i) => {
          const [, term, text = line] = AI_NOTE_LABEL.exec(line) ?? [];
          const termHtml = term ? `<span class="subjap-notes-term">${escapeHtml(term)}</span> ` : "";
          const label = term ? term.replace(/ :$/u, "") : "Note";
          return `<div>${termHtml}<span ${editableAttributes("note-line", label, `data-paragraph="${p}" data-index="${i}"`)}>${escapeHtml(text)}</span></div>`;
        })
        .join("");
      texts.push(`<div class="subjap-note-paragraph">
        ${lines}
        <button type="button" class="subjap-remove" data-action="remove-paragraph" data-paragraph="${p}" title="Supprimer" aria-label="Supprimer ce paragraphe">×</button>
      </div>`);
    });

    const empty =
      state.aiParagraphs.length === 0 && !state.aiGenerating && !state.aiStatus
        ? '<span class="subjap-ai-status">Enrichissement supprimé.</span>'
        : "";
    section.innerHTML = `
      ${tiles.length > 0 ? `<div class="subjap-kanji-tiles">${tiles.join("")}</div>` : ""}
      ${texts.join("")}
      ${status || empty}
      ${error}`;
  }

  private renderPersonalNotes(): void {
    const state = this.state;
    const container = this.body?.querySelector<HTMLElement>(".subjap-personal-notes");
    if (!state || !container) return;
    container.innerHTML = state.notesOpen
      ? `<textarea class="subjap-notes" data-testid="mining-notes" aria-label="Note personnelle" placeholder="Note personnelle pour Anki…">${escapeHtml(state.notesText)}</textarea>`
      : '<button type="button" class="subjap-add-note" data-action="add-note">+ Ajouter une note</button>';
  }

  private renderFooter(): void {
    const state = this.state;
    if (!state) return;
    const status = this.container.querySelector<HTMLElement>(".subjap-modal-status");
    if (status) {
      const localInfo = state.localCardId
        ? '<div class="subjap-local-info">✓ Carte sauvegardée localement</div>'
        : "";
      const ankiError = state.ankiError
        ? `<div class="subjap-error">Erreur d’envoi : ${escapeHtml(state.ankiError)}</div>`
        : "";
      status.innerHTML = `${localInfo}${ankiError}`;
    }
    const send = this.container.querySelector<HTMLButtonElement>(".subjap-modal-btn-send");
    if (send) {
      const label = state.sending
        ? "Envoi…"
        : state.localCardId && state.ankiError
          ? "↻ Réessayer Anki"
          : "Créer dans Anki";
      send.disabled = state.sending;
      send.setAttribute("aria-keyshortcuts", "Control+Enter");
      send.innerHTML = `${label}<kbd aria-hidden="true">Ctrl+Entrée</kbd>`;
    }
  }

  // ── In-place editing ────────────────────────────────────────────────────

  private fieldValue(element: HTMLElement): string {
    const state = this.state;
    if (!state) return "";
    const paragraph = state.aiParagraphs[Number(element.dataset.paragraph)];
    const index = Number(element.dataset.index);
    switch (element.dataset.edit as EditableField) {
      case "word":
        return state.targetWordText;
      case "reading":
        return state.readingText;
      case "sentence":
        return state.sentenceText;
      case "translation":
        return state.translationText;
      case "kanji-meaning":
        return paragraph?.kind === "kanji" ? paragraph.meaning : "";
      case "kanji-example":
        return paragraph?.kind === "kanji" ? (paragraph.examples[index] ?? "") : "";
      case "note-line": {
        const line = paragraph?.kind === "text" ? (paragraph.lines[index] ?? "") : "";
        return AI_NOTE_LABEL.exec(line)?.[2] ?? line;
      }
      default:
        return "";
    }
  }

  private setFieldValue(element: HTMLElement, value: string): void {
    const state = this.state;
    if (!state) return;
    const paragraph = state.aiParagraphs[Number(element.dataset.paragraph)];
    const index = Number(element.dataset.index);
    switch (element.dataset.edit as EditableField) {
      case "word":
        state.targetWordText = value;
        break;
      case "reading":
        state.readingText = value;
        break;
      case "sentence":
        state.sentenceText = value;
        break;
      case "translation":
        state.translationText = value;
        break;
      case "kanji-meaning":
        if (paragraph?.kind === "kanji") paragraph.meaning = value;
        break;
      case "kanji-example":
        if (paragraph?.kind === "kanji") paragraph.examples[index] = value;
        break;
      case "note-line":
        if (paragraph?.kind === "text") {
          const label = AI_NOTE_LABEL.exec(paragraph.lines[index] ?? "")?.[1];
          paragraph.lines[index] = label ? `${label} ${value}` : value;
        }
        break;
    }
  }

  /** Show a field's committed value again (the sentence with its highlight). */
  private redrawField(element: HTMLElement): void {
    if (element.dataset.edit === "sentence") {
      this.renderSentence();
    } else {
      element.textContent = this.fieldValue(element);
    }
  }

  /** Normalize an edited value; required fields fall back to their value before the edit. */
  private commitEdit(edit: ActiveEdit): void {
    const state = this.state;
    if (!state) return;
    const { element } = edit;
    const field = element.dataset.edit as EditableField;
    const raw = element.textContent ?? "";
    const value = field === "sentence" ? normalizeCueText(raw) : raw.replace(/\s+/gu, " ").trim();

    if (!value && (field === "word" || field === "sentence" || field === "kanji-meaning")) {
      this.setFieldValue(element, edit.original);
    } else if (!value && (field === "kanji-example" || field === "note-line")) {
      this.removeAiItem(Number(element.dataset.paragraph), Number(element.dataset.index));
      return;
    } else {
      this.setFieldValue(element, value);
    }

    if (field === "word") this.renderSentence();
    this.redrawField(element);
  }

  private onFocusIn(event: FocusEvent): void {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-edit]");
    if (!element) return;
    this.activeEdit = { element, original: this.fieldValue(element), dirty: false };
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLElement | null;
    const state = this.state;
    if (!target || !state) return;
    if (target.matches(".subjap-notes")) {
      state.notesText = (target as HTMLTextAreaElement).value;
      return;
    }
    const edit = this.activeEdit;
    if (!edit || !edit.element.contains(target)) return;
    edit.dirty = true;
    this.setFieldValue(edit.element, edit.element.textContent ?? "");
  }

  private onFocusOut(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    const state = this.state;
    if (!target || !state) return;
    if (target.matches(".subjap-notes")) {
      if (!state.notesText.trim()) {
        state.notesOpen = false;
        this.renderPersonalNotes();
      }
      return;
    }
    const edit = this.activeEdit;
    if (!edit || edit.element !== target) return;
    this.activeEdit = null;
    // A focus without typing keeps the cue tokens as the sentence source.
    if (edit.dirty) this.commitEdit(edit);
  }

  private cancelEdit(): void {
    const edit = this.activeEdit;
    if (!edit) return;
    edit.dirty = false;
    this.setFieldValue(edit.element, edit.original);
    this.redrawField(edit.element);
    edit.element.blur();
  }

  /** Leave the current field so its value is committed before an action reads the state. */
  private commitActiveEdit(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.container.contains(active) && isTextInput(active)) {
      active.blur();
    }
  }

  private removeAiItem(paragraphIndex: number, itemIndex?: number): void {
    const state = this.state;
    const paragraph = state?.aiParagraphs[paragraphIndex];
    if (!state || !paragraph) return;
    if (itemIndex !== undefined && Number.isInteger(itemIndex)) {
      if (paragraph.kind === "kanji") paragraph.examples.splice(itemIndex, 1);
      else paragraph.lines.splice(itemIndex, 1);
      if (paragraph.kind === "text" && paragraph.lines.length === 0) {
        state.aiParagraphs.splice(paragraphIndex, 1);
      }
    } else {
      state.aiParagraphs.splice(paragraphIndex, 1);
    }
    this.renderAi();
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private onClick(event: MouseEvent): void {
    const state = this.state;
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!state || !button || (button as HTMLButtonElement).disabled) return;
    const paragraph = Number(button.dataset.paragraph);
    switch (button.dataset.action) {
      case "close":
        this.close();
        break;
      case "send":
        void this.submit();
        break;
      case "ai":
        void this.generateAiNotes();
        break;
      case "play-phrase":
        this.playPhraseAudio();
        break;
      case "toggle-definition": {
        const index = Number(button.dataset.index);
        state.senseSelected[index] = !state.senseSelected[index];
        button.setAttribute("aria-pressed", String(state.senseSelected[index]));
        break;
      }
      case "add-note":
        state.notesOpen = true;
        this.renderPersonalNotes();
        this.body?.querySelector<HTMLTextAreaElement>(".subjap-notes")?.focus();
        break;
      case "remove-example":
        this.removeAiItem(paragraph, Number(button.dataset.index));
        break;
      case "remove-paragraph":
        this.removeAiItem(paragraph);
        break;
    }
  }

  private async submit(): Promise<void> {
    this.commitActiveEdit();
    await this.sendToAnki();
  }

  private async generateAiNotes(): Promise<void> {
    const state = this.state;
    if (!state || state.aiGenerating || state.sending) return;
    this.commitActiveEdit();

    state.aiGenerating = true;
    state.aiStatus = "Préparation de tes exemples familiers…";
    state.aiError = null;
    this.renderAi();

    const aiSessionRef: { current: AiSession | null } = { current: null };
    try {
      // Start both operations from the explicit click while IndexedDB builds
      // the small candidate list.
      const candidatesPromise = sendMessage("ai:prepareEnrichment", {
        targetWord: state.targetWordText.trim(),
      });
      const sessionPromise = createAiSession((message) => {
        if (this.state !== state) return;
        state.aiStatus = message;
        this.renderAi();
      }).then((session) => {
        aiSessionRef.current = session;
        return session;
      });
      const [session, { kanji }] = await Promise.all([sessionPromise, candidatesPromise]);
      if (this.state !== state) return;

      const input: AiEnrichmentInput = {
        targetWord: state.targetWordText.trim(),
        targetReading: state.readingText.trim(),
        sentence: state.sentenceText.trim(),
        definitions: selectedSenses(state).map((glosses) => glosses.join(", ")),
        kanjiCandidates: kanji,
      };
      const raw = await session.generate(input, state.aiGeneratedOnce);
      const formatted = await formatValidatedAiEnrichment(raw, input);
      if (this.state !== state) return;

      state.aiGeneratedOnce = true;
      state.aiParagraphs = parseAiNotes(formatted);
      state.aiStatus = formatted ? null : "Aucun enrichissement suffisamment fiable trouvé.";
    } catch (err) {
      if (this.state !== state) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        state.aiError = AI_UNAVAILABLE_MESSAGE;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        state.aiError =
          message === AI_UNAVAILABLE_MESSAGE ? message : `IA distante : ${message}`;
      }
      state.aiStatus = null;
    } finally {
      aiSessionRef.current?.destroy();
      if (this.state === state) {
        state.aiGenerating = false;
        this.renderAi();
      }
    }
  }

  /** Replay the captured Netflix phrase audio without recapturing it. */
  private playPhraseAudio(): void {
    const dataUrl = this.state?.phraseAudioDataUrl;
    if (!dataUrl) return;
    const preview = new Audio(dataUrl);
    try {
      void Promise.resolve(preview.play()).catch(() => undefined);
    } catch {
      // Preview playback can be blocked by autoplay policy.
    }
  }

  private async captureScreenshot(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const wasVisible = this.isOpen && this.container.style.display !== "none";
    if (wasVisible) {
      // Capture the Netflix frame without the SubJap mining dialog covering
      // it. Restore the dialog as soon as the browser capture has completed.
      this.hide();
      this.container.remove();
    }
    // The card keeps the sentence and translation as text, so the picture
    // drops the player controls and every subtitle layer.
    const restoreVideoChrome = hideVideoChromeForCapture();
    try {
      await this.waitForCapturePaint();
      const tabVideo = await this.audioCapture?.getTabVideo();
      const screenshotDataUrl = await captureFrame(this.video, undefined, tabVideo);
      // Ignore a late capture if the modal was closed and reopened for a
      // different card while the video frame was being read.
      if (this.state !== state) return;
      state.screenshotDataUrl = screenshotDataUrl;
    } catch (err) {
      console.error("[SubJap] Screenshot capture failed:", err);
    } finally {
      restoreVideoChrome();
      if (this.state === state) {
        state.screenshotStatus = state.screenshotDataUrl ? "ready" : "unavailable";
      }
      if (wasVisible && this.state === state && this.isOpen) {
        mountVideoSurface(this.container);
        this.show();
        if (!this.container.contains(document.activeElement)) {
          this.container.querySelector<HTMLElement>(".subjap-modal-panel")?.focus({ preventScroll: true });
        }
      }
      if (this.state === state && this.isOpen) this.renderMedia();
    }
  }

  private async waitForCapturePaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      const raf = window.requestAnimationFrame;
      if (typeof raf !== "function") {
        setTimeout(resolve, 50);
        return;
      }
      raf(() => raf(() => resolve()));
    });
    // Give Chrome's tab compositor one more short interval to publish the
    // frame in which the modal is absent from the captured tab stream.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  private async capturePhraseAudio(state: MiningState): Promise<string | undefined> {
    state.phraseAudioAttempted = true;
    const dataUrl = await this.audioCapture?.captureCue(
      state.cue.cue,
      0.3,
      (start, end) => {
        if (this.state !== state) return;
        state.cue = {
          ...state.cue,
          cue: {
            ...state.cue.cue,
            start,
            end,
            endConfirmed: true,
          },
        };
      },
    );
    if (this.state === state) {
      state.phraseAudioDataUrl = dataUrl ?? null;
      state.phraseAudioStatus = dataUrl ? "ready" : "unavailable";
      this.renderMedia();
    }
    return dataUrl;
  }

  /**
   * Create the local card (IndexedDB via the service worker), then push a
   * best-effort copy to AnkiConnect when available. The local card is the
   * source of truth — an Anki failure never blocks the flow.
   */
  private async sendToAnki(): Promise<void> {
    if (!this.state || this.state.sending) return;
    const state = this.state;
    const { targetToken, episodeContext } = state;

    const sentence = state.sentenceText.trim() || state.targetWordText.trim() || targetToken.token.surface;
    const targetWord = state.targetWordText.trim() || tokenDictionaryForm(targetToken.token);
    const targetReading = state.readingText.trim();
    const phrase = usesCueSpans(state)
      ? formatMigakuSentence(state.cue, targetToken)
      : formatEditableSentence(sentence, targetWord);
    const editedDefinitions = selectedDefinitions(state);
    const notes = combinedNotes(state);

    state.sending = true;
    state.ankiError = null;
    this.renderFooter();
    this.renderAi();

    let phraseAudioDataUrl: string | undefined = state.phraseAudioDataUrl ?? undefined;
    if (!phraseAudioDataUrl && this.phraseAudioPromise) {
      phraseAudioDataUrl = await this.phraseAudioPromise;
    }
    if (!phraseAudioDataUrl && this.audioCapture && !state.phraseAudioAttempted) {
      phraseAudioDataUrl = await this.capturePhraseAudio(state);
    }
    const resolvedCue = state.cue.cue;
    if (
      !phraseAudioDataUrl &&
      resolvedCue.endConfirmed !== false &&
      resolvedCue.end > resolvedCue.start
    ) {
      phraseAudioDataUrl = this.audioCapture?.captureSegment(
        resolvedCue.start,
        resolvedCue.end,
      );
    }
    state.phraseAudioDataUrl = phraseAudioDataUrl ?? null;

    try {
      if (!state.localCardId) {
        const { id } = await sendMessage("mine:create", {
          sentence,
          sentenceReading: "",
          targetWord,
          targetSurface: targetWord,
          targetReading,
          definitions: editedDefinitions,
          notes,
          audioDataUrl: phraseAudioDataUrl,
          screenshotDataUrl: state.screenshotDataUrl ?? undefined,
          source: episodeContext,
          cueStart: resolvedCue.start,
          cueEnd: resolvedCue.end,
          srs: {
            state: "new",
            intervalDays: 0,
            ease: 2.5,
            due: Date.now(),
            reps: 0,
            lapses: 0,
          },
          tags: [],
        });
        state.localCardId = id;
        console.log(`[SubJap] Card created: ${id}`);
      } else {
        await sendMessage("mine:updateNotes", { id: state.localCardId, notes });
      }

      try {
        const { deckName } = await sendMessage("anki:setup", {});
        await sendMessage("anki:addNote", {
          deckName,
          fields: {
            Mot: formatMigakuWord(targetWord, targetReading),
            Lecture: targetReading,
            Phrase: phrase,
            Traduction: state.translationText.trim(),
            Définitions: formatMigakuDefinitions(editedDefinitions),
            Notes: formatMigakuNotes(notes),
            Image: "",
            AudioMot: "",
            AudioPhrase: "",
          },
          audioPhraseDataUrl: phraseAudioDataUrl ?? undefined,
          imageDataUrl: state.screenshotDataUrl ?? undefined,
          tags: ["subjap", episodeContext.platform],
        });
      } catch (err) {
        console.warn("[SubJap] Anki push failed (local card kept):", err);
        if (this.state === state) {
          state.ankiError = err instanceof Error ? err.message : String(err);
          state.sending = false;
          this.renderFooter();
          this.renderAi();
        }
        return;
      }

      this.close();
    } catch (err) {
      console.error("[SubJap] Failed to create card:", err);
      state.sending = false;
      state.ankiError = err instanceof Error ? err.message : String(err);
      this.renderFooter();
      this.renderAi();
    }
  }

  // ── Visibility ──────────────────────────────────────────────────────────

  private show(): void {
    this.container.style.display = "flex";
  }

  private hide(): void {
    this.container.style.display = "none";
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  private registerKeyboard(): void {
    this.unregisterKeyboard();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      // The dialog is modal: video and overlay shortcuts stay silent while it is
      // open. Stopping propagation keeps default actions such as typing.
      e.stopPropagation();

      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!e.repeat) void this.submit();
        return;
      }
      if (this.activeEdit) {
        if (e.key === "Enter") {
          e.preventDefault();
          this.activeEdit.element.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.cancelEdit();
        }
        return;
      }
      if (e.key === "Escape") {
        // Only the close button dismisses the dialog: Escape never discards the card.
        e.preventDefault();
        if (e.target instanceof HTMLTextAreaElement) e.target.blur();
        return;
      }
      if (isTextInput(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      switch (e.key.toLowerCase()) {
        case "q":
          e.preventDefault();
          this.playPhraseAudio();
          break;
        case "i":
          e.preventDefault();
          void this.generateAiNotes();
          break;
      }
    };
    window.addEventListener("keydown", this.keyHandler, true);
  }

  private unregisterKeyboard(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
  }
}
