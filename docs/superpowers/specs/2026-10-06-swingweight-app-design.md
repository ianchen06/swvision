# Racket Swingweight App — Design

Date: 2026-10-06
Status: Draft for review

## Goal

A frontend-only web app that measures a tennis racket's swingweight using the
compound-pendulum method. The racket hangs from a pivot and swings freely; a
camera looking up at the butt cap records the swing. The app tracks the butt
cap, measures the oscillation period, and combines it with three user-measured
values (mass, balance point, pivot distance) to compute swingweight in kg·cm².

Two input modes share one pipeline:

- **Live** — the browser camera (`getUserMedia`) measures the period in real time.
- **File** — a recorded video (e.g. `assets/IMG_7825.MOV`) is analyzed.

### Success criteria

- `assets/IMG_7825.MOV` in file mode yields T = 1.3684 ± 0.001 s
  (reference value from an offline numpy analysis of the same footage).
- Live mode on a laptop webcam at `localhost` locks onto a swinging target and
  reports a stable period.
- Given measured mass/balance/pivot, the app outputs swingweight with an
  uncertainty estimate and a per-input sensitivity breakdown.

### Reference measurements from `IMG_7825.MOV`

- 1080×1920 HEVC, 60 fps nominal, 2709 frames, 45.16 s; frame intervals jitter
  15.0–18.3 ms, so real timestamps must be used.
- Camera on the floor looking up; butt cap oscillates **vertically** in frame
  (perpendicular to the string bed — the swingweight axis). Amplitude ≈ 25% of
  frame height; small horizontal wobble.
- Background-subtracted dark-pixel centroid tracks the cap cleanly. Damped-sine
  fit: T = 1.36835 ± 0.00008 s full clip; 15–30 s and 30–44 s windows agree
  within 0.01%. First ~15 s are noisier (residual 8 px vs 2 px), so a trimmable
  analysis range is needed. Decay ≈ 0.004/s.

## Physics

Inputs (all distances measured from the butt end, in cm):

| Symbol | Meaning | Unit |
|---|---|---|
| m | racket mass (as hung, strung) | g (converted to kg) |
| b | balance point | cm from butt |
| p | pivot point (where the frame rests on the support) | cm from butt |
| T | measured period | s |
| θ₀ | optional swing amplitude (default 0) | degrees |
| g | gravitational acceleration, default 980.665 | cm/s² |

Computation:

1. Finite-amplitude correction: `T₀ = T / (1 + θ₀²/16)` (θ₀ in radians).
2. Equivalent simple-pendulum length: `L = g·T₀² / (4π²)` (cm).
3. Pivot-to-CoM distance: `d = |p − b|` (cm). Requires `d > 0`.
4. Inertia about pivot: `I_p = m·d·L` (kg·cm²).
5. Inertia about CoM: `I_cm = I_p − m·d² = m·d·(L − d)`. Requires `L > d`.
6. Swingweight (axis 10 cm from butt): `SW = I_cm + m·(b − 10)²`.

Outputs: I_p, I_cm, SW, plus uncertainty. Uncertainty combines in quadrature
the partial derivatives of SW with respect to T (fit σ), m (±1 g), b (±0.2 cm),
p (±0.2 cm). The UI also shows the sensitivity "SW change per 1 cm of pivot
error", because hanging from the head makes SW sensitive to p (≈7–8 units/cm
for this racket); hanging from the handle near 10 cm reduces this to ≈1/cm.
The app supports either hang point via the general formula.

## Architecture

Static HTML + ES modules. No build step, no runtime dependencies. Served by any
static file server.

```
index.html
styles.css
src/
  frameSource.js   camera / video file -> frames {gray, w, h, t}
  background.js    rolling per-pixel median background model
  tracker.js       frame + background -> {x, y, n, ok}
  signal.js        trajectory -> 1-D signal (principal-axis projection)
  fit.js           FFT seed + damped-sine Gauss–Newton fit
  physics.js       period + inputs -> I_p, I_cm, SW, uncertainty
  session.js       ring buffer, sliding-window fitting, lock logic
  ui.js            DOM wiring, plot, inputs, results
tests/
  fit.test.js
  physics.test.js
  tracker.test.js
  signal.test.js
  regression.test.js   offline check against IMG_7825.MOV frames
```

`tracker.js`, `background.js`, `signal.js`, `fit.js`, `physics.js` and
`session.js` are pure (no DOM) and run under Node for tests.

### frameSource.js

- `cameraSource({facingMode})`: `getUserMedia({video: {facingMode:
  'environment', frameRate: {ideal: 60}}})`.
- `fileSource(file)`: `<video>` element from an object URL, played at 1× and
  muted so `requestVideoFrameCallback` visits every frame.
- Both use `requestVideoFrameCallback`. Timestamp: `metadata.captureTime` when
  present (camera), else `metadata.mediaTime` (file), else `now`.
- Each frame is drawn to an offscreen canvas scaled so the long side is 192 px,
  converted to 8-bit grayscale, and emitted as `{gray: Uint8Array, w, h, t}`.
- Exposes `start()`, `stop()`, `onFrame(cb)`, and for files `duration` and
  `seek(t)`.

### background.js

- Keeps K = 40 sampled frames (one every 250 ms ⇒ ~10 s window).
- `median()` returns the per-pixel median, recomputed at most once per sample.
- Ready once ≥ 12 samples (≈3 s warm-up). Because the racket keeps moving,
  the median converges to the static scene.
- File mode pre-fills the model by seeking to 40 evenly spaced timestamps in
  the selected range before playback, so tracking is valid from the first frame.

### tracker.js

- Foreground mask: pixel `v` is foreground when `v < 80` and `bg − v > 40`
  (dark object absent from the background). Thresholds exported as options.
- Optional ROI rectangle (normalized coords) limits the mask.
- Output: centroid `{x, y}`, pixel count `n`, `ok = n ≥ minPixels`
  (default 0.5% of ROI area). Frames with `ok = false` are excluded from fits.

### signal.js

- Projects (x, y) onto the trajectory's principal axis (PCA over the window),
  so the phone may be held in any orientation. Returns centered 1-D values.

### fit.js

- `estimateFrequency(t, y)`: resample to uniform grid by linear interpolation,
  Hann window, zero-padded FFT (×8), peak excluding DC, parabolic peak refine.
- `fitDampedSine(t, y, f0)`: model `A·e^(−γt)·cos(ωt + φ) + c`, linear
  least-squares seed for A, φ, c at ω₀ = 2πf₀, then Gauss–Newton on
  (A, γ, ω, φ, c) up to 50 iterations. Returns `{T, sigmaT, A, gamma, rms,
  cycles}` where σ comes from the covariance `(JᵀJ)⁻¹·rms²`.
- Uses real (non-uniform) timestamps throughout the fit.

### physics.js

- `swingweight({massG, balanceCm, pivotCm, periodS, periodSigmaS, amplitudeDeg,
  g})` returns `{L, d, Ip, Icm, SW, sigmaSW, sensitivity: {perCmPivot,
  perCmBalance, perGram, perMsPeriod}}` or `{error}` for invalid inputs
  (d ≤ 0, L ≤ d, non-positive mass/period).

### session.js

- Ring buffer of `{t, x, y, ok}` (last 60 s).
- Every 250 ms: take the last 12 s of ok samples, project via signal.js, fit.
- Lock criteria: ≥ 10 cycles observed, last 5 window estimates have relative
  spread < 0.1%, and fit rms < 15% of amplitude. On lock, emit `locked` with
  the final T (fit over all ok samples since tracking became stable).
- States: `idle → warming → measuring → locked`. Reset clears everything.
- File mode: same logic, then a final fit over the user-selected [start, end].

### ui.js / index.html

Layout, single page:

1. **Mode** tabs: Live camera | Video file.
2. **Preview**: video with overlay — ROI rectangle (drag to set), tracked
   centroid dot, status badge (warming / measuring / locked).
3. **Trace plot** (canvas): projected signal vs time with fitted curve overlay.
4. **Period**: T ± σ, cycles, decay, fit rms.
5. **Inputs**: mass (g), balance (cm), pivot (cm), optional amplitude (deg),
   advanced g. Persisted in `localStorage`.
6. **Result**: SW ± σ (large), I_p, I_cm, sensitivity line.
7. File mode extras: file picker, range sliders (start/end), "Analyze" button,
   progress bar. A "Load sample" button loads `assets/IMG_7825.MOV`.

On lock: short beep (WebAudio) + `navigator.vibrate(200)` where supported,
since a phone on the floor has its screen facing the ceiling.

## Error handling

| Condition | Behavior |
|---|---|
| Camera permission denied / no secure context | Message explaining HTTPS/localhost requirement; offer file mode |
| Video fails to decode (e.g. HEVC on Firefox) | Message suggesting Chrome/Safari or H.264 re-export |
| `ok = false` frames | Excluded from fit; shown as gaps in trace |
| < 4 cycles or rms ≥ 15% of amplitude | Show "measuring…", no SW |
| Invalid physics inputs | Inline field errors; SW hidden |
| `requestVideoFrameCallback` unsupported | Fall back to `requestAnimationFrame` with `video.currentTime`, warn about reduced timing accuracy |

## Testing

- `node --test tests/` — no dependencies.
- **fit.test.js**: synthetic damped sines (T = 1.0–2.0 s, noise 5% of A,
  jittered 30/60 fps timestamps, 30 s) recover T within 0.05%; σT is within
  3× of the observed error; fewer than 2 cycles returns a low-confidence flag.
- **physics.test.js**: uniform rod (length ℓ, pivot at end) has
  T = 2π√(2ℓ/3g) and I_cm = mℓ²/12 — round-trip within 0.01%; hand-checked
  case (m 320 g, b 32, p 67, T 1.36835 → SW ≈ 283.8); invalid inputs error.
- **tracker.test.js / signal.test.js**: synthetic frames with a dark disc
  moving along a tilted line over a static dark strap; centroid within 0.5 px;
  principal axis recovers the tilt.
- **regression.test.js**: reads `tests/fixtures/img7825_gray.bin` (frames
  downscaled to 108×192 gray via ffmpeg, plus timestamps) — generated by
  `scripts/make-fixture.sh`, not committed if large — runs background →
  tracker → signal → fit, expects T = 1.3684 ± 0.001 s. Skips when the
  fixture is absent.
- **Manual**: file mode with the sample in the browser preview (same T);
  live mode with laptop webcam on localhost.

## Out of scope

- HTTPS hosting setup for phone use (any static HTTPS host works).
- Session history / export.
- Multiple rackets or simultaneous measurements.
- Automatic amplitude-angle estimation from pixels (needs a scale reference).
