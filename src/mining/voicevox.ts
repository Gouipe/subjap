// ---------------------------------------------------------------------------
// SubJap — local VOICEVOX client
// ---------------------------------------------------------------------------

const VOICEVOX_URL = "http://127.0.0.1:50021";
const VOICEVOX_HOST = "com.subjap.voicevox";
const VOICEVOX_VERSION_URL = `${VOICEVOX_URL}/version`;
// Keep this configurable in one place until an Options control is needed.
const DEFAULT_SPEAKER_ID = 3;

interface NativeResponse {
  ok?: boolean;
  error?: string;
}

async function isVoicevoxReady(): Promise<boolean> {
  try {
    const response = await fetch(VOICEVOX_VERSION_URL, {
      method: "GET",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the local engine is available without needlessly invoking Chrome's
 * native-messaging bridge. The bridge is only needed when VOICEVOX is not
 * already running; this keeps a transient bridge error from blocking audio.
 */
export async function ensureVoicevoxProcess(): Promise<void> {
  if (await isVoicevoxReady()) return;

  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendNativeMessage(
      VOICEVOX_HOST,
      { action: "ensure-running" },
      (response: NativeResponse | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error ?? "VOICEVOX host failed"));
          return;
        }
        resolve();
      },
    );
  });
}

/** Best-effort startup hook; synthesis still retries on demand. */
export async function warmupVoicevox(): Promise<void> {
  await ensureVoicevoxProcess();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Start VOICEVOX if needed and synthesize a local WAV data URL. */
export async function synthesizeVoicevox(
  text: string,
  speaker = DEFAULT_SPEAKER_ID,
): Promise<string> {
  const normalized = text.trim();
  if (!normalized) throw new Error("Cannot synthesize empty text");

  await ensureVoicevoxProcess();
  const queryUrl = new URL("/audio_query", VOICEVOX_URL);
  queryUrl.searchParams.set("text", normalized);
  queryUrl.searchParams.set("speaker", String(speaker));
  const queryResponse = await fetch(queryUrl, { method: "POST" });
  if (!queryResponse.ok) {
    throw new Error(`VOICEVOX audio_query HTTP ${queryResponse.status}`);
  }

  const synthesisUrl = new URL("/synthesis", VOICEVOX_URL);
  synthesisUrl.searchParams.set("speaker", String(speaker));
  const synthesisResponse = await fetch(synthesisUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await queryResponse.json()),
  });
  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX synthesis HTTP ${synthesisResponse.status}`);
  }

  return `data:audio/wav;base64,${bytesToBase64(
    new Uint8Array(await synthesisResponse.arrayBuffer()),
  )}`;
}
