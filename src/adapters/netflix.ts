// Netflix L1 adapter – implements PlatformAdapter for the Netflix web player.
import type {
  CueReplaySession,
  EpisodeContext,
  PlatformAdapter,
  PlatformId,
  SecondarySubtitleLanguage,
  SubtitleCue,
} from "@/core/types";
import { sendMessage } from "@/core/messaging";
import { activeSubtitleCues, compactSubtitleText, SubtitleTrackCatalog } from "@/subtitles/timeline";
import {
  getLocalSubtitle,
  localSubtitleStorageKey,
  normalizeCueText,
  parseLocalSubtitleCues,
  parseSubtitleFile,
} from "@/subtitles";
import {
  NetflixSeekBridge,
  type NetflixSeekTransport,
} from "./netflix-seek-bridge";

const NETFLIX_TIMED_TEXT_EVENT = "subjap:netflix-timed-text";
const NETFLIX_TIMED_TEXT_URL_EVENT = "subjap:netflix-timed-text-url";
const NETFLIX_TIMED_TEXT_REQUEST_EVENT = "subjap:netflix-timed-text-request";
const NETFLIX_SELECTED_TRACK_EVENT = "subjap:netflix-selected-track";

interface NetflixTimedTextPayload {
  url: string;
  language: string;
  body: string;
  episodeId?: string;
  trackId?: string;
}

interface NetflixTimedTextUrlPayload {
  url: string;
  language: string;
  episodeId?: string;
  trackId?: string;
}

interface VisibleDomLine {
  text: string;
  start: number;
  end: number;
  language: string;
}

type ActiveDomCue = SubtitleCue;

function cueSnapshot(cue: SubtitleCue): SubtitleCue {
  return Object.freeze({ ...cue });
}

class NetflixCueReplaySession implements CueReplaySession {
  private observing = false;
  private targetSeen = false;
  private settled = false;
  private readonly endPromise: Promise<number>;
  private resolveEnd!: (end: number) => void;
  private closed = false;

  constructor(
    private readonly target: SubtitleCue,
    private readonly onClose: (session: NetflixCueReplaySession) => void,
  ) {
    this.endPromise = new Promise<number>((resolve) => {
      this.resolveEnd = resolve;
    });
    if (target.endConfirmed !== false && target.end > target.start) {
      this.finish(target.end);
    }
  }

  get targetText(): string {
    return this.target.text;
  }

  startObserving(): void {
    this.observing = true;
  }

  observe(visibleLines: string[], observationTime: number): void {
    if (this.settled || !this.observing) return;

    const overlapsTarget =
      observationTime >= this.target.start - 0.05 &&
      compactSubtitleText(visibleLines.join("\n")) === compactSubtitleText(this.target.text);
    if (overlapsTarget) {
      this.targetSeen = true;
      return;
    }
    if (this.targetSeen) this.finish(Math.max(this.target.start, observationTime));
  }

  waitForEnd(): Promise<number> {
    return this.endPromise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.settled) {
      this.finish(this.target.start);
    }
    this.onClose(this);
  }

  private finish(end: number): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveEnd(end);
  }
}

// ---------------------------------------------------------------------------
// Netflix adapter
// ---------------------------------------------------------------------------

const NETFLIX_VIDEO_SELECTORS = [
  '.watch-video video',
  'video[class*="VideoContainer"]',
  '#appMountPoint video',
  'video',
] as const;

/**
 * Netflix does NOT expose its subtitles through `video.textTracks` — the
 * player renders them into a DOM container (`.player-timedtext`) with one
 * absolutely-positioned `.player-timedtext-text-container` per line. We
 * observe that container and read the line text from it.
 */
const NETFLIX_TIMEDTEXT_SELECTORS = [
  '.player-timedtext',
  '[class*="player-timedtext"]',
] as const;

const NETFLIX_TIMEDTEXT_LINE_SELECTOR = '.player-timedtext-text-container';

/** Debounce for timed-text DOM mutations (Netflix re-renders on resize…). */
const EMIT_DEBOUNCE_MS = 60;
/** Match the brief timed-text disappearance caused by a seek to its target. */
const SEEK_TARGET_TOLERANCE_SECONDS = 0.5;
/** Accept the media element's seeked event when Netflix lands near the target. */
const SEEKED_TARGET_TOLERANCE_SECONDS = 1;
/** Bound suppression when Netflix drops or coalesces a programmatic seek. */
const SEEK_LANDING_TIMEOUT_MS = 2_500;

function hasMeaningfulCueText(text: string): boolean {
  return normalizeCueText(text).length > 0;
}

/**
 * Read Netflix's visible subtitle base text without ruby annotations.
 *
 * Netflix can render Japanese furigana as `<ruby><rt>…</rt></ruby>` inside
 * the timed-text DOM. `textContent` alone would concatenate the annotation
 * with the base text and make the tokenizer display the reading as a second
 * word. Clone the line so the native subtitle DOM remains untouched.
 */
function textWithoutRubyAnnotations(line: HTMLElement): string {
  const clone = line.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("rt, rp").forEach((annotation) => annotation.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export class NetflixAdapter implements PlatformAdapter {
  id: PlatformId = 'netflix';

  private readonly seekTransport: NetflixSeekTransport;

  private video: HTMLVideoElement | null = null;
  private videoObserver: MutationObserver | null = null;

  // Timed-text DOM observation state.
  private timedtext: HTMLElement | null = null;
  private rootObserver: MutationObserver | null = null;
  private timedtextObserver: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingObservationTime: number | null = null;
  private activeDomCue: ActiveDomCue | null = null;
  private cueReplaySession: NetflixCueReplaySession | null = null;
  private nextDomCueId = 0;
  private pendingSeekTarget: number | null = null;
  private seekLandingTimer: ReturnType<typeof setTimeout> | null = null;
  private cueCallback: ((cues: SubtitleCue[]) => void) | null = null;
  private trackUnsubscriber: (() => void) | null = null;
  private videoHuntTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tracks = new SubtitleTrackCatalog();
  private domHistory: SubtitleCue[] = [];
  private nativeTrackId: string | null = null;
  private standardTrack: TextTrack | null = null;
  private standardTrackRevision = 0;
  private standardCues: SubtitleCue[] = [];
  private pendingDomLanding: { cue: SubtitleCue; expiresAt: number } | null = null;
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  private localPrimaryCues: SubtitleCue[] = [];
  private localTranslationCues: SubtitleCue[] = [];
  private localSubtitleLoadRevision = 0;
  private readonly requestedTimedTextUrls = new Set<string>();
  private preferredSecondaryLanguage: SecondarySubtitleLanguage = "fr";
  private playbackSessionId: string;
  private playbackSessionGeneration = 0;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private timeupdateVideo: HTMLVideoElement | null = null;
  private readonly onTimeUpdate = () => this.emitCues();
  private readonly onSeeking = () => {
    if (this.cueReplaySession) return;
    this.activeDomCue = null;
    this.pendingObservationTime = null;
    this.pendingDomLanding = null;
  };
  private readonly onSeeked = (event: Event) => {
    this.ensurePlaybackSession();
    const target = this.pendingSeekTarget;
    if (this.cueReplaySession) return;
    if (target === null) {
      this.emitCues();
      return;
    }
    const video = event.currentTarget;
    const currentTime = video instanceof HTMLVideoElement
      ? video.currentTime
      : this.getCurrentTime();
    if (Math.abs(currentTime - target) > SEEKED_TARGET_TOLERANCE_SECONDS) return;

    const destinationCue = this.landSeek(target);
    if (destinationCue && this.cueCallback) {
      this.cueCallback(this.composeCues([destinationCue]));
      return;
    }
    this.emitCues(target);
  };
  private storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] | null = null;

  /** Last native-subtitle visibility request (re-applied on container swap). */
  private nativeSubsHidden = false;

  // Class toggled on <html> when the native timed-text must be hidden. A
  // page-level CSS rule (rather than an inline style on the container) is used
  // so hiding survives Netflix re-creating or re-styling the container —
  // including per-line inline `visibility` overrides, which would otherwise
  // win over a parent's inherited value.
  private static readonly HIDE_NATIVE_CLASS = "subjap-hide-native-subs";
  private static hideStyleInjected = false;

  constructor(seekTransport: NetflixSeekTransport = new NetflixSeekBridge()) {
    this.seekTransport = seekTransport;
    this.playbackSessionId = this.readPlaybackSessionId();
    if (seekTransport instanceof NetflixSeekBridge) void seekTransport.prepare();
  }

  private static injectHideNativeStyle(): void {
    if (NetflixAdapter.hideStyleInjected) return;
    NetflixAdapter.hideStyleInjected = true;
    const style = document.createElement("style");
    style.id = "subjap-netflix-hide-native-styles";
    style.textContent = `
      html.${NetflixAdapter.HIDE_NATIVE_CLASS} [class*="player-timedtext"],
      html.${NetflixAdapter.HIDE_NATIVE_CLASS} [class*="player-timedtext"] * {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // isActive
  // -----------------------------------------------------------------------
  isActive(doc: Document, url: string): boolean {
    // The content script only runs on the whitelisted domains and this adapter
    // is registered first, so the URL check is authoritative. DOM signals are
    // unreliable at document_end — the Netflix player mounts after the page
    // script has run, so `.watch-video`/`video` may not exist yet.
    if (/netflix\.com/i.test(url)) return true;
    // Secondary DOM signals (kept for robustness).
    if (doc.querySelector('.watch-video')) return true;
    if (doc.querySelector('.player-timedtext')) return true;
    const v = doc.querySelector('video');
    if (v && v.className && /VideoContainer/i.test(v.className)) return true;
    if (doc.querySelector('#appMountPoint') && doc.querySelector('video')) return true;
    return false;
  }

  // -----------------------------------------------------------------------
  // getVideoElement
  // -----------------------------------------------------------------------
  getVideoElement(): HTMLVideoElement | null {
    if (this.video && this.video.isConnected) {
      this.attachTimeUpdateListener();
      return this.video;
    }

    for (const sel of NETFLIX_VIDEO_SELECTORS) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLVideoElement) {
        this.video = el;
        this.installVideoObserver();
        this.attachTimeUpdateListener();
        return el;
      }
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // subscribeCues
  // -----------------------------------------------------------------------
  subscribeCues(cb: (cues: SubtitleCue[]) => void): () => void {
    this.cueCallback = cb;
    this.messageListener = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; type?: unknown; payload?: unknown };
      if (data?.source !== "subjap") return;
      if (data.type === NETFLIX_SELECTED_TRACK_EVENT) {
        const selection = data.payload as Partial<NetflixTimedTextUrlPayload> | null;
        if (!selection || typeof selection.language !== "string" ||
          typeof selection.trackId !== "string" || !selection.trackId) return;
        this.ensurePlaybackSession();
        if (this.currentWatchId() && selection.episodeId !== this.currentWatchId()) return;
        const language = normalizeTrackLanguage(selection.language);
        if (language === "ja" && this.nativeTrackId !== selection.trackId) {
          this.nativeTrackId = selection.trackId;
          this.domHistory = [];
          this.activeDomCue = null;
          this.standardTrack = null;
          this.standardCues = [];
          this.pendingDomLanding = null;
          this.pendingSeekTarget = null;
          this.clearSeekLandingTimer();
        }
        this.tracks.selectTrack(language, selection.trackId);
        this.emitCues();
        return;
      }
      if (data.type === NETFLIX_TIMED_TEXT_URL_EVENT) {
        this.requestTimedText(data.payload);
        return;
      }
      if (data.type !== NETFLIX_TIMED_TEXT_EVENT) return;
      this.storeTimedText(data.payload);
    };
    window.addEventListener("message", this.messageListener);
    this.storageListener = (changes, areaName) => {
      if (areaName !== "local") return;
      const watchId = this.currentWatchId();
      if (!watchId || (
        !changes[localSubtitleStorageKey(watchId, "primary")] &&
        !changes[localSubtitleStorageKey(watchId, "secondary")]
      )) return;
      void this.loadLocalSubtitles();
    };
    chrome.storage.onChanged.addListener(this.storageListener);
    void this.loadLocalSubtitles();
    this.requestCurrentEpisodeTimedText();

    // Primary path: observe Netflix's timed-text DOM container.
    this.attachTimedTextObserver();

    // Fallback path: standard <track> elements (some player variants expose
    // Japanese tracks through textTracks; duplicate emissions are absorbed
    // by the content script's cue-signature dedupe).
    const unsubTracks = this.subscribeTextTracks();

    this.trackUnsubscriber = () => {
      unsubTracks();
      this.detachTimedTextObserver();
      this.cueCallback = null;
      if (this.messageListener) window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
      if (this.storageListener) chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
      this.requestedTimedTextUrls.clear();
    };

    return this.trackUnsubscriber;
  }

  private requestTimedText(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const data = payload as Partial<NetflixTimedTextUrlPayload>;
    if (typeof data.url !== "string" || typeof data.language !== "string") return;
    this.ensurePlaybackSession();
    const watchId = this.currentWatchId();
    if (watchId && data.episodeId !== watchId) return;
    const requestKey = `${data.url}\u0000${data.trackId ?? ""}`;
    if (this.requestedTimedTextUrls.has(requestKey)) return;
    this.requestedTimedTextUrls.add(requestKey);
    const requestedGeneration = this.playbackSessionGeneration;
    const requestedEpisodeId = watchId ?? data.episodeId;
    const request: NetflixTimedTextUrlPayload = {
      url: data.url,
      language: data.language,
      episodeId: requestedEpisodeId,
      trackId: typeof data.trackId === "string" ? data.trackId : undefined,
    };

    void sendMessage("netflix:timedTextFetch", {
      url: request.url,
      language: request.language,
    })
      .then(({ body, language, url }) => {
        this.ensurePlaybackSession();
        if (requestedGeneration !== this.playbackSessionGeneration) return;
        if (body) {
          this.storeTimedText({
            url,
            language,
            body,
            episodeId: requestedEpisodeId,
            trackId: request.trackId,
          });
        }
      })
      .catch((error: unknown) => {
        this.requestedTimedTextUrls.delete(requestKey);
        console.warn("[SubJap] timed text fetch failed:", error);
      });
  }

  // -----------------------------------------------------------------------
  // Timed-text DOM observation (primary cue source)
  // -----------------------------------------------------------------------

  private findTimedTextContainer(): HTMLElement | null {
    for (const sel of NETFLIX_TIMEDTEXT_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  private attachTimedTextObserver(): void {
    if (this.rootObserver) return;

    const tryAttach = () => {
      const el = this.findTimedTextContainer();
      if (!el || el === this.timedtext) return;

      this.timedtext = el;
      this.timedtextObserver?.disconnect();
      this.timedtextObserver = new MutationObserver(() => this.scheduleEmit());
      this.timedtextObserver.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // The <video> and the timed-text container mount together: force video
      // discovery so cue timestamps resolve against real playback time. If it
      // is not in the DOM yet, poll until it appears (then re-emit).
      const huntVideo = () => {
        if (!this.getVideoElement()) return false;
        if (this.videoHuntTimer !== null) {
          clearInterval(this.videoHuntTimer);
          this.videoHuntTimer = null;
        }
        console.log('[SubJap] Netflix video found');
        this.scheduleEmit();
        return true;
      };
      if (!huntVideo()) {
        this.videoHuntTimer = setInterval(huntVideo, 400);
      }

      // Netflix recreates this element on track changes / SPA navigation —
      // re-apply the native-subtitle visibility preference on every attach.
      this.applyNativeVisibility();

      console.log('[SubJap] Netflix timedtext observer attached');
      this.scheduleEmit();
    };

    // The container appears once the player mounts; watch the whole document
    // for its arrival (and for its recreation on SPA navigation).
    const timedtextSelector = NETFLIX_TIMEDTEXT_SELECTORS.join(',');
    this.rootObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (
            node instanceof HTMLElement &&
            (node.matches(timedtextSelector) ||
              node.querySelector(timedtextSelector))
          ) {
            tryAttach();
            return;
          }
        }
      }
    });
    this.rootObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    tryAttach();
  }

  private detachTimedTextObserver(): void {
    this.rootObserver?.disconnect();
    this.rootObserver = null;
    this.timedtextObserver?.disconnect();
    this.timedtextObserver = null;
    this.timedtext = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingObservationTime = null;
    this.activeDomCue = null;
    this.pendingDomLanding = null;
    this.clearBoundaryTimer();
    this.pendingSeekTarget = null;
    this.clearSeekLandingTimer();
    if (this.videoHuntTimer !== null) {
      clearInterval(this.videoHuntTimer);
      this.videoHuntTimer = null;
    }
  }

  private scheduleEmit(): void {
    // Capture the media clock on the first mutation in the batch. Reading it
    // after the debounce makes every untimed Netflix cue start too late.
    if (this.pendingObservationTime === null) {
      const currentTime = this.getVideoElement()?.currentTime;
      if (currentTime !== undefined && Number.isFinite(currentTime)) {
        this.pendingObservationTime = Math.round(currentTime * 1000) / 1000;
      }
    }
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const observationTime = this.pendingObservationTime;
      this.pendingObservationTime = null;
      this.emitCues(observationTime);
    }, EMIT_DEBOUNCE_MS);
  }

  private readVisibleDomLines(container: HTMLElement | null): VisibleDomLine[] {
    const lines: VisibleDomLine[] = [];
    if (!container) return lines;

    let lineEls = Array.from(
      container.querySelectorAll<HTMLElement>(NETFLIX_TIMEDTEXT_LINE_SELECTOR),
    );
    if (lineEls.length === 0) {
      lineEls = Array.from(container.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement,
      );
    }

    for (const line of lineEls) {
      const text = textWithoutRubyAnnotations(line);
      if (!text) continue;
      const startAttr =
        line.getAttribute('data-start') ??
        line.querySelector('span')?.getAttribute('data-start');
      const endAttr =
        line.getAttribute('data-end') ??
        line.querySelector('span')?.getAttribute('data-end');
      lines.push({
        text,
        start: startAttr ? Number.parseFloat(startAttr) : NaN,
        end: endAttr ? Number.parseFloat(endAttr) : NaN,
        language: normalizeTrackLanguage(
          line.querySelector<HTMLElement>("[lang]")?.getAttribute("lang") ?? "ja",
        ),
      });
    }
    return lines;
  }

  private emitCues(capturedObservationTime: number | null = null): void {
    if (this.ensurePlaybackSession()) {
      // Do not attach a mutation timestamp captured for the previous title to
      // the new episode. The next DOM/track emission will use its own clock.
      capturedObservationTime = null;
    }
    const cb = this.cueCallback;
    if (!cb) return;

    // getVideoElement() also drives video discovery (see videoHuntTimer); the
    // overlay renderer still needs the video, but we can read cue text without
    // it, so don't gate emission on its presence.
    const video = this.getVideoElement();
    const container = this.timedtext ?? this.findTimedTextContainer();
    const observationTime = capturedObservationTime ?? video?.currentTime ?? 0;
    const lines = this.readVisibleDomLines(container);
    const japaneseLines = lines.filter((line) => line.language === "ja");
    this.armBoundaryTimer();

    // Audio replay deliberately seeks around the target. Feed those DOM
    // transitions only to the private replay observer: they must not mutate
    // the live cue or reach the overlay as freshly-created cues.
    if (this.cueReplaySession) {
      this.cueReplaySession.observe(
        japaneseLines.map((line) => line.text),
        observationTime,
      );
      return;
    }

    if (video?.seeking) return;

    // A programmatic seek can expose several stale DOM states while Netflix
    // moves the media clock. Ignore that transit completely, then rebuild one
    // fresh cue at the destination (preferably from the official track).
    if (this.pendingSeekTarget !== null) {
      if (
        Math.abs(observationTime - this.pendingSeekTarget) >
        SEEK_TARGET_TOLERANCE_SECONDS
      ) {
        return;
      }
      const destinationCue = this.landSeek(this.pendingSeekTarget);
      if (destinationCue) {
        cb(this.composeCues([destinationCue]));
        return;
      }
    }

    // Official segments are the common model for display and all consumers.
    // A silence on this track is a silence, even if Netflix's DOM is stale.
    this.tracks.observeJapanese(japaneseLines.map((line) => line.text).join("\n"), observationTime);
    if (this.tracks.cues("ja").length) {
      this.activeDomCue = null;
      cb(this.composeCues([]));
      return;
    }

    this.readStandardTrack();
    if (this.standardCues.length) {
      this.activeDomCue = null;
      cb(this.composeCues([]));
      return;
    }
    if (this.pendingDomLanding) {
      const { cue, expiresAt } = this.pendingDomLanding;
      const matches = compactSubtitleText(japaneseLines.map((line) => line.text).join("\n")) ===
        compactSubtitleText(cue.text);
      if (matches) {
        this.activeDomCue = { ...cue };
        this.pendingDomLanding = null;
      } else if (performance.now() < expiresAt) {
        // A remembered subtitle is a seek target, not evidence of what Netflix
        // is showing. Publishing it here can start an exercise in a silence.
        cb(this.composeCues([]));
        return;
      } else {
        this.pendingDomLanding = null;
      }
    }

    if (lines.length === 0) {
      this.finalizeActiveDomCue(observationTime);
      cb(this.composeCues([]));
      return;
    }

    // Netflix renders the selected track in the same container. Only use it
    // as the learner track when its own DOM marks it as Japanese; otherwise
    // fall back to the cached Japanese timed-text track below.
    if (japaneseLines.length === 0) {
      this.finalizeActiveDomCue(observationTime);
      cb(this.composeCues([]));
      return;
    }

    const text = japaneseLines.map((line) => line.text).join("\n");
    const allStartsKnown = japaneseLines.every((line) => Number.isFinite(line.start));
    const allEndsKnown = japaneseLines.every((line) => Number.isFinite(line.end));
    const knownStart = allStartsKnown ? Math.min(...japaneseLines.map((line) => line.start)) : null;
    if (this.activeDomCue &&
      compactSubtitleText(this.activeDomCue.text) === compactSubtitleText(text) &&
      (knownStart === null || knownStart === this.activeDomCue.start)) {
      cb(this.composeCues([cueSnapshot(this.activeDomCue)]));
      return;
    }

    this.finalizeActiveDomCue(observationTime);
    // Re-observing a known interval during replay must retain its identity.
    // This is exact text inside confirmed bounds, never a proximity merge.
    const historical = this.domHistory.find((cue) =>
      cue.endConfirmed !== false && cue.start <= observationTime && observationTime < cue.end &&
      (knownStart === null || knownStart === cue.start) &&
      compactSubtitleText(cue.text) === compactSubtitleText(text));
    if (historical) {
      this.activeDomCue = { ...historical };
      cb(this.composeCues([cueSnapshot(this.activeDomCue)]));
      return;
    }
    // A changed visible block is a new observation. Shared words/lines do not
    // prove that A -> A+B -> B is one spoken sentence.
    const start = knownStart ?? Math.max(0, observationTime);
    const end = allEndsKnown ? Math.max(...japaneseLines.map((line) => line.end)) : start;
    const cue: ActiveDomCue = {
      id: `${this.playbackSessionId}:dom:${++this.nextDomCueId}`,
      start, end, endConfirmed: allEndsKnown, text, language: "ja",
      source: Object.freeze({
        kind: "dom", sessionId: this.playbackSessionId,
        startPrecision: allStartsKnown ? "exact" : "estimated",
      }),
    };
    this.activeDomCue = cue;
    this.rememberDomCue(cue);
    cb(this.composeCues([cueSnapshot(cue)]));
  }

  private composeCues(japanese: SubtitleCue[]): SubtitleCue[] {
    const official = this.tracks.cues("ja");
    const timed = official.length ? official : this.standardCues;
    const japaneseCues = this.localPrimaryCues.length
      ? activeSubtitleCues(this.localPrimaryCues, this.getCurrentTime())
      : timed.length
        ? activeSubtitleCues(timed, this.getCurrentTime())
        : japanese.filter((cue) => hasMeaningfulCueText(cue.text));
    const translation = this.getActiveTranslationCue();
    return (translation ? [...japaneseCues, translation] : japaneseCues).map(cueSnapshot);
  }

  private getActiveTranslationCue(): SubtitleCue | null {
    if (this.preferredSecondaryLanguage === "none") return null;
    const currentTime = this.getCurrentTime();
    if (this.localTranslationCues.length > 0) {
      return activeSubtitleCues(this.localTranslationCues, currentTime)[0] ?? null;
    }
    const languagePriority: SecondarySubtitleLanguage[] =
      this.preferredSecondaryLanguage === "fr" ? ["fr", "en"] : ["en", "fr"];
    for (const language of languagePriority) {
      const cues = this.tracks.cues(language);
      const active = cues.find(
        (cue) => cue.start <= currentTime && currentTime < cue.end,
      );
      if (active) return active;
    }
    return null;
  }

  setSecondarySubtitleLanguage(language: SecondarySubtitleLanguage): void {
    if (this.preferredSecondaryLanguage === language) return;
    this.preferredSecondaryLanguage = language;
    this.requestCurrentEpisodeTimedText();
    this.emitCues();
  }

  private async loadLocalSubtitles(): Promise<void> {
    const watchId = this.currentWatchId();
    const sessionId = this.playbackSessionId;
    const revision = ++this.localSubtitleLoadRevision;
    if (!watchId) {
      this.localPrimaryCues = [];
      this.localTranslationCues = [];
      this.emitCues();
      return;
    }

    try {
      const [primary, secondary] = await Promise.all([
        getLocalSubtitle(watchId, "primary"),
        getLocalSubtitle(watchId, "secondary"),
      ]);
      if (revision !== this.localSubtitleLoadRevision || sessionId !== this.playbackSessionId) {
        return;
      }
      this.localPrimaryCues = parseLocalSubtitleCues(watchId, "primary", primary);
      this.localTranslationCues = parseLocalSubtitleCues(watchId, "secondary", secondary);
      this.emitCues();
    } catch (error: unknown) {
      console.warn("[SubJap] Failed to load local subtitles:", error);
    }
  }

  private storeTimedText(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const data = payload as Partial<NetflixTimedTextPayload>;
    if (typeof data.body !== "string" || typeof data.url !== "string") return;
    this.ensurePlaybackSession();
    const watchId = this.currentWatchId();
    if (watchId && data.episodeId !== watchId) return;
    const requestedLanguage = normalizeTrackLanguage(data.language ?? "");
    if (
      requestedLanguage !== "ja" &&
      requestedLanguage !== "fr" &&
      requestedLanguage !== "en"
    ) return;
    const parsedCues = parseSubtitleFile(data.url, data.body);
    if (parsedCues.length === 0) return;
    const language =
      requestedLanguage !== "ja" && isPredominantlyJapaneseSubtitle(parsedCues)
        ? "ja"
        : requestedLanguage;
    if (language !== requestedLanguage) {
      console.warn(
        `[SubJap] Netflix rejected ${requestedLanguage} label for Japanese timed text`,
      );
    }
    this.tracks.store(
      language, typeof data.trackId === "string" ? data.trackId : undefined,
      data.url, parsedCues, this.playbackSessionId,
    );
    this.emitCues();
  }

  private landSeek(observationTime: number): SubtitleCue | null {
    this.pendingSeekTarget = null;
    this.clearSeekLandingTimer();
    this.activeDomCue = null;
    const timed = this.tracks.cues("ja");
    if (timed.length) return activeSubtitleCues(timed, observationTime)[0] ?? null;
    // Reuse only an explicitly requested historical start, never a nearby cue.
    const destination = this.domHistory.find((cue) => cue.start === observationTime);
    if (destination) {
      this.pendingDomLanding = { cue: destination, expiresAt: performance.now() + SEEK_LANDING_TIMEOUT_MS };
      // Wait for emitCues to confirm the native text at the destination.
    }
    return null;
  }

  private clearBoundaryTimer(): void {
    if (this.boundaryTimer !== null) clearTimeout(this.boundaryTimer);
    this.boundaryTimer = null;
  }

  /** Paint official boundaries without waiting for a coarse media timeupdate. */
  private armBoundaryTimer(): void {
    this.clearBoundaryTimer();
    const video = this.video;
    if (!video || video.paused || video.seeking || this.cueReplaySession) return;
    const time = video.currentTime;
    let next = Infinity;
    for (const cues of [this.tracks.cues("ja"), this.standardCues,
      this.tracks.cues("fr"), this.tracks.cues("en")]) {
      for (const cue of cues) {
        if (cue.start > time) next = Math.min(next, cue.start);
        if (cue.end > time) next = Math.min(next, cue.end);
      }
    }
    if (!Number.isFinite(next)) return;
    this.boundaryTimer = setTimeout(() => {
      this.boundaryTimer = null;
      this.emitCues();
    }, Math.max(20, (next - time) / Math.max(0.1, video.playbackRate) * 1000));
  }

  private clearSeekLandingTimer(): void {
    if (this.seekLandingTimer === null) return;
    clearTimeout(this.seekLandingTimer);
    this.seekLandingTimer = null;
  }

  private armSeekLandingTimeout(target: number): void {
    this.clearSeekLandingTimer();
    this.seekLandingTimer = setTimeout(() => {
      this.seekLandingTimer = null;
      if (this.pendingSeekTarget !== target) return;
      this.landSeek(target);
      this.scheduleEmit();
    }, SEEK_LANDING_TIMEOUT_MS);
  }

  private finalizeActiveDomCue(observationTime: number): void {
    const active = this.activeDomCue;
    if (!active) return;
    if (active.endConfirmed !== false) {
      this.activeDomCue = null;
      return;
    }

    active.end = Math.max(active.start, observationTime);
    active.endConfirmed = true;
    this.rememberDomCue(active);
    this.activeDomCue = null;
  }

  private rememberDomCue(cue: SubtitleCue): void {
    const text = compactSubtitleText(cue.text);
    this.domHistory = [
      ...this.domHistory.filter((existing) => existing.id !== cue.id && !(
        // A continuous, complete replay supersedes a partial observation made
        // after loading/seeking into this same subtitle. Separate occurrences
        // outside its interval and overlapping different speakers stay intact.
        cue.endConfirmed !== false && cue.start <= existing.start && existing.start < cue.end &&
        compactSubtitleText(existing.text) === text
      )),
      ...(cue.endConfirmed === false || cue.end > cue.start ? [cueSnapshot(cue)] : []),
    ].sort((a, b) => a.start - b.start);
  }

  // -----------------------------------------------------------------------
  // textTracks fallback (rare on Netflix, kept for robustness)
  // -----------------------------------------------------------------------

  private readStandardTrack(): void {
    const track = Array.from(this.video?.textTracks ?? []).find((candidate) =>
      /^ja(?:pn)?(?:-|$)/i.test(candidate.language) && candidate.mode === "showing",
    ) ?? null;
    if (track === this.standardTrack && (track?.cues?.length ?? 0) === this.standardCues.length) return;
    if (this.standardTrack !== track) this.standardTrackRevision += 1;
    this.standardTrack = track;
    this.standardCues = Array.from(track?.cues ?? []).map((item, index) => {
      const cue = item as VTTCue;
      return cueSnapshot({
        id: `${this.playbackSessionId}:text-track:${track?.id ?? ""}:${index}:${cue.id}`,
        start: cue.startTime, end: cue.endTime, endConfirmed: true, text: cue.text, language: "ja",
        source: Object.freeze({ kind: "text-track", sessionId: this.playbackSessionId,
          trackId: track?.id, resourceId: `text-track:${this.standardTrackRevision}`, startPrecision: "exact" }),
      });
    }).sort((a, b) => a.start - b.start);
  }

  private subscribeTextTracks(): () => void {
    const onCueChange = () => this.emitCues();

    const video = this.getVideoElement();
    if (!video) return () => {};

    video.addEventListener('cuechange', onCueChange);
    for (const track of video.textTracks) {
      track.addEventListener('cuechange', onCueChange);
    }

    const onAddTrack = (e: Event) => {
      const track = (e as TrackEvent).track;
      if (track) track.addEventListener('cuechange', onCueChange);
    };
    video.addEventListener('addtrack', onAddTrack);

    return () => {
      video.removeEventListener('cuechange', onCueChange);
      video.removeEventListener('addtrack', onAddTrack);
      for (const track of video.textTracks) {
        track.removeEventListener('cuechange', onCueChange);
      }
    };
  }

  // -----------------------------------------------------------------------
  // getCurrentTime / getPlaybackRate
  // -----------------------------------------------------------------------
  getCurrentTime(): number {
    return this.getVideoElement()?.currentTime ?? 0;
  }

  isPaused(): boolean {
    return this.getVideoElement()?.paused ?? true;
  }

  getPlaybackRate(): number {
    return this.getVideoElement()?.playbackRate ?? 1;
  }

  getNavigationCues(): SubtitleCue[] {
    this.ensurePlaybackSession();
    if (this.localPrimaryCues.length > 0) return this.localPrimaryCues;
    // The track array is replaced when timed text is stored. Returning the
    // stable instance lets CueNavigator skip identical timeupdate snapshots.
    const official = this.tracks.cues("ja");
    return official.length ? official : this.standardCues.length ? this.standardCues : this.domHistory;
  }

  getNavigationSessionId(): string {
    this.ensurePlaybackSession();
    const source = (this.tracks.cues("ja")[0] ?? this.standardCues[0])?.source;
    return JSON.stringify([this.playbackSessionId, this.playbackSessionGeneration,
      this.nativeTrackId, source?.trackId, source?.resourceId,
      this.localPrimaryCues[0]?.source?.sessionId]);
  }

  beginCueReplay(cue: SubtitleCue): CueReplaySession {
    this.cueReplaySession?.close();
    const session = new NetflixCueReplaySession(cueSnapshot(cue), (closed) => {
      if (this.cueReplaySession !== closed) return;
      this.cueReplaySession = null;
      this.pendingObservationTime = null;
      this.pendingSeekTarget = null;
      this.clearSeekLandingTimer();
      this.scheduleEmit();
    });
    this.cueReplaySession = session;
    return session;
  }

  seekTo(timeSeconds: number, resume: boolean): Promise<boolean> {
    this.ensurePlaybackSession();
    if (this.cueReplaySession) {
      return this.seekTransport.seek(timeSeconds, resume);
    }
    // Discard a mutation batch captured before the seek. It must not timestamp
    // the destination's text using the previous playback position.
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingObservationTime = null;
    this.activeDomCue = null;
    this.clearSeekLandingTimer();
    this.pendingSeekTarget = timeSeconds;
    return this.seekTransport.seek(timeSeconds, resume).then(
      (accepted) => {
        if (this.pendingSeekTarget !== timeSeconds) return accepted;
        if (accepted) {
          this.armSeekLandingTimeout(timeSeconds);
          if (Math.abs(this.getCurrentTime() - timeSeconds) < 0.002) this.emitCues();
        } else {
          this.pendingSeekTarget = null;
        }
        return accepted;
      },
      (error: unknown) => {
        if (this.pendingSeekTarget === timeSeconds) {
          this.pendingSeekTarget = null;
          this.clearSeekLandingTimer();
        }
        throw error;
      },
    );
  }

  // -----------------------------------------------------------------------
  // setNativeSubtitlesVisible
  // -----------------------------------------------------------------------
  setNativeSubtitlesVisible(v: boolean): void {
    this.nativeSubsHidden = !v;
    this.applyNativeVisibility();
  }

  /**
   * Hide/show Netflix's timed-text DOM container by toggling a class on
   * <html>. `visibility` (rather than `display`) keeps the element's layout so
   * Netflix's renderer keeps updating the DOM and cue observation keeps
   * working; the `!important` rule forces every descendant hidden regardless
   * of Netflix's inline styles.
   */
  private applyNativeVisibility(): void {
    NetflixAdapter.injectHideNativeStyle();
    document.documentElement.classList.toggle(
      NetflixAdapter.HIDE_NATIVE_CLASS,
      this.nativeSubsHidden,
    );
  }

  // -----------------------------------------------------------------------
  // getEpisodeContext
  // -----------------------------------------------------------------------
  getEpisodeContext(): EpisodeContext | null {
    const doc = document;

    // Try to pull title from Netflix's episode title panel.
    const titleEl =
      doc.querySelector('.ellipsize-text span') ??
      doc.querySelector('.video-title h4') ??
      doc.querySelector('[data-uia="video-title"]');
    const title =
      titleEl?.textContent?.trim() ??
      doc.title.replace(/^Netflix\s*[–—-]?\s*/i, '').trim() ??
      'Unknown';

    // Episode / season info is often in an anchor near the title.
    const epLink = doc.querySelector('.episode-title a, [data-uia="episode-title"]');
    const epText = epLink?.textContent?.trim() ?? '';
    const epMatch = epText.match(/S(\d+)\s*[:Ee](\d+)/);

    return {
      platform: 'netflix',
      title,
      season: epMatch?.[1],
      episode: epMatch?.[2],
      language: 'ja',
      url: location.href,
    };
  }

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------
  destroy(): void {
    this.trackUnsubscriber?.();
    this.trackUnsubscriber = null;
    this.detachTimedTextObserver();
    this.videoObserver?.disconnect();
    this.videoObserver = null;
    this.video = null;
    this.tracks.clear();
    this.domHistory = [];
    this.nativeTrackId = null;
    this.standardTrack = null;
    this.standardCues = [];
    this.pendingDomLanding = null;
    this.localPrimaryCues = [];
    this.localTranslationCues = [];
    this.requestedTimedTextUrls.clear();
    this.cueReplaySession?.close();
    this.cueReplaySession = null;
    this.detachTimeUpdateListener();
    this.clearSeekLandingTimer();
  }

  /**
   * Scope official tracks and DOM navigation state to one Netflix playback.
   * Netflix commonly keeps the same document and may even reuse the same
   * <video> while moving from one /watch/<id> route to the next episode.
   */
  private ensurePlaybackSession(): boolean {
    const sessionId = this.readPlaybackSessionId();
    if (sessionId === this.playbackSessionId) return false;

    this.playbackSessionId = sessionId;
    this.playbackSessionGeneration += 1;
    this.tracks.clear();
    this.domHistory = [];
    this.nativeTrackId = null;
    this.standardTrack = null;
    this.standardCues = [];
    this.pendingDomLanding = null;
    this.localPrimaryCues = [];
    this.localTranslationCues = [];
    this.requestedTimedTextUrls.clear();
    this.cueReplaySession?.close();
    this.cueReplaySession = null;
    this.activeDomCue = null;
    this.pendingSeekTarget = null;
    this.clearSeekLandingTimer();
    this.pendingObservationTime = null;
    this.nextDomCueId = 0;
    void this.loadLocalSubtitles();
    this.requestCurrentEpisodeTimedText();
    console.info(`[SubJap] Netflix playback session changed: ${sessionId}`);
    return true;
  }

  private requestCurrentEpisodeTimedText(): void {
    const episodeId = this.currentWatchId();
    if (!episodeId) return;
    window.postMessage(
      {
        source: "subjap",
        type: NETFLIX_TIMED_TEXT_REQUEST_EVENT,
        payload: {
          episodeId,
          preferredSecondaryLanguage: this.preferredSecondaryLanguage,
        },
      },
      window.location.origin,
    );
  }

  private readPlaybackSessionId(): string {
    const watchId = window.location.pathname.match(/\/watch\/([^/?#]+)/i)?.[1];
    return watchId
      ? `watch:${watchId}`
      : `${window.location.origin}${window.location.pathname}`;
  }

  private currentWatchId(): string | null {
    return window.location.pathname.match(/\/watch\/([^/?#]+)/i)?.[1] ?? null;
  }

  // -----------------------------------------------------------------------
  // MutationObserver – detect when the video element appears (SPA nav)
  // -----------------------------------------------------------------------
  private installVideoObserver(): void {
    if (this.videoObserver) return;

    this.videoObserver = new MutationObserver(() => {
      if (!this.video?.isConnected) {
        this.detachTimeUpdateListener();
        this.clearBoundaryTimer();
        this.standardTrack = null;
        this.standardCues = [];
        this.pendingDomLanding = null;
        this.video = null;
        this.activeDomCue = null;
        this.pendingSeekTarget = null;
        this.clearSeekLandingTimer();
        // Try to re-discover the video.
        for (const sel of NETFLIX_VIDEO_SELECTORS) {
          const el = document.querySelector(sel);
          if (el instanceof HTMLVideoElement) {
            this.video = el;
            this.attachTimeUpdateListener();
            return;
          }
        }
      }
    });

    this.videoObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    this.attachTimeUpdateListener();
  }

  private detachTimeUpdateListener(): void {
    const video = this.timeupdateVideo;
    if (!video) return;
    for (const event of ["timeupdate", "ratechange", "play", "pause"]) {
      video.removeEventListener(event, this.onTimeUpdate);
    }
    video.removeEventListener("seeked", this.onSeeked);
    video.removeEventListener("seeking", this.onSeeking);
    this.timeupdateVideo = null;
  }

  private attachTimeUpdateListener(): void {
    const video = this.video;
    if (!video || this.timeupdateVideo === video) return;
    this.detachTimeUpdateListener();
    for (const event of ["timeupdate", "ratechange", "play", "pause"]) {
      video.addEventListener(event, this.onTimeUpdate);
    }
    video.addEventListener("seeked", this.onSeeked);
    video.addEventListener("seeking", this.onSeeking);
    this.timeupdateVideo = video;
  }

}

function normalizeTrackLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function isPredominantlyJapaneseSubtitle(cues: SubtitleCue[]): boolean {
  const text = cues.map((cue) => cue.text).join(" ");
  const japaneseCharacters = text.match(/[\u3040-\u30ff\u3400-\u9fff]/gu)?.length ?? 0;
  const latinCharacters = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/gu)?.length ?? 0;
  return japaneseCharacters >= 12 && japaneseCharacters >= latinCharacters;
}
