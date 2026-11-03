// ---------------------------------------------------------------------------
// SubJap — when each moment of the video was actually heard
// ---------------------------------------------------------------------------
//
// The offscreen document keeps the tab audio stamped with the wall clock.
// To cut a subtitle line from it afterwards, the video interval has to be
// mapped back to the wall-clock intervals during which it played: the learner
// may have paused in the middle of the line, or replayed it.

import type { WallInterval } from "@/core/types";

/** Playback is re-anchored at every timeupdate, so drift never accumulates. */
interface PlaybackRun {
  wallStart: number;
  videoStart: number;
  wallEnd: number;
  videoEnd: number;
}

/** Runs older than the offscreen buffer are useless. */
const HISTORY_MS = 6 * 60_000;
/** Gap tolerated between two runs stitched together, in video seconds. */
const STITCH_TOLERANCE_SECONDS = 0.05;

const BREAK_EVENTS = ["pause", "seeking", "waiting", "ratechange", "ended", "emptied"] as const;

export class PlaybackClock {
  private runs: PlaybackRun[] = [];
  private open: { wall: number; video: number } | null = null;
  private readonly onTick = (): void => this.tick();
  private readonly onBreak = (): void => this.closeRun();

  constructor(private readonly video: HTMLVideoElement) {
    video.addEventListener("playing", this.onTick);
    video.addEventListener("timeupdate", this.onTick);
    for (const type of BREAK_EVENTS) video.addEventListener(type, this.onBreak);
    this.tick();
  }

  destroy(): void {
    this.video.removeEventListener("playing", this.onTick);
    this.video.removeEventListener("timeupdate", this.onTick);
    for (const type of BREAK_EVENTS) this.video.removeEventListener(type, this.onBreak);
    this.runs = [];
    this.open = null;
  }

  /**
   * Wall-clock intervals during which `start`–`end` (video seconds) played,
   * in playback order, or null while part of it has not been heard yet.
   * The latest playback of each moment wins.
   */
  wallIntervalsFor(start: number, end: number): WallInterval[] | null {
    this.tick();
    if (end <= start) return null;
    const runs = [...this.runs];
    if (this.open) {
      runs.push({
        wallStart: this.open.wall,
        videoStart: this.open.video,
        wallEnd: Date.now(),
        videoEnd: this.video.currentTime,
      });
    }
    const intervals: WallInterval[] = [];
    let cursor = start;
    while (cursor < end - STITCH_TOLERANCE_SECONDS) {
      let run: PlaybackRun | undefined;
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const candidate = runs[i]!;
        if (candidate.videoStart <= cursor + STITCH_TOLERANCE_SECONDS && candidate.videoEnd > cursor) {
          run = candidate;
          break;
        }
      }
      if (!run) return null;
      const pieceStart = Math.max(cursor, run.videoStart);
      const pieceEnd = Math.min(end, run.videoEnd);
      const fromMs = toWall(run, pieceStart);
      const toMs = toWall(run, pieceEnd);
      const previous = intervals[intervals.length - 1];
      if (previous && Math.abs(previous.toMs - fromMs) < 30) previous.toMs = toMs;
      else intervals.push({ fromMs, toMs });
      cursor = pieceEnd;
    }
    return intervals;
  }

  private tick(): void {
    const video = this.video;
    if (video.paused || video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.closeRun();
      return;
    }
    const now = Date.now();
    const time = video.currentTime;
    if (this.open && time > this.open.video) {
      this.pushRun({ wallStart: this.open.wall, videoStart: this.open.video, wallEnd: now, videoEnd: time });
    }
    this.open = { wall: now, video: time };
  }

  /** Playback stops being continuous: keep what was heard up to now. */
  private closeRun(): void {
    const open = this.open;
    this.open = null;
    if (!open) return;
    const now = Date.now();
    // During a seek, currentTime is already the destination: extrapolate.
    const time = this.video.seeking
      ? open.video + ((now - open.wall) / 1000) * Math.max(this.video.playbackRate, 0.1)
      : this.video.currentTime;
    if (time > open.video) {
      this.pushRun({ wallStart: open.wall, videoStart: open.video, wallEnd: now, videoEnd: time });
    }
  }

  private pushRun(run: PlaybackRun): void {
    this.runs.push(run);
    const cutoff = Date.now() - HISTORY_MS;
    while (this.runs.length > 0 && this.runs[0]!.wallEnd < cutoff) this.runs.shift();
  }
}

function toWall(run: PlaybackRun, time: number): number {
  const ratio = (time - run.videoStart) / (run.videoEnd - run.videoStart);
  return run.wallStart + ratio * (run.wallEnd - run.wallStart);
}
