// Locates the dark butt cap: pixels that are dark now but not dark in the
// background model. Pure, no DOM.

export const TRACKER_DEFAULTS = { darkMax: 80, diffMin: 40, minFrac: 0.005 };

/**
 * gray, bg: Uint8Array of length w*h. roi: optional {x0, y0, x1, y1} in 0..1.
 * Returns { x, y, n, ok } with x, y in pixels of the w×h frame.
 */
export function track(gray, bg, w, h, { roi = null, darkMax = 80, diffMin = 40, minFrac = 0.005 } = {}) {
  const x0 = roi ? Math.max(0, Math.floor(roi.x0 * w)) : 0;
  const x1 = roi ? Math.min(w, Math.ceil(roi.x1 * w)) : w;
  const y0 = roi ? Math.max(0, Math.floor(roi.y0 * h)) : 0;
  const y1 = roi ? Math.min(h, Math.ceil(roi.y1 * h)) : h;

  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      const v = gray[row + x];
      if (v < darkMax && bg[row + x] - v > diffMin) {
        n++;
        sx += x;
        sy += y;
      }
    }
  }
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const ok = n >= minFrac * area;
  // +0.5: report pixel centers so coordinates are continuous.
  return { x: n ? sx / n + 0.5 : NaN, y: n ? sy / n + 0.5 : NaN, n, ok };
}
