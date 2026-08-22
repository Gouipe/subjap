// ---------------------------------------------------------------------------
// SubJap — Mining modal (DOM vanilla)
// ---------------------------------------------------------------------------
//
// Opened from the content script when the user mines a word from the popover.
// Shows the sentence with the target highlighted, the reading and selectable
// definitions; a video-frame screenshot is captured automatically (and can be
// retaken), then the card is pushed to the local IndexedDB store and
// (best-effort) to Anki.

import type { RenderedCue, SpanToken, EpisodeContext } from "@/core/types";
import { sendMessage } from "@/core/messaging";
import { normalizeCueText } from "@/subtitles";
import { captureFrame } from "./capture";
import { formatMigakuDefinitions, formatMigakuSentence, formatMigakuWord } from "./migaku";
import type { VideoAudioCapture } from "./audio-capture";

const MODAL_ID = "subjap-mining-modal";

interface MiningState {
  cue: RenderedCue;
  targetToken: SpanToken;
  lemmaReading: string;
  episodeContext: EpisodeContext;
  definitions: string[];
  selectedDefinitions: Set<number>;
  wordAudioDataUrl: string | null;
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
    document.body.appendChild(this.container);
    this.injectStyles();
    // Single delegated listener — avoids duplicate handlers across re-renders.
    this.container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("subjap-modal-btn-audio")) {
        void this.generateAudio(true);
      } else if (target.classList.contains("subjap-modal-btn-screenshot")) {
        void this.captureScreenshot();
      } else if (target.classList.contains("subjap-modal-btn-send")) {
        void this.sendToAnki();
      } else if (target.classList.contains("subjap-modal-close")) {
        this.close();
      } else if (target.classList.contains("subjap-modal-backdrop")) {
        this.close();
      }
    });
  }

  /** Open the mining modal with the given cue, target word, and episode context. */
  open(state: {
    cue: RenderedCue;
    targetToken: SpanToken;
    lemmaReading: string;
    episodeContext: EpisodeContext;
    definitions: string[];
  }): void {
    this.state = {
      cue: state.cue,
      targetToken: state.targetToken,
      lemmaReading: state.lemmaReading,
      episodeContext: state.episodeContext,
      definitions: state.definitions,
      selectedDefinitions: new Set(state.definitions.map((_, i) => i)),
      wordAudioDataUrl: null,
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
    void this.generateAudio();
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
          <span class="subjap-modal-title">Mine Card</span>
          <button class="subjap-modal-close" title="Close (Escape)">✕</button>
        </div>
        <div class="subjap-modal-body"></div>
        <div class="subjap-modal-footer">
          <button class="subjap-modal-btn subjap-modal-btn-audio">🔊 Word audio</button>
          <button class="subjap-modal-btn subjap-modal-btn-screenshot">📷 Screenshot</button>
          <button class="subjap-modal-btn subjap-modal-btn-send">📤 Send to Anki</button>
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
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
      }
      .subjap-modal-backdrop {
        position: absolute; inset: 0; background: rgba(0,0,0,0.7);
      }
      .subjap-modal-panel {
        position: relative; background: #1e1e2e; color: #e0e0e0;
        border-radius: 12px; padding: 20px 24px; max-width: 520px; width: 90%;
        max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      }
      .subjap-modal-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 16px; border-bottom: 1px solid #333; padding-bottom: 8px;
      }
      .subjap-modal-title { font-size: 18px; font-weight: 700; }
      .subjap-modal-close {
        background: none; border: none; color: #999; font-size: 20px;
        cursor: pointer; padding: 4px 8px; border-radius: 4px;
      }
      .subjap-modal-close:hover { background: #333; color: #fff; }
      .subjap-modal-body { margin-bottom: 16px; line-height: 1.6; font-size: 15px; }
      .subjap-modal-body .subjap-sentence {
        font-size: 24px; margin-bottom: 12px; padding: 10px; background: #2a2a3c; border-radius: 8px;
      }
      .subjap-modal-body .subjap-sentence .subjap-target { color: #facc15; font-weight: 700; }
      .subjap-modal-body .subjap-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
      .subjap-modal-body .subjap-reading { color: #a78bfa; margin-bottom: 8px; }
      .subjap-modal-body .subjap-def-list { list-style: none; padding: 0; margin: 4px 0 12px; }
      .subjap-modal-body .subjap-def-list li { padding: 4px 0; display: flex; align-items: center; gap: 8px; }
      .subjap-modal-body .subjap-def-list li input { accent-color: #a78bfa; }
      .subjap-modal-body .subjap-audio-info, .subjap-modal-body .subjap-screenshot-info {
        font-size: 13px; color: #22c55e; margin-top: 6px;
      }
      .subjap-modal-body .subjap-error { font-size: 13px; color: #f38ba8; margin-top: 6px; }
      .subjap-modal-body .subjap-local-info { font-size: 13px; color: #facc15; margin-top: 8px; }
      .subjap-modal-footer {
        display: flex; gap: 8px; flex-wrap: wrap;
        border-top: 1px solid #333; padding-top: 12px;
      }
      .subjap-modal-btn {
        flex: 1; padding: 10px 16px; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s;
        min-width: 100px;
      }
      .subjap-modal-btn:disabled { opacity: 0.6; cursor: default; }
      .subjap-modal-btn-audio { background: #3b82f6; color: #fff; }
      .subjap-modal-btn-audio:hover:not(:disabled) { background: #2563eb; }
      .subjap-modal-btn-screenshot { background: #8b5cf6; color: #fff; }
      .subjap-modal-btn-screenshot:hover:not(:disabled) { background: #7c3aed; }
      .subjap-modal-btn-send { background: #22c55e; color: #fff; }
      .subjap-modal-btn-send:hover:not(:disabled) { background: #16a34a; }
    `;
    document.head.appendChild(style);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    if (!this.state) return;
    const { cue, targetToken, definitions, selectedDefinitions } = this.state;
    const body = this.container.querySelector(".subjap-modal-body");
    if (!body) return;

    const sentenceHtml = cue.spans
      .map((st) => {
        const isTarget = st.token.lemma === targetToken.token.lemma;
        const cls = isTarget ? "subjap-target" : "";
        return `<span class="${cls}">${escapeHtml(st.token.surface)}</span>`;
      })
      .join("");

    const defListHtml =
      definitions.length > 0
        ? `<div class="subjap-label">Definitions</div>
           <ul class="subjap-def-list">
             ${definitions
               .map(
                 (d, i) => `<li>
                   <input type="checkbox" id="subjap-def-${i}" ${selectedDefinitions.has(i) ? "checked" : ""}>
                   <label for="subjap-def-${i}">${escapeHtml(d)}</label>
                 </li>`,
               )
               .join("")}
           </ul>`
        : "";

    const readingHtml = this.state.lemmaReading
      ? `<div class="subjap-label">Reading</div>
         <div class="subjap-reading">${escapeHtml(this.state.lemmaReading)}</div>`
      : "";

    const audioInfo = this.state.wordAudioDataUrl
      ? '<div class="subjap-audio-info">✓ Word audio ready</div>'
      : "";
    const phraseAudioInfo = this.state.phraseAudioDataUrl
      ? '<div class="subjap-audio-info">✓ Netflix phrase audio ready</div>'
      : "";
    const screenshotInfo = this.state.screenshotDataUrl
      ? '<div class="subjap-screenshot-info">✓ Screenshot captured</div>'
      : "";
    const localInfo = this.state.localCardId
      ? '<div class="subjap-local-info">✓ Carte sauvegardée localement</div>'
      : "";
    const ankiError = this.state.ankiError
      ? `<div class="subjap-error">Erreur d’envoi : ${escapeHtml(this.state.ankiError)}</div>`
      : "";

    body.innerHTML = `
      <div class="subjap-label">Sentence — ${escapeHtml(this.state.episodeContext.title)}</div>
      <div class="subjap-sentence">${sentenceHtml}</div>
      <div class="subjap-label">Target Word — ${escapeHtml(targetToken.token.lemma)}</div>
      ${readingHtml}
      ${defListHtml}
      ${audioInfo}
      ${phraseAudioInfo}
      ${screenshotInfo}
      ${localInfo}
      ${ankiError}
    `;

    // Wire definition checkboxes (delegated container listener does the rest).
    body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        const idx = Number(input.id.replace("subjap-def-", ""));
        if (Number.isInteger(idx) && this.state) {
          if (input.checked) {
            this.state.selectedDefinitions.add(idx);
          } else {
            this.state.selectedDefinitions.delete(idx);
          }
        }
      });
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private async generateAudio(playPreview = false): Promise<void> {
    const state = this.state;
    if (!state) return;
    try {
      const result = await sendMessage("tts:generate", {
        text: state.lemmaReading || state.targetToken.token.lemma,
      });
      // Ignore a late response if the modal was closed and reopened for a
      // different card while VOICEVOX was synthesizing.
      if (this.state !== state) return;
      state.wordAudioDataUrl = result.dataUrl;
      if (playPreview) {
        const preview = new Audio(result.dataUrl);
        try {
          void Promise.resolve(preview.play()).catch(() => undefined);
        } catch {
          // Preview playback can be blocked by autoplay policy; the data URL
          // remains available for Anki regardless.
        }
      }
      this.render();
    } catch (err) {
      console.error("[SubJap] VOICEVOX word audio failed:", err);
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
      await this.waitForCapturePaint();
    }
    try {
      const tabVideo = await this.audioCapture?.getTabVideo();
      const screenshotDataUrl = await captureFrame(this.video, undefined, tabVideo);
      // Ignore a late capture if the modal was closed and reopened for a
      // different card while the video frame was being read.
      if (this.state !== state) return;
      state.screenshotDataUrl = screenshotDataUrl;
    } catch (err) {
      console.error("[SubJap] Screenshot capture failed:", err);
    } finally {
      if (wasVisible && this.state === state && this.isOpen) {
        document.body.appendChild(this.container);
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
    const dataUrl = await this.audioCapture?.captureCue(state.cue.cue);
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
    const { cue, targetToken, episodeContext, definitions, selectedDefinitions } = state;

    const sentence = normalizeCueText(cue.cue.text) || targetToken.token.surface;
    const selectedDefs = definitions.filter((_, i) => selectedDefinitions.has(i));
    let phraseAudioDataUrl: string | undefined = this.state.phraseAudioDataUrl ?? undefined;
    if (!phraseAudioDataUrl && this.phraseAudioPromise) {
      phraseAudioDataUrl = await this.phraseAudioPromise;
    }
    if (!phraseAudioDataUrl && this.audioCapture && !state.phraseAudioAttempted) {
      phraseAudioDataUrl = await this.capturePhraseAudio(state);
    }
    if (
      !phraseAudioDataUrl &&
      cue.cue.endConfirmed !== false &&
      cue.cue.end > cue.cue.start
    ) {
      phraseAudioDataUrl = this.audioCapture?.captureSegment(
        cue.cue.start,
        cue.cue.end,
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
          targetWord: targetToken.token.lemma,
          targetSurface: targetToken.token.surface,
          targetReading: state.lemmaReading,
          definitions: selectedDefs,
          audioDataUrl: phraseAudioDataUrl,
          screenshotDataUrl: state.screenshotDataUrl ?? undefined,
          source: episodeContext,
          cueStart: cue.cue.start,
          cueEnd: cue.cue.end,
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
      }

      try {
        let wordAudioDataUrl: string | undefined = state.wordAudioDataUrl ?? undefined;
        if (!wordAudioDataUrl) {
          try {
            wordAudioDataUrl = (
              await sendMessage("tts:generate", {
                text: state.lemmaReading || targetToken.token.lemma,
              })
            ).dataUrl;
          } catch (err) {
            console.warn("[SubJap] VOICEVOX word audio unavailable:", err);
          }
        }

        const { deckName } = await sendMessage("anki:setup", {});
        await sendMessage("anki:addNote", {
          deckName,
          fields: {
            Mot: formatMigakuWord(targetToken.token.lemma, state.lemmaReading),
            Lecture: state.lemmaReading,
            Phrase: formatMigakuSentence(cue, targetToken),
            Traduction: "",
            Définitions: formatMigakuDefinitions(selectedDefs),
            Notes: "",
            Image: "",
            AudioMot: "",
            AudioPhrase: "",
          },
          audioMotDataUrl: wordAudioDataUrl,
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
        sendBtn.textContent = "📤 Send to Anki";
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
        this.close();
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        void this.sendToAnki();
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
