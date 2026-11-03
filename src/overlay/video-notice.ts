// ---------------------------------------------------------------------------
// SubJap — Short notice over the bottom of the player
// ---------------------------------------------------------------------------

import { forgetVideoSurface, mountVideoSurface } from "./mount";

export interface VideoNoticeAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface VideoNoticeContent {
  text: string;
  actions: VideoNoticeAction[];
  /** Hides itself after this delay, unless the pointer rests on it; null stays. */
  autoHideMs: number | null;
}

export interface VideoNoticeOptions extends VideoNoticeContent {
  /** Called once the notice is gone, whatever the reason. */
  onClose?: () => void;
  /** Short text: keep it on one line with its actions instead of wrapping. */
  singleLine?: boolean;
}

const NOTICE_ID = "subjap-video-notice";
const FONT = "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif";

/** Above the platform's bottom control bar, like the subtitle overlay. */
function bottomInset(height: number): number {
  return Math.max(72, height * 0.13);
}

export class VideoNotice {
  private readonly element: HTMLDivElement;
  private readonly message: HTMLSpanElement;
  private readonly actions: HTMLSpanElement;
  private readonly closeButton: HTMLButtonElement;
  private autoHideMs: number | null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: VideoNoticeOptions,
  ) {
    this.autoHideMs = options.autoHideMs;
    document.getElementById(NOTICE_ID)?.remove();
    this.element = document.createElement("div");
    this.element.id = NOTICE_ID;
    this.element.setAttribute("role", "status");
    this.element.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "display:flex",
      options.singleLine ? "flex-wrap:nowrap" : "flex-wrap:wrap",
      "align-items:center",
      "gap:8px 12px",
      // Sized on its content: the centring left offset would otherwise squeeze it to the space left of it.
      "width:max-content",
      "max-width:min(92vw,560px)",
      "padding:10px 10px 10px 14px",
      "box-sizing:border-box",
      "transform:translate(-50%,-100%)",
      `font:500 13px/1.45 ${FONT}`,
      "color:#f4f1ea",
      "background:#14161b",
      "border:1px solid #343842",
      "border-radius:8px",
      "box-shadow:0 6px 8px rgba(0,0,0,.38)",
      "pointer-events:auto",
    ].join(";");

    this.message = document.createElement("span");
    this.actions = document.createElement("span");
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.textContent = "✕";
    this.closeButton.setAttribute("aria-label", "Fermer");
    this.closeButton.style.cssText = this.buttonStyle(false) + ";padding:6px 8px;background:transparent;border-color:transparent";
    this.closeButton.addEventListener("click", () => this.close());
    this.renderContent(options);

    this.element.append(this.message, this.actions);
    // Keyboard shortcuts of the player must not fire from the notice.
    for (const type of ["keydown", "keyup", "keypress"]) {
      this.element.addEventListener(type, (event) => event.stopPropagation());
    }
    this.element.addEventListener("mouseenter", () => this.clearHideTimer());
    this.element.addEventListener("mouseleave", () => this.scheduleHide());
  }

  show(): void {
    if (this.closed) return;
    mountVideoSurface(this.element);
    this.syncPosition();
    this.positionTimer = setInterval(() => this.syncPosition(), 250);
    this.scheduleHide();
  }

  /** Replace the text, e.g. to report a rejected file. */
  setText(text: string): void {
    this.message.textContent = text;
  }

  /** Replace the whole content and restart the auto-hide delay. */
  update(content: VideoNoticeContent): void {
    if (this.closed) return;
    this.autoHideMs = content.autoHideMs;
    this.renderContent(content);
    if (!this.element.matches(":hover")) this.scheduleHide();
  }

  private renderContent(content: VideoNoticeContent): void {
    this.message.style.cssText = this.options.singleLine
      ? "flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:4px"
      : "flex:1 1 180px;min-width:0;white-space:pre-line;text-wrap:pretty";
    this.message.textContent = content.text;
    this.actions.style.cssText = "display:flex;align-items:center;gap:6px;flex:none";
    this.actions.replaceChildren(...content.actions.map((action) => this.buildAction(action)), this.closeButton);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearHideTimer();
    if (this.positionTimer) clearInterval(this.positionTimer);
    this.positionTimer = null;
    forgetVideoSurface(this.element);
    this.element.remove();
    this.options.onClose?.();
  }

  private buildAction(action: VideoNoticeAction): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = action.label;
    element.style.cssText = this.buttonStyle(action.primary === true);
    element.addEventListener("click", () => action.onClick());
    return element;
  }

  private buttonStyle(primary: boolean): string {
    return [
      "display:inline-block",
      "padding:7px 11px",
      "border-radius:6px",
      "cursor:pointer",
      "white-space:nowrap",
      `font:600 12px/1.35 ${FONT}`,
      primary ? "color:#0c0d10" : "color:#f4f1ea",
      primary ? "background:#ff624d" : "background:#1c1f26",
      primary ? "border:1px solid #ff624d" : "border:1px solid #343842",
    ].join(";");
  }

  private syncPosition(): void {
    if (!this.video.isConnected) {
      this.close();
      return;
    }
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.element.style.maxWidth = `${Math.min(560, rect.width * 0.92)}px`;
    this.element.style.left = `${rect.left + rect.width / 2}px`;
    this.element.style.top = `${rect.bottom - bottomInset(rect.height)}px`;
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    if (this.autoHideMs === null) return;
    this.hideTimer = setTimeout(() => this.close(), this.autoHideMs);
  }

  private clearHideTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
