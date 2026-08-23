import type { OverlayRenderer } from "@/overlay";
import type { PlatformAdapter, RenderedCue } from "@/core/types";

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
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId = 0;

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
        case "reveal-subtitles":
          this.revealNextSubtitles();
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

  open(cue: RenderedCue): void {
    if (cue.cue.end <= cue.cue.start) return;
    this.stopTimer();
    this.sessionId += 1;
    this.activeCue = cue;
    this.phase = "playing";
    this.japaneseRevealed = false;
    this.overlay.setSubtitleVisibility(false, false);
    this.render();
    if (!this.container.isConnected) document.body.appendChild(this.container);

    // Let the first occurrence play naturally. The exercise takes control only
    // when the cue reaches its end, where the learner can replay or reveal it.
    const sessionId = this.sessionId;
    if (this.video.currentTime >= cue.cue.end - 0.05) {
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
      this.revealNextSubtitles();
    } else if (key === "e" && this.phase === "review") {
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

    const durationMs = Math.max(
      500,
      ((cue.end - cue.start) / Math.max(0.25, this.adapter.getPlaybackRate())) * 1000 + 750,
    );
    this.endTimer = setTimeout(() => this.finishPlayback(sessionId), durationMs);
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
  }

  private startPlaybackMonitoring(sessionId: number): void {
    if (!this.activeCue || sessionId !== this.sessionId) return;
    const remainingSeconds = Math.max(
      0.1,
      this.activeCue.cue.end - this.video.currentTime,
    );
    const durationMs = Math.max(
      500,
      (remainingSeconds / Math.max(0.25, this.adapter.getPlaybackRate())) * 1000 + 750,
    );
    this.endTimer = setTimeout(() => this.finishPlayback(sessionId), durationMs);
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
  }

  private async replay(): Promise<void> {
    if (!this.activeCue || this.phase !== "review") return;
    const sessionId = this.sessionId;
    const cue = this.activeCue.cue;
    this.phase = "playing";
    this.render();
    const accepted = await this.adapter.seekTo(cue.start, true);
    if (sessionId !== this.sessionId || !this.activeCue) return;
    if (!accepted) {
      this.phase = "review";
      this.render();
      return;
    }
    const durationMs = Math.max(
      500,
      ((cue.end - cue.start) / Math.max(0.25, this.adapter.getPlaybackRate())) * 1000 + 750,
    );
    this.endTimer = setTimeout(() => this.finishPlayback(sessionId), durationMs);
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
  }

  private handleTimeUpdate = (): void => {
    if (!this.activeCue || this.phase !== "playing") return;
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

  private revealNextSubtitles(): void {
    if (this.phase !== "review") return;
    this.japaneseRevealed = true;
    // Reveal Japanese only. The French layer remains governed by the normal
    // secondary-subtitle rule, including hover-to-reveal when enabled.
    this.overlay.setSubtitleVisibility(true, null);
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
    const cueEnd = this.activeCue.cue.end;
    this.close();
    await this.adapter.seekTo(cueEnd, true);
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
        <button data-action="reveal-subtitles" hidden>Z · Afficher les sous-titres</button>
        <button data-action="continue" hidden>E · Continuer</button>
        <button data-action="skip" class="subjap-listening-secondary">Échap · Passer</button>
      </div>`;
    return container;
  }

  private render(): void {
    const listen = this.button("listen");
    const replay = this.button("replay");
    const subtitles = this.button("reveal-subtitles");
    const continueButton = this.button("continue");
    const hint = this.container.querySelector<HTMLDivElement>(".subjap-listening-hint");

    listen.hidden = this.phase !== "ready";
    replay.hidden = this.phase !== "review";
    subtitles.hidden = this.phase !== "review";
    subtitles.textContent = this.japaneseRevealed
      ? "Z · Sous-titres affichés"
      : "Z · Afficher les sous-titres";
    continueButton.hidden = this.phase !== "review";
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
        border: 1px solid rgba(203,166,247,.55);
        border-radius: 12px;
        background: rgba(24,24,37,.96);
        color: #cdd6f4;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        font: 14px/1.4 system-ui, -apple-system, sans-serif;
      }
      #${PANEL_ID} .subjap-listening-title { font-weight: 700; color: #cba6f7; }
      #${PANEL_ID} .subjap-listening-hint { margin-top: 3px; color: #a6adc8; }
      #${PANEL_ID} .subjap-listening-actions {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
      }
      #${PANEL_ID} button {
        padding: 8px 11px; border: 0; border-radius: 7px; cursor: pointer;
        background: #7c3aed; color: #fff; font: inherit; font-weight: 600;
      }
      #${PANEL_ID} button:hover { background: #8b5cf6; }
      #${PANEL_ID} .subjap-listening-secondary { background: #475569; }
      #${PANEL_ID} .subjap-listening-secondary:hover { background: #64748b; }
    `;
    document.head.appendChild(style);
  }
}
