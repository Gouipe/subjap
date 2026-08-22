import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureVoicevoxProcess, synthesizeVoicevox } from "./voicevox";

describe("VOICEVOX client", () => {
  const nativeMessage = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    nativeMessage.mockClear();
    nativeMessage.mockImplementation(
      (_host: string, _payload: unknown, callback: (response: unknown) => void) =>
        callback({ ok: true }),
    );
    fetchMock.mockReset();
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendNativeMessage: nativeMessage,
      },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not use native messaging when VOICEVOX is already ready", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await ensureVoicevoxProcess();

    expect(nativeMessage).not.toHaveBeenCalled();
  });

  it("starts VOICEVOX through native messaging when the API is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await ensureVoicevoxProcess();

    expect(nativeMessage).toHaveBeenCalledWith(
      "com.subjap.voicevox",
      { action: "ensure-running" },
      expect.any(Function),
    );
  });

  it("synthesizes audio after checking the local engine", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([82, 73, 70, 70]).buffer),
      });

    const dataUrl = await synthesizeVoicevox("うそ");

    expect(nativeMessage).not.toHaveBeenCalled();
    expect(dataUrl).toMatch(/^data:audio\/wav;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
