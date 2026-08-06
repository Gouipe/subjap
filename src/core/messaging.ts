// ---------------------------------------------------------------------------
// SubJap — Typed MV3 messaging bus
// ---------------------------------------------------------------------------
//
// Handlers that reject asynchronously cannot propagate the error through
// chrome.runtime.sendMessage directly (the promise would resolve with
// `undefined`). We wrap failures in an `__subjapError` marker so callers get
// a thrown Error instead of a nullish response that crashes on `.field`.

import type {
  MessageType,
  MessagePayload,
  MessageResult,
} from "@/core/types";

const ERROR_KEY = "__subjapError";

function isErrorMarker(value: unknown): value is { [ERROR_KEY]: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ERROR_KEY in value &&
    typeof (value as Record<string, unknown>)[ERROR_KEY] === "string"
  );
}

/**
 * Send a typed message to the extension runtime.
 * Resolves with the typed result, or rejects when the handler failed.
 */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: MessagePayload<T>,
): Promise<MessageResult<T>> {
  // chrome.runtime.sendMessage with the { type, ...payload } envelope
  // (`chrome.runtime.sendMessage` is typed `any` — pin it to `unknown`).
  const response: unknown = await chrome.runtime.sendMessage({
    type,
    ...(payload as Record<string, unknown>),
  });

  if (isErrorMarker(response)) {
    throw new Error(response[ERROR_KEY]);
  }

  return response as MessageResult<T>;
}

/**
 * Register a typed message listener.
 * Only fires for messages matching `type` — returns the typed result.
 */
export function onMessage<T extends MessageType>(
  type: T,
  handler: (
    payload: MessagePayload<T>,
    sender: chrome.runtime.MessageSender,
  ) => MessageResult<T> | Promise<MessageResult<T>>,
): void {
  chrome.runtime.onMessage.addListener(
    (
      message: { type: MessageType } & Record<string, unknown>,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (message.type !== type) return;

      const { type: _type, ...rest } = message;
      const payload = rest as unknown as MessagePayload<T>;

      const result = handler(payload, sender);

      if (result instanceof Promise) {
        result
          .then((val) => sendResponse(val))
          .catch((err) => {
            console.error(`[SubJap] Handler error for ${String(type)}:`, err);
            const message =
              err instanceof Error ? err.message : String(err);
            sendResponse({ [ERROR_KEY]: message });
          });
        return true; // keep channel open for async response
      }

      sendResponse(result);
      return undefined; // synchronous response, no need to keep channel open
    },
  );
}
