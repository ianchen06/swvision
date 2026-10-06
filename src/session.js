// Accumulates tracked samples, fits a sliding window, and decides when the
// period estimate is stable enough to lock. Pure, no DOM.

import { estimateFrequency, fitDampedSine } from './fit.js';
import { project } from './signal.js';

export const SESSION_DEFAULTS = {
  windowS: 12, // sliding fit window
  bufferS: 60, // samples retained
  minCycles: 4, // minimum cycles in a window for a valid estimate
  lockCycles: 10, // minimum cycles observed before locking
  lockSpread: 0.001, // max relative spread of recent window estimates
  lockHistory: 5, // number of recent estimates that must agree
  maxRmsFrac: 0.15, // max fit rms relative to amplitude
};

function excludedSpans(ts, keep) {
  const spans = [];
  let start = null;
  for (let i = 0; i < ts.length; i++) {
    if (!keep[i] && start === null) start = ts[i];
    if (keep[i] && start !== null) {
      spans.push([start, ts[i - 1]]);
      start = null;
    }
  }
  if (start !== null) spans.push([start, ts.at(-1)]);
  return spans;
}

export class Session {
  constructor(opts = {}) {
    this.opts = { ...SESSION_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.samples = [];
    this.history = [];
    this.final = null;
    this.finalExcluded = [];
  }

  add({ t, x, y, ok }) {
    const last = this.samples.at(-1);
    if (last && t <= last.t) return; // duplicate or out-of-order frame
    this.samples.push({ t, x, y, ok: ok && Number.isFinite(x) && Number.isFinite(y) });
    const cutoff = t - this.opts.bufferS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  /**
   * Projected signal and fit over ok samples with t in [t0, t1].
   * One-cycle chunks whose residual is far above the typical chunk (e.g. the
   * hand releasing or catching the racket) are excluded and the fit repeated.
   * Returns { t, v, axis, fit, valid, excluded: [[tStart, tEnd], ...] } where
   * t, v are the samples actually used.
   */
  fitRange(t0 = -Infinity, t1 = Infinity) {
    const xs = [];
    const ys = [];
    const ts = [];
    for (const s of this.samples) {
      if (s.ok && s.t >= t0 && s.t <= t1) {
        xs.push(s.x);
        ys.push(s.y);
        ts.push(s.t);
      }
    }
    const n = ts.length;
    if (n < 8) return { t: ts, v: new Float64Array(0), fit: null, valid: false, excluded: [] };

    let keep = new Array(n).fill(true);
    let result = null;
    for (let iter = 0; iter < 4; iter++) {
      const idx = [];
      for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
      const kx = idx.map((i) => xs[i]);
      const ky = idx.map((i) => ys[i]);
      const axis = project(kx, ky).axis;
      const vAll = project(xs, ys, axis).values;
      const t = idx.map((i) => ts[i]);
      const v = Float64Array.from(idx, (i) => vAll[i]);
      const f0 = estimateFrequency(t, v);
      const fit = f0 ? fitDampedSine(t, v, f0) : null;
      result = { t, v, axis, fit, keep };
      if (!fit?.ok) break;

      // Residual rms per one-cycle chunk over all samples (so chunks can rejoin).
      const nChunks = Math.ceil((ts[n - 1] - ts[0]) / fit.T) || 1;
      const ss = new Float64Array(nChunks);
      const cnt = new Float64Array(nChunks);
      const chunkOf = (tt) => Math.min(nChunks - 1, Math.floor((tt - ts[0]) / fit.T));
      for (let i = 0; i < n; i++) {
        const e = vAll[i] - fit.evaluate(ts[i]);
        const k = chunkOf(ts[i]);
        ss[k] += e * e;
        cnt[k]++;
      }
      const rms = Array.from(ss, (s, k) => (cnt[k] ? Math.sqrt(s / cnt[k]) : NaN));
      const sorted = rms.filter(Number.isFinite).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const limit = Math.max(3 * median, 1e-9);
      const next = ts.map((tt) => rms[chunkOf(tt)] <= limit);
      if (next.every((k, i) => k === keep[i])) break;
      keep = next;
    }

    const { fit } = result;
    const valid = !!fit && fit.ok && fit.cycles >= this.opts.minCycles && fit.rms < this.opts.maxRmsFrac * fit.A;
    return { t: result.t, v: result.v, axis: result.axis, fit, valid, excluded: excludedSpans(ts, result.keep) };
  }

  /** Call periodically (~4 Hz). Returns a snapshot for the UI. */
  update() {
    const okSamples = this.samples.filter((s) => s.ok);
    if (okSamples.length === 0) return { state: 'idle', window: null, final: null, cycles: 0 };
    const tEnd = okSamples.at(-1).t;
    const win = this.fitRange(tEnd - this.opts.windowS, tEnd);
    const window = win.valid ? win.fit : null;
    const span = tEnd - okSamples[0].t;
    const cycles = window ? span / window.T : 0;

    if (!this.final && window) {
      this.history.push(window.T);
      if (this.history.length > this.opts.lockHistory) this.history.shift();
      const full = this.history.length === this.opts.lockHistory;
      const spread = full ? (Math.max(...this.history) - Math.min(...this.history)) / window.T : Infinity;
      if (full && spread < this.opts.lockSpread && cycles >= this.opts.lockCycles) {
        const all = this.fitRange();
        if (all.valid) {
          this.final = all.fit;
          this.finalExcluded = all.excluded;
        }
      }
    }

    return {
      state: this.final ? 'locked' : 'measuring',
      window,
      windowSeries: win,
      final: this.final,
      excluded: this.final ? this.finalExcluded : win.excluded,
      cycles,
    };
  }
}
