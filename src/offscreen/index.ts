import { onMessage } from "@/core/messaging";

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let recording = false;
let recordedSamples: Float32Array[] = [];
let recordedLength = 0;

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
  // Audio only: while a tab's video is captured, Chrome confines HTML5
  // fullscreen to the tab ("fullscreen within tab"), so the player's
  // fullscreen button stops filling the screen. Nothing here uses the picture.
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
  processor.onaudioprocess = (event) => {
    if (!recording) return;
    const input = event.inputBuffer;
    const samples = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      let value = 0;
      for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
        value += input.getChannelData(channel)[i] ?? 0;
      }
      samples[i] = value / Math.max(input.numberOfChannels, 1);
    }
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
