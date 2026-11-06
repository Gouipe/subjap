// ---------------------------------------------------------------------------
// Pause at the end of a hidden known sentence
// ---------------------------------------------------------------------------
//
// With « Phrases connues » hiding a sentence and « Pause à la fin » on, the
// video pauses just before the line ends, so the learner can check what they
// understood (X reveals) or listen again (S replays, then pauses again).

import { isDefaultIgnoredToken, isNonLexicalToken } from "@/core/frequency";
import type { SpanToken } from "@/core/types";

/** Sentences with at most this many meaningful words play through. */
export const TRIVIAL_SENTENCE_MAX_WORDS = 2;
/** Pause slightly before the line's end, while it is still displayed. */
const PAUSE_LEAD_SECONDS = 0.1;
/** A threshold passed by a larger jump (a seek, a throttled tab) does not pause. */
const MAX_CROSSING_SECONDS = 0.5;

/**
 * Words that carry meaning: interjections, fillers, particles, auxiliaries,
 * grammar-only expressions, punctuation and annotations do not count.
 */
export function meaningfulWordCount(spans: readonly SpanToken[]): number {
  return spans.filter(({ token, isParenthetical }) =>
    !isParenthetical &&
    !isNonLexicalToken(token) &&
    !isDefaultIgnoredToken(token) &&
    !token.partOfSpeech.includes("助詞") &&
    !token.partOfSpeech.includes("助動詞"),
  ).length;
}

/** Watches playback and pauses when it reaches the end returned by `pauseEnd`. */
export class HiddenSentenceAutoPause {
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  /** The current pause was made here, and playback has not resumed since. */
  private holding = false;

  /** `pauseEnd` returns the media time the displayed line ends at, or null for no pause. */
  constructor(private readonly pauseEnd: () => number | null) {}

  attach(video: HTMLVideoElement | null): void {
    if (video === this.video) return;
    this.detach();
    this.video = video;
    if (!video) return;
    video.addEventListener("play", this.onPlay);
    video.addEventListener("playing", this.onPlay);
    video.addEventListener("pause", this.onPause);
    video.addEventListener("seeking", this.onSeek);
    video.addEventListener("seeked", this.onSeek);
    if (!video.paused) this.start();
  }

  detach(): void {
    const video = this.video;
    if (video) {
      video.removeEventListener("play", this.onPlay);
      video.removeEventListener("playing", this.onPlay);
      video.removeEventListener("pause", this.onPause);
      video.removeEventListener("seeking", this.onSeek);
      video.removeEventListener("seeked", this.onSeek);
    }
    this.stop();
    this.video = null;
    this.holding = false;
  }

  /** The video is still paused by this feature: navigation should resume it. */
  isHolding(): boolean {
    return this.holding && this.video?.paused === true;
  }

  private readonly onPlay = (): void => {
    this.holding = false;
    this.start();
  };

  private readonly onPause = (): void => {
    this.stop();
  };

  /** A seek is a jump, never a crossing of the line's end. */
  private readonly onSeek = (): void => {
    this.lastTime = null;
  };

  private start(): void {
    if (this.rafId !== null) return;
    this.lastTime = null;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastTime = null;
  }

  private readonly tick = (): void => {
    this.rafId = null;
    const video = this.video;
    if (!video || video.paused) return;
    const now = video.currentTime;
    const previous = video.seeking ? null : this.lastTime;
    this.lastTime = video.seeking ? null : now;
    const end = previous === null ? null : this.pauseEnd();
    if (end !== null && previous !== null) {
      const threshold = end - PAUSE_LEAD_SECONDS;
      if (previous < threshold && now >= threshold && now - threshold <= MAX_CROSSING_SECONDS) {
        video.pause();
        this.holding = true;
        return;
      }
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}
