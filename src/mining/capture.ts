// ---------------------------------------------------------------------------
// SubJap — video frame capture via the visible browser tab
// ---------------------------------------------------------------------------

import { sendMessage } from "@/core/messaging";

const CAPTURE_CLASS = "subjap-capturing-frame";
const CAPTURE_STYLE_ID = "subjap-capture-frame-style";

/**
 * Hide everything painted over the video (player controls, native and SubJap
 * subtitles, popovers) so a rendered-tab capture only keeps the picture.
 * `visibility` is inherited, so hiding every element and re-showing only
 * `<video>` works whatever the player's DOM looks like. Returns a restore
 * function; callers must let the page repaint before capturing.
 */
export function hideVideoChromeForCapture(): () => void {
  if (!document.getElementById(CAPTURE_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = CAPTURE_STYLE_ID;
    style.textContent = `
      html.${CAPTURE_CLASS} body *,
      html.${CAPTURE_CLASS} body *::before,
      html.${CAPTURE_CLASS} body *::after {
        visibility: hidden !important;
        transition: none !important;
      }
      html.${CAPTURE_CLASS} body video {
        visibility: visible !important;
      }`;
    (document.head ?? document.documentElement).appendChild(style);
  }
  document.documentElement.classList.add(CAPTURE_CLASS);
  return () => document.documentElement.classList.remove(CAPTURE_CLASS);
}

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
  tabVideo?: HTMLVideoElement | null,
): Promise<string> {
  if (time === undefined) {
    // Viewport crops are relative to this frame, not to the captured tab.
    if (window.top !== window && !document.fullscreenElement) {
      return captureCanvasFrame(video);
    }
    if (tabVideo) return captureTabVideo(video, tabVideo);
    return captureVisibleVideo(video).catch((error: unknown) => {
      console.warn("[SubJap] Visible-tab screenshot unavailable; using canvas fallback:", error);
      return captureCanvasFrame(video);
    });
  }

  return captureCanvasFrame(video, time);
}

/**
 * Viewport rectangle of the visible picture inside a video element. Players
 * often size the element to the window and let `object-fit` letterbox the
 * picture, so cropping to the element would keep the black bars.
 */
function videoPictureRect(video: HTMLVideoElement): DOMRect {
  const rect = video.getBoundingClientRect();
  const { videoWidth, videoHeight } = video;
  const fit = getComputedStyle(video).objectFit;
  if (!videoWidth || !videoHeight || rect.width <= 0 || rect.height <= 0) return rect;
  if (fit === "fill" || fit === "cover") return rect;

  const containScale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const scale = fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, containScale) : containScale;
  const width = Math.min(rect.width, videoWidth * scale);
  const height = Math.min(rect.height, videoHeight * scale);
  return new DOMRect(
    rect.left + (rect.width - width) / 2,
    rect.top + (rect.height - height) / 2,
    width,
    height,
  );
}

function captureTabVideo(sourceVideo: HTMLVideoElement, tabVideo: HTMLVideoElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const rect = videoPictureRect(sourceVideo);
    const sourceWidth = tabVideo.videoWidth || window.innerWidth;
    const sourceHeight = tabVideo.videoHeight || window.innerHeight;
    const scaleX = sourceWidth / Math.max(window.innerWidth, 1);
    const scaleY = sourceHeight / Math.max(window.innerHeight, 1);
    const sourceX = Math.max(0, Math.round(rect.left * scaleX));
    const sourceY = Math.max(0, Math.round(rect.top * scaleY));
    const cropWidth = Math.min(sourceWidth - sourceX, Math.round(rect.width * scaleX));
    const cropHeight = Math.min(sourceHeight - sourceY, Math.round(rect.height * scaleY));
    if (cropWidth <= 0 || cropHeight <= 0) {
      reject(new Error("Tab capture video is outside the visible browser area"));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("Failed to get 2d context from tab capture"));
      return;
    }
    context.drawImage(
      tabVideo,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
    resolve(canvas.toDataURL("image/png"));
  });
}

async function captureVisibleVideo(video: HTMLVideoElement): Promise<string> {
  const { dataUrl } = await sendMessage("screenshot:capture", {});
  const image = await loadImage(dataUrl);
  const rect = videoPictureRect(video);
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
