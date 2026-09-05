import type { OverlayRenderer } from "@/overlay";
import type { PlatformAdapter, RenderedCue } from "@/core/types";
import { subtitleCueKey } from "@/subtitles/timeline";

const PANEL_ID = "subjap-listening-mode";
const STYLE_ID = "subjap-listening-mode-styles";

type Phase = "ready" | "playing" | "review";

/**
 * Small controller for the audio-first exercise. Subtitle revelation never
 * resumes playback; only the explicit Continue button does that.
 */
export class ListeningMode {
  private readonly container: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly adapter: PlatformAdapter;
  private readonly overlay: OverlayRenderer;
  private activeCue: RenderedCue | null = null;
  private phase: Phase = "ready";
  private japaneseRevealed = false;
  private secondaryRevealed = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId = 0;
  private awaitingReplayStart = false;

  constructor(
    video: HTMLVideoElement,
    adapter: PlatformAdapter,
    overlay: OverlayRenderer,
    private readonly onClosed: () => void,
  ) {
    this.video = video;
    this.adapter = adapter;
    this.overlay = overlay;
    this.container = this.buildContainer();
    this.injectStyles();
    document.addEventListener("keydown", this.handleKeydown, true);
    this.container.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!button || button.disabled) return;
      switch (button.dataset.action) {
        case "listen":
          void this.listen();
          break;
        case "replay":
          void this.replay();
          break;
        case "reveal-japanese":
          this.revealSubtitles("japanese");
          break;
        case "reveal-secondary":
          this.revealSubtitles("secondary");
          break;
        case "continue":
          void this.continuePlayback();
          break;
        case "skip":
          void this.skip();
          break;
      }
    });
  }

  get isActive(): boolean {
    return this.activeCue !== null;
  }

  open(cue: RenderedCue, resume = true): void {
    if (cue.cue.endConfirmed !== false && cue.cue.end <= cue.cue.start) return;
    this.stopTimer();
    this.sessionId += 1;
    this.activeCue = cue;
    this.awaitingReplayStart = false;
    this.phase = resume ? "playing" : "ready";
    this.japaneseRevealed = false;
    this.secondaryRevealed = false;
    this.overlay.setSubtitleVisibility(false, false);
    this.render();
    if (!this.container.isConnected) document.body.appendChild(this.container);

    // Q/S preserves pause: the learner starts explicitly with A in that case.
    if (this.phase === "ready") return;

    // During playback, take control at the end of the requested occurrence.
    const sessionId = this.sessionId;
    if (cue.cue.endConfirmed !== false && this.video.currentTime >= cue.cue.end - 0.05) {
      this.finishPlayback(sessionId);
      return;
    }
    this.startPlaybackMonitoring(sessionId);
  }

  destroy(): void {
    this.close();
    document.removeEventListener("keydown", this.handleKeydown, true);
    this.container.remove();
  }

  /** Navigation takes ownership without seeking to the old exercise's end. */
  cancel(): void {
    if (!this.activeCue) return;
    this.close();
    this.onClosed();
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (!this.activeCue || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.isContentEditable
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "a" && this.phase === "ready") {
      event.preventDefault();
      event.stopPropagation();
      void this.listen();
    } else if (key === "a" && this.phase === "review") {
      event.preventDefault();
      event.stopPropagation();
      void this.replay();
    } else if (key === "z" && this.phase === "review") {
      event.preventDefault();
      event.stopPropagation();
      this.revealSubtitles("japanese");
    } else if (key === "e" && this.phase === "review") {
      event.preventDefault();
      event.stopPropagation();
      this.revealSubtitles("secondary");
    } else if (key === "r" && this.phase === "review") {
      event.preventDefault();
      event.stopPropagation();
      void this.continuePlayback();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void this.skip();
    }
  };

  private async listen(): Promise<void> {
    if (!this.activeCue || this.phase !== "ready") return;
    const sessionId = this.sessionId;
    const cue = this.activeCue.cue;
    this.stopTimer();
    this.awaitingReplayStart = true;
    this.japaneseRevealed = false;
    this.secondaryRevealed = false;
    this.overlay.setSubtitleVisibility(false, false);
    this.phase = "playing";
    this.render();
    this.video.pause();
    const accepted = await this.adapter.seekTo(cue.start, true);
    if (sessionId !== this.sessionId || !this.activeCue) return;
    if (!accepted) {
      this.phase = "review";
      this.render();
      return;
    }

    this.startPlaybackMonitoring(sessionId);
  }

  private startPlaybackMonitoring(sessionId: number): void {
    if (!this.activeCue || sessionId !== this.sessionId) return;
    this.stopTimer();
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
    this.video.addEventListener("seeked", this.handleTimeUpdate);
    // Buffering and seeking consume wall time without playing the phrase.
    // A timer only samples the media clock; it can never end an exercise alone.
    const poll = (): void => {
      if (sessionId !== this.sessionId || !this.activeCue || this.phase !== "playing") return;
      this.handleTimeUpdate();
      if (this.phase === "playing") this.endTimer = setTimeout(poll, 100);
    };
    poll();
  }

  private async replay(): Promise<void> {
    if (!this.activeCue || this.phase !== "review") return;
    this.phase = "ready";
    await this.listen();
  }

  private handleTimeUpdate = (): void => {
    if (!this.activeCue || this.phase !== "playing") return;
    if (this.video.seeking) return;
    if (this.awaitingReplayStart) {
      if (Math.abs(this.video.currentTime - this.activeCue.cue.start) >= 0.5) return;
      this.awaitingReplayStart = false;
    }
    if (this.activeCue.cue.endConfirmed === false) {
      // S can target a DOM cue before its first disappearance. The adapter
      // keeps observing while the overlay is frozen; use only the confirmed
      // end of that exact observation, without inventing an audio duration.
      const key = subtitleCueKey(this.activeCue.cue);
      const resolved = this.adapter.getNavigationCues?.().find((cue) =>
        subtitleCueKey(cue) === key && cue.endConfirmed !== false && cue.end > cue.start);
      if (!resolved) return;
      this.activeCue = { ...this.activeCue, cue: resolved };
    }
    if (this.video.currentTime >= this.activeCue.cue.end - 0.05) {
      this.finishPlayback(this.sessionId);
    }
  };

  private finishPlayback(sessionId: number): void {
    if (sessionId !== this.sessionId || !this.activeCue) return;
    this.stopTimer();
    this.video.pause();
    this.phase = "review";
    this.render();
  }

  private revealSubtitles(language: "japanese" | "secondary"): void {
    if (this.phase !== "review") return;
    if (language === "japanese") this.japaneseRevealed = true;
    else this.secondaryRevealed = true;
    // Each explicit reveal preserves the other layer's current state.
    this.overlay.setSubtitleVisibility(this.japaneseRevealed, this.secondaryRevealed);
    this.render();
  }

  private async continuePlayback(): Promise<void> {
    if (!this.activeCue || this.phase !== "review") return;
    const cueEnd = this.activeCue.cue.end;
    this.close();
    await this.adapter.seekTo(cueEnd, true);
    this.onClosed();
  }

  private async skip(): Promise<void> {
    if (!this.activeCue) return;
    const cue = this.activeCue.cue;
    this.close();
    if (cue.endConfirmed === false) {
      await this.video.play();
    } else {
      await this.adapter.seekTo(cue.end, true);
    }
    this.onClosed();
  }

  private close(): void {
    this.sessionId += 1;
    this.stopTimer();
    this.activeCue = null;
    this.container.remove();
    this.overlay.clearSubtitleVisibilityOverride();
  }

  private stopTimer(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.video.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.video.removeEventListener("seeked", this.handleTimeUpdate);
  }

  private buildContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = PANEL_ID;
    container.innerHTML = `
      <div class="subjap-listening-title">Écoute seule</div>
      <div class="subjap-listening-hint"></div>
      <div class="subjap-listening-actions">
        <button data-action="listen">A · ▶ Écouter</button>
        <button data-action="replay" hidden>A · ↻ Réessayer</button>
        <button data-action="reveal-japanese" hidden>Z · Afficher le japonais</button>
        <button data-action="reveal-secondary" hidden>E · Afficher la traduction</button>
        <button data-action="continue" hidden>R · Continuer</button>
        <button data-action="skip" class="subjap-listening-secondary">Échap · Passer</button>
      </div>`;
    return container;
  }

  private render(): void {
    const listen = this.button("listen");
    const replay = this.button("replay");
    const japanese = this.button("reveal-japanese");
    const secondary = this.button("reveal-secondary");
    const continueButton = this.button("continue");
    const hint = this.container.querySelector<HTMLDivElement>(".subjap-listening-hint");

    listen.hidden = this.phase !== "ready";
    replay.hidden = this.phase !== "review";
    japanese.hidden = this.phase !== "review";
    secondary.hidden = this.phase !== "review";
    japanese.textContent = this.japaneseRevealed
      ? "Z · Japonais affiché"
      : "Z · Afficher le japonais";
    secondary.textContent = this.secondaryRevealed
      ? "E · Traduction affichée"
      : "E · Afficher la traduction";
    continueButton.hidden = this.phase !== "review";
    this.button("skip").hidden = this.phase === "review";
    if (hint) {
      hint.textContent =
        this.phase === "ready"
          ? "Écoute la phrase sans regarder les sous-titres."
          : this.phase === "playing"
            ? "Lecture en cours…"
            : "Révèle les aides dans l’ordre qui t’aide le plus, puis continue. ";
    }
  }

  private button(action: string): HTMLButtonElement {
    const button = this.container.querySelector<HTMLButtonElement>(
      `button[data-action="${action}"]`,
    );
    if (!button) throw new Error(`Listening mode button not found: ${action}`);
    return button;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        left: 50%;
        top: 8%;
        z-index: 2147483647;
        transform: translateX(-50%);
        width: min(680px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 14px 16px;
        border-radius: 12px;
        background: rgba(20,22,27,.97);
        color: #f4f1ea;
        box-shadow: 0 8px 8px rgba(0,0,0,.42);
        font: 14px/1.45 "IBM Plex Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
      }
      #${PANEL_ID} .subjap-listening-title { font-weight: 600; color: #f4f1ea; }
      #${PANEL_ID} .subjap-listening-hint { margin-top: 3px; color: #b2b6bf; }
      #${PANEL_ID} .subjap-listening-actions {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
      }
      #${PANEL_ID} button {
        padding: 8px 11px; border: 0; border-radius: 6px; cursor: pointer;
        background: #ff624d; color: #0c0d10; font: inherit; font-weight: 600;
        transition: background 160ms cubic-bezier(0.22,1,0.36,1), transform 160ms cubic-bezier(0.22,1,0.36,1);
      }
      #${PANEL_ID} button:hover { background: #ff7966; }
      #${PANEL_ID} button:focus-visible { outline: 2px solid #ff7966; outline-offset: 2px; }
      #${PANEL_ID} button:active { transform: translateY(1px); }
      #${PANEL_ID} .subjap-listening-secondary { background: #1b1e24; color: #f4f1ea; border: 1px solid #343842; }
      #${PANEL_ID} .subjap-listening-secondary:hover { background: #252932; }
      @media (prefers-reduced-motion: reduce) {
        #${PANEL_ID} button { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }
}
