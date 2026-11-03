import { onMessage } from "@/core/messaging";
import type { WallInterval } from "@/core/types";

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let recording = false;
let recordedSamples: Float32Array[] = [];
let recordedLength = 0;

/**
 * Rolling copy of the tab audio, stamped with the wall clock, so a phrase
 * already heard can be cut afterwards without seeking the player. Long enough
 * to cover a pause spent reading a definition before setting a word aside;
 * 16-bit samples keep five minutes around 30 MB.
 */
const ROLLING_BUFFER_MS = 5 * 60_000;
/** Accepted hole at either end of a cut, in ms. */
const CUT_TOLERANCE_MS = 200;
/**
 * Samples arriving this much later than their place in the stream means some
 * were lost: what follows starts a new segment with its own timing.
 */
const SEGMENT_BREAK_MS = 1_000;

/**
 * Blocks are laid end to end by sample count, never by their arrival time:
 * callbacks are late by a varying amount, and stamping each block on its own
 * left small holes and overlaps between them, heard as crackling.
 */
interface RollingBlock {
  segment: number;
  /** Position of the block's first sample in its segment. */
  startSample: number;
  samples: Int16Array;
  /** Wall time of the segment's first sample, as seen from this block's arrival. */
  originMs: number;
}
let rollingBlocks: RollingBlock[] = [];
let rollingSamples = 0;
let segment = 0;
let segmentSamples = 0;
let segmentOriginMs = Number.POSITIVE_INFINITY;

function resetRollingBuffer(): void {
  rollingBlocks = [];
  rollingSamples = 0;
  segment += 1;
  segmentSamples = 0;
  segmentOriginMs = Number.POSITIVE_INFINITY;
}

function keepRollingBlock(samples: Float32Array, sampleRate: number): void {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const now = Date.now();
  let originMs = now - ((segmentSamples + pcm.length) / sampleRate) * 1000;
  if (originMs > segmentOriginMs + SEGMENT_BREAK_MS) {
    segment += 1;
    segmentSamples = 0;
    segmentOriginMs = Number.POSITIVE_INFINITY;
    originMs = now - (pcm.length / sampleRate) * 1000;
  }
  segmentOriginMs = Math.min(segmentOriginMs, originMs);
  rollingBlocks.push({ segment, startSample: segmentSamples, samples: pcm, originMs });
  segmentSamples += pcm.length;
  rollingSamples += pcm.length;
  const maxSamples = (ROLLING_BUFFER_MS / 1000) * sampleRate;
  while (rollingBlocks.length > 1 && rollingSamples - rollingBlocks[0]!.samples.length >= maxSamples) {
    rollingSamples -= rollingBlocks.shift()!.samples.length;
  }
}

/** Samples of one wall-clock interval, or null when the buffer does not cover it. */
function cutInterval({ fromMs, toMs }: WallInterval, sampleRate: number): Float32Array | null {
  if (toMs <= fromMs) return null;
  const output = new Float32Array(Math.max(1, Math.round(((toMs - fromMs) / 1000) * sampleRate)));
  // The least late arrival of a segment gives its timing: callbacks are
  // only ever late. Kept blocks span five minutes, so clock drift is moot.
  const origins = new Map<number, number>();
  for (const block of rollingBlocks) {
    origins.set(block.segment, Math.min(origins.get(block.segment) ?? Number.POSITIVE_INFINITY, block.originMs));
  }
  let coveredFrom = Number.POSITIVE_INFINITY;
  let coveredTo = Number.NEGATIVE_INFINITY;
  for (const block of rollingBlocks) {
    // Whole-sample offset per segment: consecutive blocks stay contiguous.
    const offset = Math.round(((origins.get(block.segment)! - fromMs) / 1000) * sampleRate) + block.startSample;
    const from = Math.max(0, offset);
    const to = Math.min(output.length, offset + block.samples.length);
    if (to <= from) continue;
    for (let target = from; target < to; target += 1) {
      output[target] = block.samples[target - offset]! / 0x8000;
    }
    coveredFrom = Math.min(coveredFrom, from);
    coveredTo = Math.max(coveredTo, to);
  }
  const tolerance = (CUT_TOLERANCE_MS / 1000) * sampleRate;
  if (coveredFrom > tolerance || coveredTo < output.length - tolerance) return null;
  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeWavDataUrl(samples: Float32Array, sampleRate: number): string {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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

onMessage("tabCapture:offscreenStream", async ({ streamId }) => {
  stream?.getTracks().forEach((track) => track.stop());
  // Audio only: nothing here uses the picture. The capture still confines
  // HTML5 fullscreen to the tab; the service worker compensates for that.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });

  await context?.close().catch(() => undefined);
  context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  source.connect(context.destination);
  processor = context.createScriptProcessor(4096, 2, 1);
  resetRollingBuffer();
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    const samples = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      let value = 0;
      for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
        value += input.getChannelData(channel)[i] ?? 0;
      }
      samples[i] = value / Math.max(input.numberOfChannels, 1);
    }
    keepRollingBlock(samples, input.sampleRate);
    if (!recording) return;
    recordedSamples.push(samples);
    recordedLength += samples.length;
  };
  source.connect(processor);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  await context.resume();

  console.info("[SubJap] Offscreen tab audio routed", {
    audioTracks: stream.getAudioTracks().length,
    audioContextState: context.state,
  });
  return {};
});

onMessage("tabCapture:offscreenPhraseStart", () => {
  recordedSamples = [];
  recordedLength = 0;
  recording = true;
  return { ready: true };
});

onMessage("tabCapture:offscreenPhraseStop", () => {
  recording = false;
  if (!recordedLength || !context) return { dataUrl: null };

  const samples = new Float32Array(recordedLength);
  let offset = 0;
  for (const block of recordedSamples) {
    samples.set(block, offset);
    offset += block.length;
  }
  recordedSamples = [];
  recordedLength = 0;
  return { dataUrl: encodeWavDataUrl(samples, context.sampleRate) };
});

onMessage("tabCapture:offscreenCut", ({ intervals }) => {
  if (!context || intervals.length === 0) return { dataUrl: null };
  const sampleRate = context.sampleRate;
  const pieces: Float32Array[] = [];
  for (const interval of intervals) {
    const piece = cutInterval(interval, sampleRate);
    if (!piece) return { dataUrl: null };
    pieces.push(piece);
  }
  const samples = new Float32Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    samples.set(piece, offset);
    offset += piece.length;
  }
  return { dataUrl: encodeWavDataUrl(samples, sampleRate) };
});
