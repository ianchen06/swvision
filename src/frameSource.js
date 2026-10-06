// Browser-only: camera / video file access and per-frame grayscale capture.

export const LONG_SIDE = 192;

/** Draws video frames to a small canvas and returns 8-bit grayscale. */
export class FrameGrabber {
  constructor(longSide = LONG_SIDE) {
    this.longSide = longSide;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gray = null;
  }

  grab(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = this.longSide / Math.max(vw, vh);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gray = new Uint8Array(w * h);
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const rgba = this.ctx.getImageData(0, 0, w, h).data;
    const gray = this.gray;
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    }
    return { gray, w, h };
  }
}

export class CameraError extends Error {}

export async function openCamera(video) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('Camera access needs HTTPS (or localhost). Use the Video file tab instead, or serve this page over HTTPS.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 60 }, width: { ideal: 1280 } },
    });
  } catch (e) {
    throw new CameraError(`Could not open the camera (${e.name}). Check browser permissions, or use the Video file tab.`);
  }
  video.removeAttribute('src');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function closeCamera(video) {
  const stream = video.srcObject;
  if (stream) for (const track of stream.getTracks()) track.stop();
  video.srcObject = null;
}

/**
 * Calls cb(t) once per decoded frame with t in seconds.
 * kind: 'camera' uses capture time; 'file' uses media time.
 * Returns a stop() function.
 */
export function watchFrames(video, kind, cb) {
  let stopped = false;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    let handle;
    const step = (now, meta) => {
      if (stopped) return;
      const t = kind === 'file' ? meta.mediaTime : (meta.captureTime ?? now) / 1000;
      cb(t);
      handle = video.requestVideoFrameCallback(step);
    };
    handle = video.requestVideoFrameCallback(step);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(handle);
    };
  }
  // Fallback: lower timing accuracy.
  let last = -1;
  let raf;
  const loop = () => {
    if (stopped) return;
    const t = kind === 'file' ? video.currentTime : performance.now() / 1000;
    if (t !== last) {
      last = t;
      cb(t);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

export const hasFrameCallback = () => 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export function seekTo(video, t) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}
