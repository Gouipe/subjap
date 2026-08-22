import { onMessage } from "@/core/messaging";

let stream: MediaStream | null = null;
let context: AudioContext | null = null;

onMessage("tabCapture:offscreenStream", async ({ streamId }) => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
    video: {
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
  await context.resume();

  console.info("[SubJap] Offscreen tab audio routed", {
    audioTracks: stream.getAudioTracks().length,
    audioContextState: context.state,
  });
  return {};
});
