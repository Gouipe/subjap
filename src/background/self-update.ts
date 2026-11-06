// ---------------------------------------------------------------------------
// SubJap — Update from the popup through the local updater
// ---------------------------------------------------------------------------
//
// The native messaging host (registered by scripts/register-native-host.ps1)
// runs scripts/update.ps1: git pull, dependencies when they changed, build.
// The service worker owns the port, which keeps it alive for the whole run
// even when the popup closes, then reloads the extension from the new dist/.

import { onMessage } from "@/core/messaging";
import {
  NATIVE_UPDATER_HOST,
  UPDATE_STATE_KEY,
  readUpdateState,
  type UpdateState,
  type UpdateStep,
} from "@/core/self-update";

const PROBE_TIMEOUT_MS = 5000;

type HostMessage =
  | { type: "pong" }
  | { type: "step"; step: UpdateStep }
  | { type: "done" }
  | { type: "error"; message: string };

let activePort: chrome.runtime.Port | null = null;

async function setState(state: UpdateState | null): Promise<void> {
  if (state === null) await chrome.storage.local.remove(UPDATE_STATE_KEY);
  else await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
}

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available: boolean, port?: chrome.runtime.Port): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port?.disconnect();
      resolve(available);
    };
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_UPDATER_HOST);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(false, port), PROBE_TIMEOUT_MS);
    port.onMessage.addListener((message: HostMessage) => {
      if (message.type === "pong") finish(true, port);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      finish(false);
    });
    port.postMessage({ type: "ping" });
  });
}

async function start(): Promise<void> {
  if (activePort) return;
  await setState({ status: "running", step: "pull", startedAt: Date.now() });

  let finished = false;
  const port = chrome.runtime.connectNative(NATIVE_UPDATER_HOST);
  activePort = port;

  port.onMessage.addListener((message: HostMessage) => {
    if (message.type === "step") {
      void setState({ status: "running", step: message.step, startedAt: Date.now() });
    } else if (message.type === "done") {
      finished = true;
      activePort = null;
      port.disconnect();
      // Cleared first: the reloaded worker would read a pending run as interrupted.
      void setState(null).finally(() => chrome.runtime.reload());
    } else if (message.type === "error") {
      finished = true;
      activePort = null;
      port.disconnect();
      void setState({ status: "error", message: message.message });
    }
  });

  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    activePort = null;
    if (finished) return;
    void setState({
      status: "error",
      message: reason
        ? `Le programme de mise à jour s’est arrêté : ${reason}`
        : "Le programme de mise à jour s’est arrêté avant la fin.",
    });
  });

  port.postMessage({ type: "update" });
}

export function registerSelfUpdate(): void {
  onMessage("update:probe", async () => ({ available: await probe() }));
  onMessage("update:start", () => {
    void start().catch((err: unknown) => {
      activePort = null;
      void setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    });
  });

  // A reload, manual or after a successful run, starts from a clean state.
  chrome.runtime.onInstalled.addListener(() => void setState(null));

  // The port lives in one service worker instance: a run recorded by a
  // previous instance can no longer report and is over.
  void chrome.storage.local.get(UPDATE_STATE_KEY).then((stored) => {
    if (readUpdateState(stored[UPDATE_STATE_KEY])?.status === "running" && !activePort) {
      void setState({
        status: "error",
        message: "La mise à jour a été interrompue avant la fin.",
      });
    }
  });
}
