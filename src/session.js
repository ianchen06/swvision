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

export class Session {
  constructor(opts = {}) {
    this.opts = { ...SESSION_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.samples = [];
    this.history = [];
    this.final = null;
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

  /** Projected signal and fit over ok samples with t in [t0, t1]. */
  fitRange(t0 = -Infinity, t1 = Infinity) {
    const xs = [];
    const ys = [];
    const t = [];
    for (const s of this.samples) {
      if (s.ok && s.t >= t0 && s.t <= t1) {
        xs.push(s.x);
        ys.push(s.y);
        t.push(s.t);
      }
    }
    if (t.length < 8) return { t, v: new Float64Array(0), fit: null, valid: false };
    const { values: v, axis } = project(xs, ys);
    const f0 = estimateFrequency(t, v);
    const fit = f0 ? fitDampedSine(t, v, f0) : null;
    const valid =
      !!fit && fit.ok && fit.cycles >= this.opts.minCycles && fit.rms < this.opts.maxRmsFrac * fit.A;
    return { t, v, axis, fit, valid };
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
        if (all.valid) this.final = all.fit;
      }
    }

    return {
      state: this.final ? 'locked' : 'measuring',
      window,
      windowSeries: win,
      final: this.final,
      cycles,
    };
  }
}
