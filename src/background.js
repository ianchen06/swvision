// Rolling per-pixel median of sampled frames. The racket keeps moving, so the
// median converges to the static scene. Pure, no DOM.

export class Background {
  constructor({ capacity = 40, intervalS = 0.25, minSamples = 12 } = {}) {
    this.capacity = capacity;
    this.intervalS = intervalS;
    this.minSamples = minSamples;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.w = 0;
    this.h = 0;
    this.lastT = -Infinity;
    this.cache = null;
  }

  get count() {
    return this.frames.length;
  }

  get ready() {
    return this.frames.length >= this.minSamples;
  }

  /** Sample the frame if at least intervalS has passed since the last sample. */
  add(gray, w, h, t) {
    if (t - this.lastT < this.intervalS - 1e-9) return false;
    this.lastT = t;
    this.push(gray, w, h);
    return true;
  }

  /** Unconditionally add a frame (used to pre-fill from a video file). */
  push(gray, w, h) {
    if (w !== this.w || h !== this.h) {
      this.frames = [];
      this.w = w;
      this.h = h;
    }
    this.frames.push(Uint8Array.from(gray));
    if (this.frames.length > this.capacity) this.frames.shift();
    this.cache = null;
  }

  median() {
    if (this.cache) return this.cache;
    const n = this.frames.length;
    const size = this.w * this.h;
    const out = new Uint8Array(size);
    const buf = new Uint8Array(n);
    const mid = n >> 1;
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < n; k++) buf[k] = this.frames[k][i];
      buf.sort();
      out[i] = buf[mid];
    }
    this.cache = out;
    return out;
  }
}
