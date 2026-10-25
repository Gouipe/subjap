// ---------------------------------------------------------------------------
// SubJap — Mining modal (DOM vanilla)
// ---------------------------------------------------------------------------
//
// Opened from the content script when the user mines a word from the popover.
// Shows the sentence with the target highlighted, the reading and editable
// definitions, and editable Anki notes; a video-frame screenshot is captured
// automatically, then the card is pushed to the local IndexedDB store and
// (best-effort) to Anki.

import {
  tokenDictionaryForm,
  type RenderedCue,
  type SpanToken,
  type EpisodeContext,
} from "@/core/types";
import { sendMessage } from "@/core/messaging";
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
  formatMigakuDefinitions,
  formatMigakuNotes,
  formatMigakuSentence,
  formatMigakuWord,
} from "./migaku";
import type { VideoAudioCapture } from "./audio-capture";

const MODAL_ID = "subjap-mining-modal";

interface MiningState {
  cue: RenderedCue;
  targetToken: SpanToken;
  sentenceText: string;
  targetWordText: string;
  readingText: string;
  translationText: string;
  episodeContext: EpisodeContext;
  definitions: string[];
  definitionText: string;
  notesText: string;
  aiNotesText: string;
  aiGenerating: boolean;
  aiGeneratedOnce: boolean;
  aiStatus: string | null;
  aiError: string | null;
  phraseAudioDataUrl: string | null;
  phraseAudioAttempted: boolean;
  screenshotDataUrl: string | null;
  localCardId: string | null;
  ankiError: string | null;
  sending: boolean;
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

function definitionLines(text: string): string[] {
  return text
    .split(/[\r\n,]+/u)
    .map((definition) => definition.trim())
    .filter((definition) => definition.length > 0);
}

function combinedNotes(state: MiningState): string {
  return [state.notesText.trim(), state.aiNotesText.trim()]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

/** Render an edited sentence safely while keeping the target word highlighted. */
function formatEditableSentence(sentence: string, targetWord: string): string {
  const target = targetWord.trim();
  if (!target) return escapeHtml(sentence);
  const targetIndex = sentence.indexOf(target);
  if (targetIndex < 0) return escapeHtml(sentence);
  return `${escapeHtml(sentence.slice(0, targetIndex))}<span class="target">${escapeHtml(
    target,
  )}</span>${escapeHtml(sentence.slice(targetIndex + target.length))}`;
}

export class MiningModal {
  private container: HTMLDivElement;
  private video: HTMLVideoElement;
  private audioCapture: VideoAudioCapture | null;
  private state: MiningState | null = null;
  private phraseAudioPromise: Promise<string | undefined> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isOpen = false;

  constructor(video: HTMLVideoElement, audioCapture: VideoAudioCapture | null = null) {
    this.video = video;
    this.audioCapture = audioCapture;
    this.container = this.buildContainer();
    mountVideoSurface(this.container);
    this.injectStyles();
    // Single delegated listener — avoids duplicate handlers across re-renders.
    this.container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("subjap-modal-btn-phrase-audio")) {
        this.playPhraseAudio();
      } else if (target.classList.contains("subjap-modal-btn-ai")) {
        void this.generateAiNotes();
      } else if (target.classList.contains("subjap-modal-btn-send")) {
        void this.sendToAnki();
      } else if (target.classList.contains("subjap-modal-close")) {
        this.close();
      }
    });
  }

  /** Open the mining modal with the given cue, target word, and episode context. */
  open(state: {
    cue: RenderedCue;
    targetToken: SpanToken;
    lemmaReading: string;
    translation?: string;
    episodeContext: EpisodeContext;
    definitions: string[];
  }): void {
    this.state = {
      cue: state.cue,
      targetToken: state.targetToken,
      sentenceText: normalizeCueText(state.cue.cue.text) || state.targetToken.token.surface,
      targetWordText: tokenDictionaryForm(state.targetToken.token),
      readingText: state.lemmaReading,
      translationText: state.translation ?? "",
      episodeContext: state.episodeContext,
      definitions: state.definitions,
      definitionText: state.definitions.join(", "),
      notesText: "",
      aiNotesText: "",
      aiGenerating: false,
      aiGeneratedOnce: false,
      aiStatus: null,
      aiError: null,
      phraseAudioDataUrl: null,
      phraseAudioAttempted: false,
      screenshotDataUrl: null,
      localCardId: null,
      ankiError: null,
      sending: false,
    };
    const modalState = this.state;
    this.isOpen = true;
    this.render();
    this.show();
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
      <div class="subjap-modal-panel">
        <div class="subjap-modal-header">
          <span class="subjap-modal-title">Créer une carte</span>
          <button class="subjap-modal-close" title="Fermer" aria-label="Fermer">✕</button>
        </div>
        <div class="subjap-modal-body"></div>
        <div class="subjap-modal-footer">
          <button class="subjap-modal-btn subjap-modal-btn-phrase-audio" disabled>Audio de la phrase</button>
          <button class="subjap-modal-btn subjap-modal-btn-send">Créer dans Anki</button>
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
        position: relative; background: var(--sj-surface); color: var(--sj-text);
        border-radius: 12px; padding: 20px 24px; max-width: 720px; width: 94%;
        box-sizing: border-box; height: 80vh; max-height: 80vh; overflow: hidden;
        display: flex; flex-direction: column; box-shadow: 0 8px 8px rgba(0,0,0,0.42);
        font-family: "IBM Plex Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
      }
      .subjap-modal-header {
        display: flex; flex-shrink: 0; justify-content: space-between; align-items: center;
        margin-bottom: 16px; border-bottom: 1px solid var(--sj-hairline); padding-bottom: 10px;
      }
      .subjap-modal-title { font-size: 17px; font-weight: 600; }
      .subjap-modal-close {
        background: none; border: none; color: var(--sj-muted); font-size: 20px;
        cursor: pointer; padding: 4px 8px; border-radius: 6px;
      }
      .subjap-modal-close:hover { background: var(--sj-raised); color: var(--sj-text); }
      .subjap-modal-body {
        flex: 1 1 auto; min-height: 0; overflow-y: auto; margin-bottom: 16px;
        line-height: 1.6; font-size: 14px;
      }
      .subjap-modal-body .subjap-sentence {
        font-size: 24px; margin-bottom: 12px; padding: 12px; background: var(--sj-raised); border-radius: 8px;
        user-select: text; cursor: text;
      }
      .subjap-modal-body .subjap-sentence .subjap-target { color: var(--sj-accent-hover); font-weight: 600; }
      .subjap-modal-body .subjap-target-word { user-select: text; cursor: text; }
      .subjap-modal-body .subjap-label { font-size: 12px; color: var(--sj-muted); font-weight: 500; }
      .subjap-modal-body .subjap-input, .subjap-modal-body .subjap-textarea {
        display: block; box-sizing: border-box; width: 100%; margin: 4px 0 12px; padding: 8px 10px;
        background: var(--sj-input); color: var(--sj-text); border: 1px solid var(--sj-hairline);
        border-radius: 6px; font: inherit; line-height: 1.45;
      }
      .subjap-modal-body .subjap-input:focus, .subjap-modal-body .subjap-textarea:focus {
        outline: 2px solid var(--sj-accent); outline-offset: 1px;
      }
      .subjap-modal-body .subjap-sentence-input { min-height: 78px; resize: vertical; font-size: 24px; }
      .subjap-modal-body .subjap-translation { min-height: 58px; resize: vertical; }
      .subjap-modal-body .subjap-definitions {
        display: block; box-sizing: border-box; width: 100%; height: calc(2 * 1.45em + 16px);
        margin: 4px 0 12px; padding: 8px 10px; resize: vertical;
        background: var(--sj-input); color: var(--sj-text); border: 1px solid var(--sj-hairline);
        border-radius: 6px; font: inherit; line-height: 1.45;
      }
      .subjap-modal-body .subjap-definitions:focus {
        outline: 2px solid var(--sj-accent); outline-offset: 1px;
      }
      .subjap-modal-body .subjap-notes {
        display: block; box-sizing: border-box; width: 100%; min-height: 120px;
        margin: 4px 0 12px; padding: 8px 10px; resize: vertical;
        background: var(--sj-input); color: var(--sj-text); border: 1px solid var(--sj-hairline);
        border-radius: 6px; font: inherit; line-height: 1.45;
      }
      .subjap-modal-body .subjap-notes:focus, .subjap-modal-body .subjap-ai-notes:focus {
        outline: 2px solid var(--sj-accent); outline-offset: 1px;
      }
      .subjap-modal-body .subjap-ai-controls {
        display: flex; align-items: center; gap: 10px; margin: 0 0 10px;
      }
      .subjap-modal-body .subjap-modal-btn-ai {
        flex: 0 0 auto; padding: 8px 12px; min-width: 170px;
        background: var(--sj-raised); color: var(--sj-text); border: 1px solid var(--sj-hairline);
      }
      .subjap-modal-body .subjap-modal-btn-ai:hover:not(:disabled) { background: #252932; }
      .subjap-modal-body .subjap-ai-status { font-size: 13px; color: var(--sj-muted); }
      .subjap-modal-body .subjap-ai-notes {
        display: block; box-sizing: border-box; width: 100%; min-height: 190px;
        margin: 4px 0 12px; padding: 8px 10px; resize: vertical;
        background: var(--sj-input); color: var(--sj-text); border: 1px solid var(--sj-hairline);
        border-radius: 6px; font: inherit; line-height: 1.45;
      }
      .subjap-modal-body .subjap-audio-info, .subjap-modal-body .subjap-screenshot-info {
        font-size: 13px; color: var(--sj-success); margin-top: 6px;
      }
      .subjap-modal-body .subjap-error { font-size: 13px; color: var(--sj-danger); margin-top: 6px; }
      .subjap-modal-body .subjap-local-info { font-size: 13px; color: var(--sj-warning); margin-top: 8px; }
      .subjap-modal-footer {
        display: flex; flex-shrink: 0; gap: 8px; flex-wrap: wrap;
        border-top: 1px solid var(--sj-hairline); padding-top: 12px;
      }
      .subjap-modal-btn {
        flex: 1; padding: 10px 14px; border: 1px solid var(--sj-hairline); border-radius: 6px;
        font-size: 13px; font-weight: 600; cursor: pointer; transition: background 160ms cubic-bezier(0.22,1,0.36,1), transform 160ms cubic-bezier(0.22,1,0.36,1);
        min-width: 100px;
      }
      .subjap-modal-btn:disabled { opacity: 0.6; cursor: default; }
      .subjap-modal-btn-phrase-audio { background: var(--sj-raised); color: var(--sj-text); }
      .subjap-modal-btn-phrase-audio:hover:not(:disabled) { background: #252932; }
      .subjap-modal-btn-send { background: var(--sj-accent); border-color: var(--sj-accent); color: var(--sj-canvas); }
      .subjap-modal-btn-send:hover:not(:disabled) { background: var(--sj-accent-hover); }
      .subjap-modal-btn:focus-visible,
      .subjap-modal-close:focus-visible { outline: 2px solid var(--sj-accent); outline-offset: 2px; }
      .subjap-modal-btn:active:not(:disabled) { transform: translateY(1px); }
      @media (prefers-reduced-motion: reduce) {
        .subjap-modal-btn { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    if (!this.state) return;
    const body = this.container.querySelector(".subjap-modal-body");
    if (!body) return;

    const aiButtonLabel = this.state.aiGenerating
      ? "Analyse en cours…"
      : this.state.aiGeneratedOnce
        ? "↻ Régénérer avec l’IA"
        : "✨ Enrichir avec l’IA";
    const aiNotesHtml = this.state.aiNotesText
      ? `<div class="subjap-label">Enrichissement IA — modifiable</div>
        <textarea class="subjap-ai-notes" data-testid="mining-ai-notes" aria-label="Enrichissement IA">${escapeHtml(this.state.aiNotesText)}</textarea>`
      : "";
    const aiStatusHtml = this.state.aiStatus
      ? `<span class="subjap-ai-status">${escapeHtml(this.state.aiStatus)}</span>`
      : "";
    const aiErrorHtml = this.state.aiError
      ? `<div class="subjap-error">IA distante : ${escapeHtml(this.state.aiError)}</div>`
      : "";
    const defListHtml = `<div class="subjap-label">Definitions</div>
      <textarea class="subjap-definitions" data-testid="mining-definitions" aria-label="Definitions">${escapeHtml(this.state.definitionText)}</textarea>
      <div class="subjap-label">Notes</div>
      <textarea class="subjap-notes" data-testid="mining-notes" aria-label="Notes" placeholder="Ajouter une note personnelle pour Anki…">${escapeHtml(this.state.notesText)}</textarea>
      <div class="subjap-ai-controls">
        <button class="subjap-modal-btn subjap-modal-btn-ai" data-testid="mining-ai-enrich" ${this.state.aiGenerating || this.state.sending ? "disabled" : ""}>${aiButtonLabel}</button>
        ${aiStatusHtml}
      </div>
      ${aiErrorHtml}
      ${aiNotesHtml}`;

    const phraseAudioInfo = this.state.phraseAudioDataUrl
      ? '<div class="subjap-audio-info">✓ Audio de la phrase prêt</div>'
      : "";
    const screenshotInfo = this.state.screenshotDataUrl
      ? '<div class="subjap-screenshot-info">✓ Image capturée</div>'
      : "";
    const localInfo = this.state.localCardId
      ? '<div class="subjap-local-info">✓ Carte sauvegardée localement</div>'
      : "";
    const ankiError = this.state.ankiError
      ? `<div class="subjap-error">Erreur d’envoi : ${escapeHtml(this.state.ankiError)}</div>`
      : "";

    body.innerHTML = `
      <div class="subjap-label">Sentence — ${escapeHtml(this.state.episodeContext.title)}</div>
      <textarea class="subjap-textarea subjap-sentence-input" data-testid="mining-sentence" aria-label="Sentence">${escapeHtml(this.state.sentenceText)}</textarea>
      <div class="subjap-label">Target Word</div>
      <input class="subjap-input" data-testid="mining-target-word" aria-label="Target Word" value="${escapeHtml(this.state.targetWordText)}" />
      <div class="subjap-label">Reading</div>
      <input class="subjap-input" data-testid="mining-reading" aria-label="Reading" value="${escapeHtml(this.state.readingText)}" />
      <div class="subjap-label">Translation</div>
      <textarea class="subjap-textarea subjap-translation" data-testid="mining-translation" aria-label="Translation">${escapeHtml(this.state.translationText)}</textarea>
      ${defListHtml}
      ${phraseAudioInfo}
      ${screenshotInfo}
      ${localInfo}
      ${ankiError}
    `;

    const phraseAudioButton = this.container.querySelector<HTMLButtonElement>(
      ".subjap-modal-btn-phrase-audio",
    );
    if (phraseAudioButton) {
      phraseAudioButton.disabled = !this.state.phraseAudioDataUrl;
    }

    const sentenceInput = body.querySelector<HTMLTextAreaElement>(".subjap-sentence-input");
    sentenceInput?.addEventListener("input", () => {
      if (this.state) this.state.sentenceText = sentenceInput.value;
    });

    const targetWordInput = body.querySelector<HTMLInputElement>("[data-testid=\"mining-target-word\"]");
    targetWordInput?.addEventListener("input", () => {
      if (this.state) this.state.targetWordText = targetWordInput.value;
    });

    const readingInput = body.querySelector<HTMLInputElement>("[data-testid=\"mining-reading\"]");
    readingInput?.addEventListener("input", () => {
      if (this.state) {
        this.state.readingText = readingInput.value;
      }
    });

    const translationInput = body.querySelector<HTMLTextAreaElement>(".subjap-translation");
    translationInput?.addEventListener("input", () => {
      if (this.state) this.state.translationText = translationInput.value;
    });

    const definitionsInput = body.querySelector<HTMLTextAreaElement>(".subjap-definitions");
    definitionsInput?.addEventListener("input", () => {
      if (this.state) this.state.definitionText = definitionsInput.value;
    });

    const notesInput = body.querySelector<HTMLTextAreaElement>(".subjap-notes");
    notesInput?.addEventListener("input", () => {
      if (this.state) this.state.notesText = notesInput.value;
    });

    const aiNotesInput = body.querySelector<HTMLTextAreaElement>(".subjap-ai-notes");
    aiNotesInput?.addEventListener("input", () => {
      if (this.state) this.state.aiNotesText = aiNotesInput.value;
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private async generateAiNotes(): Promise<void> {
    const state = this.state;
    if (!state || state.aiGenerating) return;

    state.aiGenerating = true;
    state.aiStatus = "Préparation de tes exemples familiers…";
    state.aiError = null;
    this.render();

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
        this.render();
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
        definitions: definitionLines(state.definitionText),
        kanjiCandidates: kanji,
      };
      const raw = await session.generate(input, state.aiGeneratedOnce);
      const formatted = await formatValidatedAiEnrichment(raw, input);
      if (this.state !== state) return;

      state.aiGeneratedOnce = true;
      state.aiNotesText = formatted;
      state.aiStatus = formatted
        ? "Enrichissement ajouté aux Notes."
        : "Aucun enrichissement suffisamment fiable trouvé.";
    } catch (err) {
      if (this.state !== state) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        state.aiError = "La génération a dépassé 15 secondes. Tu peux réessayer.";
      } else {
        state.aiError = err instanceof Error ? err.message : String(err);
      }
      state.aiStatus = null;
    } finally {
      aiSessionRef.current?.destroy();
      if (this.state === state) {
        state.aiGenerating = false;
        this.render();
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
      if (wasVisible && this.state === state && this.isOpen) {
        mountVideoSurface(this.container);
        this.show();
      }
      if (this.state === state && this.isOpen) this.render();
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
      if (dataUrl) this.render();
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
    const { cue, targetToken, episodeContext } = state;

    const sentence = state.sentenceText.trim() || state.targetWordText.trim() || targetToken.token.surface;
    const targetWord = state.targetWordText.trim() || tokenDictionaryForm(targetToken.token);
    const targetReading = state.readingText.trim();
    const defaultSentence = normalizeCueText(cue.cue.text) || targetToken.token.surface;
    const defaultTargetWord = tokenDictionaryForm(targetToken.token);
    const phrase =
      state.sentenceText === defaultSentence && state.targetWordText === defaultTargetWord
        ? formatMigakuSentence(cue, targetToken)
        : formatEditableSentence(sentence, targetWord);
    const editedDefinitions = definitionLines(state.definitionText);
    const notes = combinedNotes(state);
    let phraseAudioDataUrl: string | undefined = this.state.phraseAudioDataUrl ?? undefined;
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

    state.sending = true;
    state.ankiError = null;
    const sendBtn = this.container.querySelector<HTMLButtonElement>(".subjap-modal-btn-send");
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = "Envoi…";
    }

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
            Traduction: state.translationText,
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
          this.render();
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = "↻ Réessayer Anki";
          }
        }
        return;
      }

      this.close();
    } catch (err) {
      console.error("[SubJap] Failed to create card:", err);
      state.sending = false;
      state.ankiError = err instanceof Error ? err.message : String(err);
      this.render();
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = "Créer dans Anki";
      }
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
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The mining form is intentionally modal: only the close button may
        // dismiss it manually, so Escape must not discard an in-progress edit.
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  private unregisterKeyboard(): void {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }
}
