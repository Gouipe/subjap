export const NETFLIX_SEEK_EVENT = "subjap:netflix-seek";
export const NETFLIX_SEEK_RESULT_EVENT = "subjap:netflix-seek-result";

export interface NetflixSeekTransport {
  seek(timeSeconds: number, resume: boolean): Promise<boolean>;
}

interface SeekResultDetail {
  source?: unknown;
  requestId?: unknown;
  ok?: unknown;
}

interface BridgeState {
  source: string;
  requestId: string;
  ok: boolean;
}

const BRIDGE_READY_ATTRIBUTE = "subjapNetflixBridge";
const BRIDGE_SCRIPT_ID = "subjap-netflix-bridge";

export class NetflixSeekBridge implements NetflixSeekTransport {
  private nextRequestId = 0;
  private bridgeReady: Promise<boolean> | null = null;
  private seekQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly doc: Document = document,
    private readonly getBridgeUrl: () => string = () =>
      chrome.runtime.getURL("netflix-bridge.js"),
    private readonly timeoutMs = 1500,
  ) {}

  seek(timeSeconds: number, resume: boolean): Promise<boolean> {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return Promise.resolve(false);
    }

    const operation = this.seekQueue.then(
      () => this.seekOnce(timeSeconds, resume),
      () => this.seekOnce(timeSeconds, resume),
    );
    this.seekQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Install the page-world bridge early enough to observe later Netflix data. */
  prepare(): Promise<boolean> {
    return this.ensureBridge();
  }

  private async seekOnce(
    timeSeconds: number,
    resume: boolean,
  ): Promise<boolean> {
    if (!(await this.ensureBridge())) return false;

    const requestId = `${Date.now()}-${++this.nextRequestId}`;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.doc.removeEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);
        resolve(ok);
      };
      const onResult = (event: Event) => {
        const detail = (event as CustomEvent<SeekResultDetail>).detail;
        if (
          !detail ||
          detail.source !== "subjap" ||
          detail.requestId !== requestId
        ) {
          return;
        }
        finish(detail.ok === true);
      };
      const timeout = setTimeout(() => finish(false), this.timeoutMs);

      this.doc.addEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);
      this.doc.dispatchEvent(
        new CustomEvent(NETFLIX_SEEK_EVENT, {
          detail: {
            source: "subjap",
            requestId,
            timeMs: Math.round(timeSeconds * 1000),
            resume,
          },
        }),
      );
    });
  }

  private ensureBridge(): Promise<boolean> {
    if (this.doc.documentElement.dataset[BRIDGE_READY_ATTRIBUTE] === "ready") {
      return Promise.resolve(true);
    }
    if (this.bridgeReady) return this.bridgeReady;

    this.bridgeReady = new Promise<boolean>((resolve) => {
      const existing = this.doc.getElementById(BRIDGE_SCRIPT_ID);
      const script = existing instanceof HTMLScriptElement ? existing : null;
      if (!script) {
        let url: string;
        try {
          url = this.getBridgeUrl();
        } catch {
          resolve(false);
          return;
        }
        const created = this.doc.createElement("script");
        created.id = BRIDGE_SCRIPT_ID;
        created.src = url;
        created.async = false;
        (this.doc.head ?? this.doc.documentElement).appendChild(created);
      }

      const startedAt = Date.now();
      const checkReady = () => {
        if (
          this.doc.documentElement.dataset[BRIDGE_READY_ATTRIBUTE] === "ready"
        ) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= this.timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(checkReady, 10);
      };
      checkReady();
    }).finally(() => {
      this.bridgeReady = null;
    });

    return this.bridgeReady;
  }
}

export function isBridgeState(value: unknown): value is BridgeState {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<BridgeState>;
  return (
    detail.source === "subjap" &&
    typeof detail.requestId === "string" &&
    typeof detail.ok === "boolean"
  );
}
