// Period estimation for a (lightly damped) pendulum signal sampled at
// non-uniform timestamps. Pure functions, no DOM.

const TWO_PI = 2 * Math.PI;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// In-place iterative radix-2 FFT on separate real/imag arrays.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TWO_PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Dominant frequency (Hz) of y(t) within [minHz, maxHz].
 * Resamples to a uniform grid, applies a Hann window, zero-pads x8 and
 * refines the spectral peak with parabolic interpolation.
 * Returns null when there are too few samples.
 */
export function estimateFrequency(t, y, { minHz = 0.2, maxHz = 5 } = {}) {
  const n = t.length;
  if (n < 8) return null;
  const t0 = t[0];
  const dt = (t[n - 1] - t0) / (n - 1);
  if (!(dt > 0)) return null;

  const u = new Float64Array(n);
  let j = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + i * dt;
    while (j < n - 2 && t[j + 1] < ti) j++;
    const span = t[j + 1] - t[j];
    const a = span > 0 ? Math.min(1, Math.max(0, (ti - t[j]) / span)) : 0;
    u[i] = y[j] + (y[j + 1] - y[j]) * a;
    mean += u[i];
  }
  mean /= n;

  const m = nextPow2(n * 8);
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((TWO_PI * i) / (n - 1));
    re[i] = (u[i] - mean) * w;
  }
  fft(re, im);

  const df = 1 / (m * dt);
  const kMin = Math.max(1, Math.floor(minHz / df));
  const kMax = Math.min(m / 2 - 1, Math.ceil(maxHz / df));
  let best = -1;
  let bestK = -1;
  const mag = (k) => Math.hypot(re[k], im[k]);
  for (let k = kMin; k <= kMax; k++) {
    const v = mag(k);
    if (v > best) {
      best = v;
      bestK = k;
    }
  }
  if (bestK < 0) return null;
  const a = mag(bestK - 1);
  const b = best;
  const c = mag(bestK + 1);
  const denom = a - 2 * b + c;
  const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return (bestK + delta) * df;
}

// Solve the n x n system M x = v by Gaussian elimination with partial pivoting.
function solve(M, v) {
  const n = v.length;
  const A = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-300) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

function diagOfInverse(M) {
  const n = M.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    const col = solve(M, e);
    out[i] = col ? col[i] : Infinity;
  }
  return out;
}

/**
 * Least-squares fit of y = A·exp(-gamma·τ)·cos(omega·τ + phi) + c, τ = t - t[0].
 * f0 (Hz) seeds the frequency. Returns
 * { ok, T, sigmaT, A, gamma, omega, phi, c, t0, rms, cycles, evaluate(t) }.
 */
export function fitDampedSine(t, y, f0) {
  const n = t.length;
  const fail = { ok: false, T: NaN, sigmaT: Infinity, A: 0, gamma: 0, rms: Infinity, cycles: 0, evaluate: () => NaN };
  if (n < 8 || !(f0 > 0)) return fail;
  const t0 = t[0];
  const tau = Float64Array.from(t, (v) => v - t0);

  // Linear seed for amplitude/phase/offset at fixed omega.
  let omega = TWO_PI * f0;
  {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const v = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const row = [Math.cos(omega * tau[i]), Math.sin(omega * tau[i]), 1];
      for (let r = 0; r < 3; r++) {
        v[r] += row[r] * y[i];
        for (let k = 0; k < 3; k++) M[r][k] += row[r] * row[k];
      }
    }
    const s = solve(M, v);
    if (!s) return fail;
    var p = [Math.hypot(s[0], s[1]), 0, omega, Math.atan2(-s[1], s[0]), s[2]];
  }

  const residuals = (q) => {
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const e = y[i] - (q[0] * Math.exp(-q[1] * tau[i]) * Math.cos(q[2] * tau[i] + q[3]) + q[4]);
      ss += e * e;
    }
    return ss;
  };

  // Levenberg–Marquardt-damped Gauss–Newton on [A, gamma, omega, phi, c].
  let ss = residuals(p);
  let lambda = 1e-3;
  let JtJ = null;
  for (let iter = 0; iter < 50; iter++) {
    JtJ = [0, 1, 2, 3, 4].map(() => new Array(5).fill(0));
    const Jtr = new Array(5).fill(0);
    for (let i = 0; i < n; i++) {
      const ex = Math.exp(-p[1] * tau[i]);
      const arg = p[2] * tau[i] + p[3];
      const co = Math.cos(arg);
      const si = Math.sin(arg);
      const r = y[i] - (p[0] * ex * co + p[4]);
      const J = [ex * co, -tau[i] * p[0] * ex * co, -p[0] * ex * si * tau[i], -p[0] * ex * si, 1];
      for (let a = 0; a < 5; a++) {
        Jtr[a] += J[a] * r;
        for (let b = a; b < 5; b++) JtJ[a][b] += J[a] * J[b];
      }
    }
    for (let a = 0; a < 5; a++) for (let b = 0; b < a; b++) JtJ[a][b] = JtJ[b][a];

    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const D = JtJ.map((row, i) => row.map((v, k) => (i === k ? v * (1 + lambda) : v)));
      const step = solve(D, Jtr);
      if (!step) break;
      const q = p.map((v, i) => v + step[i]);
      const ssq = residuals(q);
      if (ssq <= ss) {
        const rel = Math.abs(step[2]) / q[2];
        p = q;
        ss = ssq;
        lambda = Math.max(lambda / 10, 1e-9);
        improved = true;
        if (rel < 1e-12) iter = 50;
      } else {
        lambda *= 10;
      }
    }
    if (!improved) break;
  }

  if (p[0] < 0) {
    p[0] = -p[0];
    p[3] += Math.PI;
  }
  const [A, gamma, w, phi, c] = p;
  const dof = Math.max(1, n - 5);
  const rms = Math.sqrt(ss / dof);
  const diag = diagOfInverse(JtJ);
  const sigmaW = Math.sqrt(Math.max(0, diag[2]) * rms * rms);
  const T = TWO_PI / w;
  const cycles = (tau[n - 1] * w) / TWO_PI;
  return {
    ok: w > 0 && cycles >= 2 && Number.isFinite(T),
    T,
    sigmaT: (TWO_PI * sigmaW) / (w * w),
    A,
    gamma,
    omega: w,
    phi,
    c,
    t0,
    rms,
    cycles,
    evaluate: (tt) => A * Math.exp(-gamma * (tt - t0)) * Math.cos(w * (tt - t0) + phi) + c,
  };
}
