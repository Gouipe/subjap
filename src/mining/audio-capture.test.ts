import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));

vi.mock("@/core/messaging", () => ({ sendMessage: sendMessageMock }));

import { encodeWavDataUrl, VideoAudioCapture } from "@/mining/audio-capture";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe("encodeWavDataUrl", () => {
  it("creates a mono PCM WAV suitable for Anki media", () => {
    const bytes = decodeDataUrl(encodeWavDataUrl(new Float32Array([0, -1, 1]), 8000));
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(bytes.length).toBe(50);
  });
});

describe("VideoAudioCapture", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "tabCapture:phraseStop") {
        return Promise.resolve({ dataUrl: "data:audio/webm;base64,phrase" });
      }
      return Promise.resolve({ ready: true });
    });
  });

  it("records an open Netflix cue until the adapter confirms its real end", async () => {
    const video = document.createElement("video");
    let currentTime = 10;
    let paused = true;
    Object.defineProperties(video, {
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value;
        },
      },
      paused: { configurable: true, get: () => paused },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    video.pause = () => {
      paused = true;
    };

    const cue = {
      id: "open-cue",
      start: 1,
      end: 1,
      endConfirmed: false,
      text: "長い字幕",
      language: "ja",
    };
    const seekTo = vi.fn((time: number, resume: boolean) => {
      currentTime = time;
      paused = !resume;
      if (resume && time === cue.start) {
        setTimeout(() => {
          cue.end = 5;
          cue.endConfirmed = true;
          currentTime = 5.4;
        }, 10);
      }
      return Promise.resolve(true);
    });
    const capture = new VideoAudioCapture(video, seekTo);

    await expect(capture.captureCue(cue)).resolves.toBe(
      "data:audio/webm;base64,phrase",
    );
    expect(seekTo).toHaveBeenNthCalledWith(1, 1, false);
    expect(seekTo).toHaveBeenNthCalledWith(2, 1, true);
    expect(seekTo).toHaveBeenLastCalledWith(10, false);
    expect(currentTime).toBe(10);
    expect(paused).toBe(true);
  });

  it("attend que le seek Netflix atteigne réellement le début avant d'enregistrer", async () => {
    const video = document.createElement("video");
    let currentTime = 8;
    let paused = true;
    Object.defineProperties(video, {
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value;
        },
      },
      paused: { configurable: true, get: () => paused },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    video.pause = () => {
      paused = true;
    };

    const messageTimes: Array<{ type: string; time: number }> = [];
    sendMessageMock.mockImplementation((type: string) => {
      messageTimes.push({ type, time: currentTime });
      if (type === "tabCapture:phraseStop") {
        return Promise.resolve({ dataUrl: "data:audio/webm;base64,complete" });
      }
      return Promise.resolve({ ready: true });
    });

    const seekTo = vi.fn((time: number, resume: boolean) => {
      if (time === 1 && !resume) {
        // The bridge acknowledges immediately, but Netflix applies the seek
        // asynchronously while currentTime is still in the second half.
        setTimeout(() => {
          currentTime = 1;
          paused = true;
        }, 30);
      } else if (time === 1 && resume) {
        paused = false;
        setTimeout(() => {
          currentTime = 4.4;
        }, 30);
      } else {
        currentTime = time;
        paused = !resume;
      }
      return Promise.resolve(true);
    });
    const capture = new VideoAudioCapture(video, seekTo);

    await expect(capture.capturePhrase(1, 4)).resolves.toBe(
      "data:audio/webm;base64,complete",
    );

    expect(messageTimes.find(({ type }) => type === "tabCapture:phraseStart")?.time)
      .toBeCloseTo(1, 1);
    expect(messageTimes.find(({ type }) => type === "tabCapture:phraseStop")?.time)
      .toBeGreaterThanOrEqual(4.3);
    expect(seekTo).toHaveBeenLastCalledWith(8, false);
  });

  it("sérialise deux captures pour qu'elles ne réinitialisent pas le même enregistreur", async () => {
    const video = document.createElement("video");
    let currentTime = 10;
    let paused = true;
    Object.defineProperties(video, {
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value;
        },
      },
      paused: { configurable: true, get: () => paused },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    video.pause = () => {
      paused = true;
    };

    const recorderEvents: string[] = [];
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "tabCapture:phraseStart") recorderEvents.push("start");
      if (type === "tabCapture:phraseStop") {
        recorderEvents.push("stop");
        return Promise.resolve({ dataUrl: "data:audio/webm;base64,phrase" });
      }
      return Promise.resolve({ ready: true });
    });
    const seekTo = vi.fn((time: number, resume: boolean) => {
      currentTime = time;
      paused = !resume;
      if (resume) {
        setTimeout(() => {
          currentTime = time + 2.4;
        }, 10);
      }
      return Promise.resolve(true);
    });
    const capture = new VideoAudioCapture(video, seekTo);

    await Promise.all([
      capture.capturePhrase(1, 3),
      capture.capturePhrase(5, 7),
    ]);

    expect(recorderEvents).toEqual(["start", "stop", "start", "stop"]);
  });
});
