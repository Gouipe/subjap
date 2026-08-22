// Netflix L1 adapter – implements PlatformAdapter for the Netflix web player.
import type { PlatformId, PlatformAdapter, SubtitleCue, EpisodeContext } from "@/core/types";
import {
  NetflixSeekBridge,
  type NetflixSeekTransport,
} from "./netflix-seek-bridge";

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
  private cueCallback: ((cues: SubtitleCue[]) => void) | null = null;
  private trackUnsubscriber: (() => void) | null = null;
  private videoHuntTimer: ReturnType<typeof setInterval> | null = null;

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
    if (this.video && this.video.isConnected) return this.video;

    for (const sel of NETFLIX_VIDEO_SELECTORS) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLVideoElement) {
        this.video = el;
        this.installVideoObserver();
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
    };

    return this.trackUnsubscriber;
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
    if (this.videoHuntTimer !== null) {
      clearInterval(this.videoHuntTimer);
      this.videoHuntTimer = null;
    }
  }

  private scheduleEmit(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.emitCues();
    }, EMIT_DEBOUNCE_MS);
  }

  private emitCues(): void {
    const cb = this.cueCallback;
    if (!cb) return;

    // getVideoElement() also drives video discovery (see videoHuntTimer); the
    // overlay renderer still needs the video, but we can read cue text without
    // it, so don't gate emission on its presence.
    const video = this.getVideoElement();
    const container = this.timedtext ?? this.findTimedTextContainer();
    const cues: SubtitleCue[] = [];

    if (container) {
      let lineEls = Array.from(
        container.querySelectorAll<HTMLElement>(NETFLIX_TIMEDTEXT_LINE_SELECTOR),
      );
      // Fallback if Netflix renames the line class: use direct children.
      if (lineEls.length === 0) {
        lineEls = Array.from(container.children).filter(
          (el): el is HTMLElement => el instanceof HTMLElement,
        );
      }

      const fallbackTime = video?.currentTime ?? 0;
      let idx = 0;
      for (const line of lineEls) {
        const text = line.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (!text) continue;

        // Netflix sometimes carries per-line timings on data-* attributes.
        const startAttr =
          line.getAttribute('data-start') ??
          line.querySelector('span')?.getAttribute('data-start');
        const endAttr =
          line.getAttribute('data-end') ??
          line.querySelector('span')?.getAttribute('data-end');
        const start = startAttr ? Number.parseFloat(startAttr) : NaN;
        const end = endAttr ? Number.parseFloat(endAttr) : NaN;

        cues.push({
          id: `tt-${idx++}-${startAttr ?? fallbackTime}`,
          start: Number.isFinite(start) ? start : fallbackTime,
          end: Number.isFinite(end) ? end : fallbackTime + 2,
          text,
          language: 'ja',
        });
      }
    }

    if (cues.length > 0) {
      console.log(`[SubJap] Netflix cues: ${cues.length} line(s)`);
    }
    cb(cues);
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
          cues.push({
            id: cue.id || `${track.language}-${j}-${cue.startTime}`,
            start: cue.startTime,
            end: cue.endTime,
            text: cue.text,
            language: track.language,
          });
        }
      }
      cb(cues);
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

  getPlaybackRate(): number {
    return this.getVideoElement()?.playbackRate ?? 1;
  }

  seekTo(timeSeconds: number, resume: boolean): Promise<boolean> {
    return this.seekTransport.seek(timeSeconds, resume);
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
  }

  // -----------------------------------------------------------------------
  // MutationObserver – detect when the video element appears (SPA nav)
  // -----------------------------------------------------------------------
  private installVideoObserver(): void {
    if (this.videoObserver) return;

    this.videoObserver = new MutationObserver(() => {
      if (!this.video?.isConnected) {
        this.video = null;
        // Try to re-discover the video.
        for (const sel of NETFLIX_VIDEO_SELECTORS) {
          const el = document.querySelector(sel);
          if (el instanceof HTMLVideoElement) {
            this.video = el;
            return;
          }
        }
      }
    });

    this.videoObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}
