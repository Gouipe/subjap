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
import {
  getLocalSubtitle,
  localSubtitleStorageKey,
  normalizeCueText,
  parseSubtitleFile,
} from "@/subtitles";
import {
  NetflixSeekBridge,
  type NetflixSeekTransport,
} from "./netflix-seek-bridge";

const NETFLIX_TIMED_TEXT_EVENT = "subjap:netflix-timed-text";
const NETFLIX_TIMED_TEXT_URL_EVENT = "subjap:netflix-timed-text-url";
const NETFLIX_TIMED_TEXT_REQUEST_EVENT = "subjap:netflix-timed-text-request";

interface NetflixTimedTextPayload {
  url: string;
  language: string;
  body: string;
  episodeId?: string;
}

interface NetflixTimedTextUrlPayload {
  url: string;
  language: string;
  episodeId?: string;
}

interface VisibleDomLine {
  text: string;
  start: number;
  end: number;
  language: string;
}

interface ActiveDomCue {
  id: string;
  start: number;
  end: number;
  endConfirmed: boolean;
  text: string;
  language: string;
}

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

  observe(visibleLines: string[], observationTime: number, officialCue: SubtitleCue | null): void {
    if (this.settled || !this.observing) return;
    if (officialCue && officialCue.end > officialCue.start) {
      this.finish(officialCue.end);
      return;
    }

    const overlapsTarget =
      observationTime >= this.target.start - 0.05 &&
      visibleLines.length > 0 &&
      mergeRollingCueLines(this.target.text.split("\n"), visibleLines) !== null;
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
/** Start slightly before the DOM transition so the first syllable is audible. */
const FALLBACK_CUE_PREROLL_SECONDS = 0.15;
/** Match the brief timed-text disappearance caused by a seek to its target. */
const SEEK_TARGET_TOLERANCE_SECONDS = 0.5;
/** Accept the media element's seeked event when Netflix lands near the target. */
const SEEKED_TARGET_TOLERANCE_SECONDS = 1;
/** Bound suppression when Netflix drops or coalesces a programmatic seek. */
const SEEK_LANDING_TIMEOUT_MS = 2_500;

function compactCueLines(lines: string[]): string {
  return compactCueText(lines.join(""));
}

function compactCueText(text: string): string {
  return normalizeCueText(text).replace(/\s+/gu, "");
}

function hasMeaningfulCueText(text: string): boolean {
  return normalizeCueText(text).length > 0;
}

function overlapsMostOfShorterCue(a: SubtitleCue, b: SubtitleCue): boolean {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorterDuration = Math.min(
    Math.max(0, a.end - a.start),
    Math.max(0, b.end - b.start),
  );
  return shorterDuration > 0 && overlap > shorterDuration / 2;
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

/**
 * Netflix can roll a long subtitle through A -> A+B -> B while it remains one
 * spoken phrase. Return the accumulated line sequence when the two DOM states
 * overlap, otherwise signal that a genuinely new phrase started.
 */
function mergeRollingCueLines(
  accumulated: string[],
  visible: string[],
): string[] | null {
  const accumulatedText = compactCueLines(accumulated);
  const visibleText = compactCueLines(visible);
  if (!accumulatedText || !visibleText) return null;
  if (accumulatedText === visibleText) return accumulated;
  if (accumulatedText.includes(visibleText)) return accumulated;
  if (visibleText.includes(accumulatedText)) return visible;

  const maxOverlap = Math.min(accumulated.length, visible.length);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const accumulatedSuffix = accumulated.slice(-size);
    const visiblePrefix = visible.slice(0, size);
    if (accumulatedSuffix.every((line, index) => line === visiblePrefix[index])) {
      return [...accumulated, ...visible.slice(size)];
    }

    const visibleSuffix = visible.slice(-size);
    const accumulatedPrefix = accumulated.slice(0, size);
    if (visibleSuffix.every((line, index) => line === accumulatedPrefix[index])) {
      return [...visible, ...accumulated.slice(size)];
    }
  }

  return null;
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
  private readonly timedTextTracks = new Map<string, SubtitleCue[]>();
  private readonly timedTextBodies = new Map<string, Map<string, SubtitleCue[]>>();
  private localTranslationCues: SubtitleCue[] = [];
  private localTranslationOffset = 0;
  private localSubtitleLoadRevision = 0;
  private readonly japaneseCuesByText = new Map<string, SubtitleCue[]>();
  private readonly requestedTimedTextUrls = new Set<string>();
  private preferredSecondaryLanguage: SecondarySubtitleLanguage = "fr";
  private playbackSessionId: string;
  private playbackSessionGeneration = 0;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private timeupdateVideo: HTMLVideoElement | null = null;
  private readonly onTimeUpdate = () => this.emitCues();
  private readonly onSeeked = (event: Event) => {
    this.ensurePlaybackSession();
    const target = this.pendingSeekTarget;
    if (target === null) return;
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
      if (!watchId || !changes[localSubtitleStorageKey(watchId)]) return;
      void this.loadLocalTranslation();
    };
    chrome.storage.onChanged.addListener(this.storageListener);
    void this.loadLocalTranslation();
    this.requestCurrentEpisodeTimedText();

    // Primary path: observe Netflix's timed-text DOM container.
    this.attachTimedTextObserver();

    // Fallback path: standard <track> elements (some player variants expose
    // Japanese tracks through textTracks; duplicate emissions are absorbed
    // by the content script's cue-signature dedupe).
    const unsubTracks = this.subscribeTextTracks(cb);

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
    if (this.requestedTimedTextUrls.has(data.url)) return;
    this.requestedTimedTextUrls.add(data.url);
    const requestedGeneration = this.playbackSessionGeneration;
    const requestedEpisodeId = watchId ?? data.episodeId;
    const request: NetflixTimedTextUrlPayload = {
      url: data.url,
      language: data.language,
      episodeId: requestedEpisodeId,
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
          });
        }
      })
      .catch((error: unknown) => {
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

    // Audio replay deliberately seeks around the target. Feed those DOM
    // transitions only to the private replay observer: they must not mutate
    // the live cue or reach the overlay as freshly-created cues.
    if (this.cueReplaySession) {
      const targetText = this.cueReplaySession.targetText;
      const officialCue = targetText
        ? this.getMatchingTrackCue(targetText, observationTime)
        : null;
      this.cueReplaySession.observe(
        japaneseLines.map((line) => line.text),
        observationTime,
        officialCue,
      );
      return;
    }

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
      const destinationCue = this.landSeek(observationTime);
      if (destinationCue) {
        cb(this.composeCues([destinationCue]));
        return;
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

    const visibleLines = japaneseLines.map((line) => line.text);
    const text = visibleLines.join("\n");
    const mergedLines = this.activeDomCue
      ? mergeRollingCueLines(this.activeDomCue.text.split("\n"), visibleLines)
      : null;
    if (this.activeDomCue && mergedLines) {
      this.activeDomCue.text = mergedLines.join("\n");
      const trackCue = this.getMatchingTrackCue(
        this.activeDomCue.text,
        observationTime,
        this.activeDomCue.start,
      );
      if (trackCue) {
        this.activeDomCue.start = trackCue.start;
        this.activeDomCue.end = trackCue.end;
        this.activeDomCue.endConfirmed = true;
      }
      cb(this.composeCues([cueSnapshot(this.activeDomCue)]));
      return;
    }

    this.finalizeActiveDomCue(observationTime);
    const allStartsKnown = lines.every((line) => Number.isFinite(line.start));
    const allEndsKnown = lines.every((line) => Number.isFinite(line.end));
    const trackCue = this.getMatchingTrackCue(text, observationTime);
    const start = allStartsKnown
      ? Math.min(...lines.map((line) => line.start))
      : trackCue
        ? trackCue.start
      : Math.max(0, observationTime - FALLBACK_CUE_PREROLL_SECONDS);
    const endConfirmed = allEndsKnown || trackCue !== null;
    const end = endConfirmed
      ? allEndsKnown
        ? Math.max(...lines.map((line) => line.end))
        : (trackCue?.end ?? start)
      : start;
    const cue: ActiveDomCue = {
      id: `tt-${++this.nextDomCueId}`,
      start,
      end,
      endConfirmed,
      text,
      language: "ja",
    };
    this.activeDomCue = cue;
    this.pendingSeekTarget = null;
    console.log(`[SubJap] Netflix cue: ${lines.length} line(s)`);
    cb(this.composeCues([cueSnapshot(cue)]));
  }

  private composeCues(japanese: SubtitleCue[]): SubtitleCue[] {
    const visibleJapanese = japanese.filter((cue) => hasMeaningfulCueText(cue.text));
    const activeTrackCue = this.getActiveTrackCue("ja");
    const japaneseCues = visibleJapanese.length
      ? visibleJapanese
      : activeTrackCue && hasMeaningfulCueText(activeTrackCue.text)
        ? [activeTrackCue]
        : [];
    const translation = this.getActiveTranslationCue();
    return (translation ? [...japaneseCues, translation] : japaneseCues).map(cueSnapshot);
  }

  private getActiveTrackCue(language: string): SubtitleCue | null {
    return this.getTrackCueAt(language, this.getCurrentTime());
  }

  private getTrackCueAt(language: string, time: number): SubtitleCue | null {
    const cues = this.timedTextTracks.get(language) ?? [];
    return (
      cues.find((cue) => cue.start <= time && time < cue.end) ??
      null
    );
  }

  private getMatchingTrackCue(
    text: string,
    time: number,
    referenceStart: number | null = null,
  ): SubtitleCue | null {
    const compactText = compactCueText(text);
    const matching = this.japaneseCuesByText.get(compactText) ?? [];
    const active = matching.find(
      (cue) => cue.start <= time && time < cue.end,
    );
    if (active) return active;
    if (referenceStart === null || matching.length === 0) return null;

    // Netflix can keep a stale DOM cue visible just after the official cue's
    // end. When the text is the same, the nearest official start identifies
    // the same occurrence more reliably than the current media clock.
    return matching.reduce((nearest, cue) =>
      Math.abs(cue.start - referenceStart) <
      Math.abs(nearest.start - referenceStart)
        ? cue
        : nearest,
    );
  }

  private getActiveTranslationCue(): SubtitleCue | null {
    const currentTime = this.getCurrentTime();
    if (this.localTranslationCues.length > 0) {
      const localTime = currentTime - this.localTranslationOffset;
      return (
        this.localTranslationCues.find((cue) => cue.start <= localTime && localTime < cue.end) ??
        null
      );
    }
    const languagePriority: SecondarySubtitleLanguage[] =
      this.preferredSecondaryLanguage === "fr" ? ["fr", "en"] : ["en", "fr"];
    for (const language of languagePriority) {
      const cues = this.timedTextTracks.get(language) ?? [];
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

  private async loadLocalTranslation(): Promise<void> {
    const watchId = this.currentWatchId();
    const sessionId = this.playbackSessionId;
    const revision = ++this.localSubtitleLoadRevision;
    if (!watchId) {
      this.localTranslationCues = [];
      this.localTranslationOffset = 0;
      this.emitCues();
      return;
    }

    try {
      const record = await getLocalSubtitle(watchId);
      if (revision !== this.localSubtitleLoadRevision || sessionId !== this.playbackSessionId) {
        return;
      }
      this.localTranslationCues = record
        ? parseSubtitleFile(record.fileName, record.content).map((cue, index) => ({
            ...cue,
            id: `local-${index}-${cue.id}`,
            language: "local",
          }))
        : [];
      this.localTranslationOffset = record?.offsetSeconds ?? 0;
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
    const cues = parsedCues.map((cue, index) => ({
      ...cue,
      id: `netflix-${language}-${index}-${cue.id}`,
      language,
    }));
    const bodies = this.timedTextBodies.get(language) ?? new Map<string, SubtitleCue[]>();
    bodies.set(data.url, cues);
    this.timedTextBodies.set(language, bodies);
    this.rebuildTimedTextTrack(language);
    if (language === "ja") {
      this.japaneseCuesByText.clear();
      for (const cue of this.timedTextTracks.get("ja") ?? []) {
        const key = compactCueText(cue.text);
        const matches = this.japaneseCuesByText.get(key) ?? [];
        matches.push(cue);
        this.japaneseCuesByText.set(key, matches);
      }
    }
    this.emitCues();
  }

  private rebuildTimedTextTrack(language: string): void {
    const accepted: SubtitleCue[] = [];
    for (const body of this.timedTextBodies.get(language)?.values() ?? []) {
      // Cues within one body may intentionally overlap (for example, two
      // speakers). Only reject aliases already supplied by an earlier body.
      const earlierBodies = accepted.slice();
      for (const cue of body) {
        if (
          earlierBodies.some((acceptedCue) =>
            overlapsMostOfShorterCue(acceptedCue, cue),
          )
        ) {
          continue;
        }
        accepted.push(cue);
      }
    }
    this.timedTextTracks.set(language, accepted.sort((a, b) => a.start - b.start));
  }

  private landSeek(observationTime: number): SubtitleCue | null {
    this.pendingSeekTarget = null;
    this.clearSeekLandingTimer();
    this.activeDomCue = null;
    return this.getTrackCueAt("ja", observationTime);
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
    this.activeDomCue = null;
  }

  // -----------------------------------------------------------------------
  // textTracks fallback (rare on Netflix, kept for robustness)
  // -----------------------------------------------------------------------

  private subscribeTextTracks(cb: (cues: SubtitleCue[]) => void): () => void {
    const onCueChange = () => {
      const video = this.getVideoElement();
      if (!video) return;

      const cues: SubtitleCue[] = [];
      for (const track of video.textTracks) {
        // Look for the Japanese track (Netflix typically uses 'ja' or 'jpn').
        if (!track.language || !/^ja|jpn/i.test(track.language)) continue;
        if (track.mode !== 'showing') continue;

        const active = track.activeCues;
        if (!active) continue;
        for (let j = 0; j < active.length; j++) {
          const cue = active[j] as VTTCue;
          if (!hasMeaningfulCueText(cue.text)) continue;
          cues.push({
            id: cue.id || `${track.language}-${j}-${cue.startTime}`,
            start: cue.startTime,
            end: cue.endTime,
            text: cue.text,
            language: track.language,
          });
        }
      }
      cb(this.composeCues(cues));
    };

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
    // The track array is replaced when timed text is stored. Returning the
    // stable instance lets CueNavigator skip identical timeupdate snapshots.
    return this.timedTextTracks.get("ja") ?? [];
  }

  getNavigationSessionId(): string {
    this.ensurePlaybackSession();
    return `${this.playbackSessionId}:${this.playbackSessionGeneration}`;
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
    this.clearSeekLandingTimer();
    this.pendingSeekTarget = timeSeconds;
    return this.seekTransport.seek(timeSeconds, resume).then(
      (accepted) => {
        if (this.pendingSeekTarget !== timeSeconds) return accepted;
        if (accepted) {
          this.armSeekLandingTimeout(timeSeconds);
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
    this.timedTextTracks.clear();
    this.timedTextBodies.clear();
    this.localTranslationCues = [];
    this.localTranslationOffset = 0;
    this.japaneseCuesByText.clear();
    this.requestedTimedTextUrls.clear();
    this.cueReplaySession?.close();
    this.cueReplaySession = null;
    if (this.timeupdateVideo) {
      this.timeupdateVideo.removeEventListener("timeupdate", this.onTimeUpdate);
      this.timeupdateVideo.removeEventListener("seeked", this.onSeeked);
      this.timeupdateVideo = null;
    }
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
    this.timedTextTracks.clear();
    this.timedTextBodies.clear();
    this.japaneseCuesByText.clear();
    this.requestedTimedTextUrls.clear();
    this.cueReplaySession?.close();
    this.cueReplaySession = null;
    this.activeDomCue = null;
    this.pendingSeekTarget = null;
    this.clearSeekLandingTimer();
    this.pendingObservationTime = null;
    this.nextDomCueId = 0;
    void this.loadLocalTranslation();
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
        if (this.timeupdateVideo) {
          this.timeupdateVideo.removeEventListener("timeupdate", this.onTimeUpdate);
          this.timeupdateVideo.removeEventListener("seeked", this.onSeeked);
          this.timeupdateVideo = null;
        }
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

  private attachTimeUpdateListener(): void {
    const video = this.video;
    if (!video || this.timeupdateVideo === video) return;
    this.timeupdateVideo?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.timeupdateVideo?.removeEventListener("seeked", this.onSeeked);
    video.addEventListener("timeupdate", this.onTimeUpdate);
    video.addEventListener("seeked", this.onSeeked);
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
