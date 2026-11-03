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
interface RollingBlock {
  /** Wall-clock time of the block's last sample. */
  endMs: number;
  samples: Int16Array;
}
let rollingBlocks: RollingBlock[] = [];

function keepRollingBlock(samples: Float32Array, sampleRate: number): void {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const endMs = Date.now();
  rollingBlocks.push({ endMs, samples: pcm });
  const cutoff = endMs - ROLLING_BUFFER_MS;
  while (rollingBlocks.length > 0 && rollingBlocks[0]!.endMs - (rollingBlocks[0]!.samples.length / sampleRate) * 1000 < cutoff) {
    rollingBlocks.shift();
  }
}

/** Samples of one wall-clock interval, or null when the buffer does not cover it. */
function cutInterval({ fromMs, toMs }: WallInterval, sampleRate: number): Float32Array | null {
  if (toMs <= fromMs) return null;
  const output = new Float32Array(Math.max(1, Math.round(((toMs - fromMs) / 1000) * sampleRate)));
  let coveredFrom = Number.POSITIVE_INFINITY;
  let coveredTo = Number.NEGATIVE_INFINITY;
  for (const block of rollingBlocks) {
    const blockFrom = block.endMs - (block.samples.length / sampleRate) * 1000;
    const overlapFrom = Math.max(fromMs, blockFrom);
    const overlapTo = Math.min(toMs, block.endMs);
    if (overlapTo <= overlapFrom) continue;
    coveredFrom = Math.min(coveredFrom, overlapFrom);
    coveredTo = Math.max(coveredTo, overlapTo);
    const sourceStart = Math.max(0, Math.floor(((overlapFrom - blockFrom) / 1000) * sampleRate));
    const sourceEnd = Math.min(block.samples.length, Math.ceil(((overlapTo - blockFrom) / 1000) * sampleRate));
    const targetStart = Math.floor(((overlapFrom - fromMs) / 1000) * sampleRate);
    for (let i = sourceStart; i < sourceEnd && targetStart + i - sourceStart < output.length; i += 1) {
      output[targetStart + i - sourceStart] = block.samples[i]! / 0x8000;
    }
  }
  if (coveredFrom > fromMs + CUT_TOLERANCE_MS || coveredTo < toMs - CUT_TOLERANCE_MS) return null;
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
  rollingBlocks = [];
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
