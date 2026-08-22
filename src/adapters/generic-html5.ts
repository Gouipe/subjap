// Generic HTML5 adapter – PlatformAdapter fallback for any <video> with TextTracks.
import type { PlatformId, PlatformAdapter, SubtitleCue, EpisodeContext } from "@/core/types";

// ---------------------------------------------------------------------------
// Generic HTML5 adapter
// ---------------------------------------------------------------------------

function findBestVideo(): HTMLVideoElement | null {
  const videos = document.querySelectorAll<HTMLVideoElement>('video');
  // Prefer a video that already has text tracks.
  for (const video of videos) {
    if (video.textTracks && video.textTracks.length > 0) {
      return video;
    }
  }
  // Fall back to the first video on the page.
  return videos[0] ?? null;
}

export class GenericHtml5Adapter implements PlatformAdapter {
  id: PlatformId = 'generic-html5';

  private video: HTMLVideoElement | null = null;
  private cueUnsubscriber: (() => void) | null = null;

  // -----------------------------------------------------------------------
  // isActive
  // -----------------------------------------------------------------------
  isActive(doc: Document, _url: string): boolean {
    const videos = doc.querySelectorAll<HTMLVideoElement>('video');
    for (const video of videos) {
      if (video.textTracks && video.textTracks.length > 0) {
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // getVideoElement
  // -----------------------------------------------------------------------
  getVideoElement(): HTMLVideoElement | null {
    if (this.video && this.video.isConnected) return this.video;
    this.video = findBestVideo();
    return this.video;
  }

  // -----------------------------------------------------------------------
  // subscribeCues
  // -----------------------------------------------------------------------
  subscribeCues(cb: (cues: SubtitleCue[]) => void): () => void {
    const onCueChange = () => {
      const video = this.getVideoElement();
      if (!video) return;

      const cues: SubtitleCue[] = [];
      for (const track of video.textTracks) {
        if (track.mode !== 'showing') continue;

        const active = track.activeCues;
        if (!active) continue;
        for (let j = 0; j < active.length; j++) {
          const cue = active[j] as VTTCue;
          cues.push({
            id: cue.id || `${track.language ?? "sub"}-${j}-${cue.startTime}`,
            start: cue.startTime,
            end: cue.endTime,
            text: cue.text,
            language: track.language || undefined,
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

    this.cueUnsubscriber = () => {
      video.removeEventListener('cuechange', onCueChange);
      video.removeEventListener('addtrack', onAddTrack);
      for (const track of video.textTracks) {
        track.removeEventListener('cuechange', onCueChange);
      }
    };

    return this.cueUnsubscriber;
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

  seekTo(timeSeconds: number, resume: boolean): Promise<boolean> {
    const video = this.getVideoElement();
    if (!video || !Number.isFinite(timeSeconds)) return Promise.resolve(false);

    video.currentTime = Math.max(0, timeSeconds);
    if (resume) {
      void video.play().catch(() => {
        // Autoplay policy may reject play(); the seek itself still succeeded.
      });
    }
    return Promise.resolve(true);
  }

  // -----------------------------------------------------------------------
  // setNativeSubtitlesVisible
  // -----------------------------------------------------------------------
  setNativeSubtitlesVisible(v: boolean): void {
    const video = this.getVideoElement();
    if (!video) return;
    for (const track of video.textTracks) {
      track.mode = v ? 'showing' : 'hidden';
    }
  }

  // -----------------------------------------------------------------------
  // getEpisodeContext
  // -----------------------------------------------------------------------
  getEpisodeContext(): EpisodeContext | null {
    const doc = document;

    // og:title meta takes priority over document.title.
    const ogTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const title =
      ogTitle?.content?.trim() ??
      doc.title.trim() ??
      lastPathSegment(location.pathname) ??
      'Unknown';

    const lang = doc.documentElement.lang || 'ja';

    return {
      platform: 'generic-html5',
      title,
      language: lang,
      url: location.href,
    };
  }

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------
  destroy(): void {
    this.cueUnsubscriber?.();
    this.cueUnsubscriber = null;
    this.video = null;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function lastPathSegment(path: string): string {
  // "/path/to/page"  →  "page"
  const segs = path.replace(/\/+$/, '').split('/');
  return segs[segs.length - 1] || '';
}
