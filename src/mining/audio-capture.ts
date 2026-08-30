// ---------------------------------------------------------------------------
// SubJap — real video audio capture
// ---------------------------------------------------------------------------

import { sendMessage } from "@/core/messaging";
import type { SubtitleCue } from "@/core/types";

const BUFFER_SECONDS = 90;
const PROCESSOR_BUFFER_SIZE = 4096;
const PHRASE_CAPTURE_SETTLE_MS = 250;
const PHRASE_CAPTURE_TIMEOUT_MS = 20000;
const PHRASE_SEEK_TIMEOUT_MS = 5000;
const PHRASE_SEEK_TOLERANCE_SECONDS = 0.2;

interface AudioBlock {
  startVideoTime: number;
  sampleRate: number;
  samples: Float32Array;
}

interface CaptureVideo extends HTMLVideoElement {
  captureStream?: () => MediaStream;
}

/** Encode mono float samples as a small PCM WAV data URL. */
export function encodeWavDataUrl(samples: Float32Array, sampleRate: number): string {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Keeps a rolling PCM buffer from a video element and can cut subtitle-sized
 * clips without seeking or interrupting playback.
 */
export class VideoAudioCapture {
  private readonly video: CaptureVideo;
  private readonly seekTo: ((timeSeconds: number, resume: boolean) => Promise<boolean>) | null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: AudioNode | null = null;
  private silentGain: GainNode | null = null;
  private blocks: AudioBlock[] = [];
  private sampleRate = 44100;
  private running = false;
  private tabVideo: HTMLVideoElement | null = null;
  private tabStream: MediaStream | null = null;
  private tabCapturePromise: Promise<void> | null = null;
  private phraseCaptureQueue: Promise<void> = Promise.resolve();

  constructor(
    video: HTMLVideoElement,
    seekTo: ((timeSeconds: number, resume: boolean) => Promise<boolean>) | null = null,
  ) {
    this.video = video as CaptureVideo;
    this.seekTo = seekTo;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext unavailable");

      const context = new AudioContextCtor();
      this.context = context;
      this.sampleRate = context.sampleRate;

      const captureStream = this.video.captureStream?.();
      if (captureStream?.getAudioTracks().length) {
        this.source = context.createMediaStreamSource(captureStream);
      } else {
        // Fallback for browsers where captureStream is unavailable. This may
        // be rejected by DRM-protected players; the caller then keeps the
        // AudioPhrase field empty instead of bypassing the platform.
        this.source = context.createMediaElementSource(this.video);
        this.source.connect(context.destination);
      }

      const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 2, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      this.processor = processor;
      this.silentGain = silentGain;

      processor.onaudioprocess = (event) => this.collect(event);
      this.source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      void context.resume().catch(() => undefined);
    } catch (err) {
      this.running = false;
      this.destroy();
      console.warn("[SubJap] Real audio capture unavailable:", err);
    }
  }

  /** Resume capture from a user gesture after autoplay policy suspension. */
  resume(): void {
    void this.context?.resume().catch(() => undefined);
  }

  /**
   * Try to capture the rendered tab. Netflix's DRM player may reject direct
   * media-element capture, while tabCapture can expose the compositor output.
   */
  startTabCapture(streamId?: string): Promise<void> {
    if (this.tabVideo) return Promise.resolve();
    if (this.tabCapturePromise) return this.tabCapturePromise;

    console.info("[SubJap] Requesting rendered tab capture");
    this.tabCapturePromise = this.initializeTabCapture(streamId).finally(() => {
      this.tabCapturePromise = null;
    });
    return this.tabCapturePromise;
  }

  async getTabVideo(): Promise<HTMLVideoElement | null> {
    if (this.tabCapturePromise) await this.tabCapturePromise;
    return this.tabVideo;
  }

  /** Cut a subtitle interval with a small leading/trailing margin. */
  captureSegment(start: number, end: number, marginSeconds = 0.3): string | undefined {
    if (!this.blocks.length || end <= start) return undefined;

    const from = Math.max(0, start - marginSeconds);
    const to = end + marginSeconds;
    const sampleRate = this.sampleRate;
    const output = new Float32Array(Math.max(1, Math.round((to - from) * sampleRate)));
    let coveredFrom = Number.POSITIVE_INFINITY;
    let coveredTo = Number.NEGATIVE_INFINITY;

    for (const block of this.blocks) {
      const blockFrom = block.startVideoTime;
      const blockTo = blockFrom + block.samples.length / sampleRate;
      const overlapFrom = Math.max(from, blockFrom);
      const overlapTo = Math.min(to, blockTo);
      if (overlapTo <= overlapFrom) continue;

      coveredFrom = Math.min(coveredFrom, overlapFrom);
      coveredTo = Math.max(coveredTo, overlapTo);
      const sourceStart = Math.max(0, Math.floor((overlapFrom - blockFrom) * sampleRate));
      const sourceEnd = Math.min(
        block.samples.length,
        Math.ceil((overlapTo - blockFrom) * sampleRate),
      );
      const targetStart = Math.max(0, Math.floor((blockFrom - from) * sampleRate) + sourceStart);
      output.set(
        block.samples.subarray(sourceStart, sourceEnd),
        Math.min(targetStart, output.length),
      );
    }

    // The beginning may not be available if capture started after the cue.
    // Returning undefined lets the caller keep a valid card without a bad
    // or truncated audio file.
    if (coveredFrom > from + 0.2 || coveredTo < to - 0.2) return undefined;
    return encodeWavDataUrl(output, sampleRate);
  }

  /**
   * Capture a phrase even when the learner mined it while Netflix was paused.
   * The tab stream only contains audio while the tab is playing, so briefly
   * replay the subtitle interval and restore the original playback state.
   */
  async capturePhrase(start: number, end: number, marginSeconds = 0.3): Promise<string | undefined> {
    if (end <= start) return undefined;

    return this.enqueuePhraseCapture(() =>
      this.capturePhraseWithEnd(start, end, marginSeconds),
    );
  }

  /** Capture a cue whose DOM-derived end may only become known during replay. */
  async captureCue(cue: SubtitleCue, marginSeconds = 0.3): Promise<string | undefined> {
    if (cue.endConfirmed !== false) {
      return this.capturePhrase(cue.start, cue.end, marginSeconds);
    }
    if (!this.seekTo) return undefined;

    return this.enqueuePhraseCapture(() =>
      this.capturePhraseWithEnd(
        cue.start,
        cue.end,
        marginSeconds,
        async () => {
          const deadline = performance.now() + PHRASE_CAPTURE_TIMEOUT_MS;
          while (cue.endConfirmed === false) {
            if (performance.now() >= deadline) {
              throw new Error("Timed out waiting for the Netflix cue boundary");
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return cue.end;
        },
      ),
    );
  }

  private enqueuePhraseCapture(
    capture: () => Promise<string | undefined>,
  ): Promise<string | undefined> {
    const result = this.phraseCaptureQueue.then(capture, capture);
    this.phraseCaptureQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async capturePhraseWithEnd(
    start: number,
    initialEnd: number,
    marginSeconds: number,
    resolveEnd?: () => Promise<number>,
  ): Promise<string | undefined> {
    if (!resolveEnd && initialEnd <= start) return undefined;

    const from = Math.max(0, start - marginSeconds);
    const to = initialEnd + marginSeconds;
    const initialTime = this.video.currentTime;
    const initialPaused = this.video.paused;
    const initialRate = this.video.playbackRate;

    let offscreenRecording = false;
    let offscreenStartPromise: Promise<void> | null = null;
    const startOffscreenRecording = async (): Promise<void> => {
      try {
        await sendMessage("tabCapture:phraseStart", {});
        offscreenRecording = true;
      } catch (err) {
        console.info("[SubJap] Offscreen phrase capture unavailable; using tab buffer:", err);
      }
    };
    try {
      let resolvedEnd = initialEnd;
      if (this.seekTo) {
        // Netflix's player transport can seek without replacing the DRM video
        // element. Prepare the leading margin while paused, then start the
        // recorder before asking the player to resume from that position.
        this.video.pause();
        const seekOk = await this.seekTo(from, false);
        if (!seekOk) throw new Error("Netflix seek bridge refused phrase start");
        // The page-world bridge acknowledges that it invoked Netflix's API;
        // the media element can still be several seconds ahead until the seek
        // actually lands. Recording before this point produced random halves.
        await this.waitForSeekPosition(from);
        await startOffscreenRecording();
        const playOk = await this.seekTo(from, true);
        if (!playOk) throw new Error("Netflix seek bridge refused phrase playback");
        if (resolveEnd) resolvedEnd = await resolveEnd();
      } else {
        offscreenStartPromise = startOffscreenRecording();
        this.video.currentTime = from;
        // Start playback immediately so a mining click can authorize it. The
        // seek may interrupt this first attempt; after `seeked`, retry below.
        const initialPlay = this.video.play().catch(() => undefined);
        await this.waitForVideoSeek(from);
        await initialPlay;
        if (this.video.paused) await this.video.play();
        await offscreenStartPromise;
      }
      if (resolvedEnd <= start) throw new Error("Invalid phrase cue boundary");
      await this.waitForVideoTime(
        this.seekTo ? resolvedEnd + marginSeconds : to,
      );
      if (this.seekTo) this.video.pause();
      await new Promise((resolve) => setTimeout(resolve, PHRASE_CAPTURE_SETTLE_MS));
      if (offscreenRecording) {
        const { dataUrl } = await sendMessage("tabCapture:phraseStop", {});
        offscreenRecording = false;
        if (dataUrl) return dataUrl;
      }
      return this.captureSegment(start, resolvedEnd, marginSeconds);
    } catch (err) {
      console.warn("[SubJap] Phrase audio replay unavailable:", err);
      return undefined;
    } finally {
      if (offscreenRecording) {
        void sendMessage("tabCapture:phraseStop", {}).catch(() => undefined);
      }
      this.video.playbackRate = initialRate;
      if (this.seekTo) {
        await this.seekTo(initialTime, !initialPaused);
      } else {
        this.video.currentTime = initialTime;
        if (initialPaused) {
          this.video.pause();
        } else {
          void this.video.play().catch(() => undefined);
        }
      }
    }
  }

  destroy(): void {
    if (this.processor) this.processor.disconnect();
    if (this.source) this.source.disconnect();
    if (this.silentGain) this.silentGain.disconnect();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    const context = this.context;
    this.context = null;
    this.blocks = [];
    this.running = false;
    if (context) void context.close().catch(() => undefined);
    this.tabStream?.getTracks().forEach((track) => track.stop());
    this.tabStream = null;
    this.tabVideo?.remove();
    this.tabVideo = null;
  }

  private async initializeTabCapture(streamId?: string): Promise<void> {
    try {
      const captureId = streamId ?? (await sendMessage("tabCapture:streamId", {})).streamId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: captureId,
          },
        } as MediaTrackConstraints,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: captureId,
          },
        } as MediaTrackConstraints,
      });

      const tabVideo = document.createElement("video");
      tabVideo.muted = true;
      tabVideo.playsInline = true;
      tabVideo.srcObject = stream;
      tabVideo.style.position = "fixed";
      tabVideo.style.width = "1px";
      tabVideo.style.height = "1px";
      tabVideo.style.opacity = "0";
      tabVideo.style.pointerEvents = "none";
      document.body.appendChild(tabVideo);
      await tabVideo.play();

      this.destroy();
      this.tabStream = stream;
      this.tabVideo = tabVideo;
      this.startAudioGraph(new AudioContext(), stream);
      console.info("[SubJap] Tab media capture ready", {
        audioTracks: stream.getAudioTracks().length,
        audioContextState: this.context?.state,
      });
    } catch (err) {
      console.warn("[SubJap] Tab media capture unavailable:", err);
    }
  }

  private startAudioGraph(context: AudioContext, stream: MediaStream): void {
    this.context = context;
    this.sampleRate = context.sampleRate;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 2, 1);
    const silentGain = context.createGain();
    // tabCapture mutes the original tab output. Route the raw captured audio
    // directly back to the speakers; the ScriptProcessor is only for copying
    // samples into the rolling phrase buffer and does not fill its output.
    silentGain.gain.value = 0;
    this.source = source;
    this.processor = processor;
    this.silentGain = silentGain;
    processor.onaudioprocess = (event) => this.collect(event);
    source.connect(context.destination);
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    this.running = true;
    void context.resume().catch(() => undefined);
  }

  private collect(event: AudioProcessingEvent): void {
    if (this.video.paused || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const input = event.inputBuffer;
    const frames = input.length;
    const channels = input.numberOfChannels;
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      let value = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        value += input.getChannelData(channel)[i] ?? 0;
      }
      samples[i] = value / Math.max(channels, 1);
    }

    const playbackRate = Math.max(this.video.playbackRate, 0.1);
    const endVideoTime = this.video.currentTime;
    const startVideoTime = endVideoTime - (frames / this.sampleRate) * playbackRate;
    this.blocks.push({ startVideoTime, sampleRate: this.sampleRate, samples });

    const cutoff = endVideoTime - BUFFER_SECONDS;
    this.blocks = this.blocks.filter(
      (block) => block.startVideoTime + block.samples.length / this.sampleRate >= cutoff,
    );
  }

  private async waitForVideoTime(target: number): Promise<void> {
    const deadline = performance.now() + PHRASE_CAPTURE_TIMEOUT_MS;
    while (this.video.currentTime < target) {
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for Netflix playback at ${target.toFixed(2)}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async waitForSeekPosition(target: number): Promise<void> {
    const deadline = performance.now() + PHRASE_SEEK_TIMEOUT_MS;
    while (
      Math.abs(this.video.currentTime - target) >
      PHRASE_SEEK_TOLERANCE_SECONDS
    ) {
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for Netflix seek to ${target.toFixed(2)}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async waitForVideoSeek(target: number): Promise<void> {
    if (Math.abs(this.video.currentTime - target) < 0.05) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.video.removeEventListener("seeked", onSeeked);
        reject(new Error(`Timed out waiting for Netflix seek to ${target.toFixed(2)}s`));
      }, 5000);
      const onSeeked = (): void => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.video.addEventListener("seeked", onSeeked, { once: true });
    });
  }
}
