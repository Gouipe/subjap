// ---------------------------------------------------------------------------
// SubJap — video frame capture via the visible browser tab
// ---------------------------------------------------------------------------

import { sendMessage } from "@/core/messaging";

/**
 * Capture a frame from a video element and return it as a JPEG data URL.
 *
 * If `time` is provided the video is temporarily seeked to that timestamp,
 * the frame is drawn, and playback position is restored.
 *
 * @param video  The source HTMLVideoElement
 * @param time   Optional seek timestamp in seconds
 * @returns      A PNG data URL cropped to the video rectangle
 */
export function captureFrame(
  video: HTMLVideoElement,
  time?: number,
): Promise<string> {
  if (time === undefined) {
    return captureVisibleVideo(video).catch((error: unknown) => {
      console.warn("[SubJap] Visible-tab screenshot unavailable; using canvas fallback:", error);
      return captureCanvasFrame(video);
    });
  }

  return captureCanvasFrame(video, time);
}

async function captureVisibleVideo(video: HTMLVideoElement): Promise<string> {
  const { dataUrl } = await sendMessage("screenshot:capture", {});
  const image = await loadImage(dataUrl);
  const rect = video.getBoundingClientRect();
  const scaleX = image.width / Math.max(window.innerWidth, 1);
  const scaleY = image.height / Math.max(window.innerHeight, 1);
  const sourceX = Math.max(0, Math.round(rect.left * scaleX));
  const sourceY = Math.max(0, Math.round(rect.top * scaleY));
  const sourceWidth = Math.min(image.width - sourceX, Math.round(rect.width * scaleX));
  const sourceHeight = Math.min(image.height - sourceY, Math.round(rect.height * scaleY));
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Video is outside the visible browser area");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to get 2d context from canvas");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Visible-tab screenshot could not be decoded"));
    image.src = dataUrl;
  });
}

function captureCanvasFrame(
  video: HTMLVideoElement,
  time?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get 2d context from canvas"));
      return;
    }

    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };

    if (time !== undefined && Math.abs(video.currentTime - time) > 0.25) {
      const prevTime = video.currentTime;
      const wasPaused = video.paused;

      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        draw();
        // Restore previous position
        if (Math.abs(video.currentTime - prevTime) > 0.25) {
          video.currentTime = prevTime;
        }
        if (wasPaused) video.pause();
      };

      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    } else {
      draw();
    }
  });
}
