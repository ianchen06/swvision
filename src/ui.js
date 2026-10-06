import { Background } from './background.js';
import { track } from './tracker.js';
import { Session } from './session.js';
import { swingweight } from './physics.js';
import { FrameGrabber, openCamera, closeCamera, watchFrames, seekTo, hasFrameCallback, CameraError } from './frameSource.js';

const SAMPLE_URL = 'assets/IMG_7825.MOV';
const STORAGE_KEY = 'swvision.inputs';
const UPDATE_MS = 250;
const BG_PREFILL = 40;

const $ = (id) => document.getElementById(id);
const el = {
  tabLive: $('tab-live'), tabFile: $('tab-file'),
  liveControls: $('live-controls'), fileControls: $('file-controls'),
  btnCamera: $('btn-camera'), btnReset: $('btn-reset'),
  file: $('file'), btnSample: $('btn-sample'), btnAnalyze: $('btn-analyze'),
  range: $('range'), rangeStart: $('range-start'), rangeEnd: $('range-end'),
  rangeStartOut: $('range-start-out'), rangeEndOut: $('range-end-out'), progress: $('progress'),
  video: $('video'), overlay: $('overlay'), status: $('status'), btnClearRoi: $('btn-clear-roi'),
  message: $('message'), trace: $('trace'),
  period: $('period'), cycles: $('cycles'), decay: $('decay'), rms: $('rms'), excluded: $('excluded'),
  inputs: $('inputs'), mass: $('mass'), balance: $('balance'), pivot: $('pivot'), amp: $('amp'), g: $('g'),
  sw: $('sw'), swSigma: $('sw-sigma'), swNote: $('sw-note'), ip: $('ip'), icm: $('icm'), sens: $('sens'),
};

const state = {
  mode: 'live',
  running: false, // camera streaming or file being analyzed
  roi: null, // {x0,y0,x1,y1} normalized
  dragging: null,
  grabber: new FrameGrabber(),
  bg: new Background(),
  session: new Session(),
  stopFrames: null,
  timer: null,
  lastTrack: null, // {x, y, ok, w, h}
  period: null, // {T, sigmaT, final}
  series: null, // {t, v, fit}
  fileUrl: null,
  analyzed: null, // {start, end} processed range in file mode
};

// ---------- status / messages ----------

function setStatus(s, label = s) {
  el.status.className = `badge ${s}`;
  el.status.textContent = label;
}

function showMessage(text) {
  el.message.textContent = text;
  el.message.hidden = !text;
}

// ---------- tabs ----------

function setMode(mode) {
  if (mode === state.mode) return;
  stopAll();
  state.mode = mode;
  el.tabLive.setAttribute('aria-selected', mode === 'live');
  el.tabFile.setAttribute('aria-selected', mode === 'file');
  el.liveControls.hidden = mode !== 'live';
  el.fileControls.hidden = mode !== 'file';
  el.video.removeAttribute('src');
  el.video.load();
  if (mode === 'file' && state.fileUrl) loadVideo(state.fileUrl);
  resetMeasurement();
  showMessage('');
}

el.tabLive.onclick = () => setMode('live');
el.tabFile.onclick = () => setMode('file');

// ---------- measurement lifecycle ----------

function resetMeasurement() {
  state.bg.reset();
  state.session.reset();
  state.lastTrack = null;
  state.period = null;
  state.series = null;
  state.analyzed = null;
  setStatus('idle');
  renderPeriod();
  renderResult();
  drawTrace();
  drawOverlay();
}

function stopAll() {
  state.stopFrames?.();
  state.stopFrames = null;
  clearInterval(state.timer);
  state.timer = null;
  if (state.mode === 'live') {
    closeCamera(el.video);
    el.btnCamera.textContent = 'Start camera';
  } else {
    el.video.pause();
    el.progress.hidden = true;
  }
  state.running = false;
}

function processFrame(t, { learnBackground }) {
  const frame = state.grabber.grab(el.video);
  if (!frame) return;
  const { gray, w, h } = frame;
  if (learnBackground) state.bg.add(gray, w, h, t);
  if (!state.bg.ready) {
    setStatus('warming', 'learning background…');
    state.lastTrack = null;
    drawOverlay();
    return;
  }
  const r = track(gray, state.bg.median(), w, h, { roi: state.roi });
  state.session.add({ t, ...r });
  state.lastTrack = { ...r, w, h };
  drawOverlay();
}

function applySnapshot(snap, { allowLock }) {
  const fit = snap.final ?? snap.window;
  state.series = snap.windowSeries?.fit ? { t: snap.windowSeries.t, v: snap.windowSeries.v, fit: snap.windowSeries.fit } : state.series;
  if (snap.final && allowLock) {
    state.series = seriesFor(state.session.fitRange());
  }
  state.period = fit ? { T: fit.T, sigmaT: fit.sigmaT, final: !!snap.final, fit, cycles: snap.cycles, excluded: snap.excluded ?? [] } : null;
  renderPeriod();
  renderResult();
  drawTrace();
}

function seriesFor(r) {
  return r.fit ? { t: r.t, v: r.v, fit: r.fit } : null;
}

// ---------- live mode ----------

el.btnCamera.onclick = async () => {
  if (state.running) {
    stopAll();
    setStatus('idle');
    return;
  }
  resetMeasurement();
  showMessage('');
  try {
    await openCamera(el.video);
  } catch (e) {
    showMessage(e instanceof CameraError ? e.message : String(e));
    return;
  }
  if (!hasFrameCallback()) showMessage('This browser lacks requestVideoFrameCallback; timing accuracy is reduced.');
  state.running = true;
  el.btnCamera.textContent = 'Stop camera';
  let wasLocked = false;
  state.stopFrames = watchFrames(el.video, 'camera', (t) => processFrame(t, { learnBackground: true }));
  state.timer = setInterval(() => {
    if (!state.bg.ready) return;
    const snap = state.session.update();
    setStatus(snap.state, snap.state === 'locked' ? 'locked ✓' : snap.state === 'idle' ? 'looking for racket…' : 'measuring…');
    applySnapshot(snap, { allowLock: true });
    if (snap.state === 'locked' && !wasLocked) {
      wasLocked = true;
      notifyLocked();
    }
  }, UPDATE_MS);
};

el.btnReset.onclick = () => {
  const wasRunning = state.running && state.mode === 'live';
  state.bg.reset();
  state.session.reset();
  state.period = null;
  state.series = null;
  renderPeriod();
  renderResult();
  drawTrace();
  if (!wasRunning) setStatus('idle');
};

function notifyLocked() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* audio unavailable */ }
  navigator.vibrate?.(200);
}

// ---------- file mode ----------

function loadVideo(url) {
  stopAll();
  resetMeasurement();
  showMessage('');
  el.btnAnalyze.disabled = true;
  el.range.hidden = true;
  el.video.srcObject = null;
  el.video.src = url;
  el.video.load();
}

el.video.addEventListener('loadedmetadata', () => {
  if (state.mode !== 'file') return;
  if (!el.video.videoWidth) {
    showMessage('This browser can play the audio but not the video track. Try Chrome or Safari, or re-export as H.264.');
    return;
  }
  const d = el.video.duration;
  for (const r of [el.rangeStart, el.rangeEnd]) {
    r.max = d.toFixed(2);
  }
  el.rangeStart.value = 0;
  el.rangeEnd.value = d.toFixed(2);
  updateRangeLabels();
  el.range.hidden = false;
  el.btnAnalyze.disabled = false;
  seekTo(el.video, Math.min(0.1, d / 2));
});

el.video.addEventListener('error', () => {
  if (state.mode !== 'file' || !el.video.getAttribute('src')) return;
  showMessage('This video could not be decoded. HEVC (iPhone) video needs Chrome or Safari on a Mac; otherwise re-export as H.264.');
  el.btnAnalyze.disabled = true;
});

el.file.onchange = () => {
  const f = el.file.files?.[0];
  if (!f) return;
  if (state.fileUrl?.startsWith('blob:')) URL.revokeObjectURL(state.fileUrl);
  state.fileUrl = URL.createObjectURL(f);
  loadVideo(state.fileUrl);
};

el.btnSample.onclick = () => {
  state.fileUrl = SAMPLE_URL;
  loadVideo(SAMPLE_URL);
};

function rangeValues() {
  let a = Number(el.rangeStart.value);
  let b = Number(el.rangeEnd.value);
  if (a > b) [a, b] = [b, a];
  return { start: a, end: b };
}

function updateRangeLabels() {
  el.rangeStartOut.textContent = `${Number(el.rangeStart.value).toFixed(1)} s`;
  el.rangeEndOut.textContent = `${Number(el.rangeEnd.value).toFixed(1)} s`;
}

for (const r of [el.rangeStart, el.rangeEnd]) {
  r.addEventListener('input', () => {
    updateRangeLabels();
    if (!state.running) el.video.currentTime = Number(r.value);
    // Re-fit without re-processing when the new range lies inside the analyzed one.
    const { start, end } = rangeValues();
    if (state.analyzed && !state.running && start >= state.analyzed.start - 1e-6 && end <= state.analyzed.end + 1e-6) {
      finishFit(start, end);
    }
  });
}

el.btnAnalyze.onclick = async () => {
  if (state.running) {
    stopAll();
    setStatus('idle');
    el.btnAnalyze.textContent = 'Analyze';
    return;
  }
  const { start, end } = rangeValues();
  if (end - start < 3) {
    showMessage('Select at least a few seconds of video to analyze.');
    return;
  }
  resetMeasurement();
  showMessage('');
  state.running = true;
  el.btnAnalyze.textContent = 'Stop';
  el.progress.hidden = false;
  el.progress.value = 0;

  // 1. Background from frames spread over the range.
  setStatus('analyzing', 'learning background…');
  for (let k = 0; k < BG_PREFILL && state.running; k++) {
    await seekTo(el.video, start + ((k + 0.5) * (end - start)) / BG_PREFILL);
    const f = state.grabber.grab(el.video);
    if (f) state.bg.push(f.gray, f.w, f.h);
    el.progress.value = (0.1 * (k + 1)) / BG_PREFILL;
  }
  if (!state.running) return;

  // 2. Play through the range at 1× and track every frame.
  await seekTo(el.video, start);
  setStatus('analyzing', 'tracking…');
  state.stopFrames = watchFrames(el.video, 'file', (t) => {
    if (t < start - 0.05) return;
    if (t > end || el.video.ended) {
      completeAnalysis(start, Math.min(end, t));
      return;
    }
    processFrame(t, { learnBackground: false });
    el.progress.value = 0.1 + (0.9 * (t - start)) / (end - start);
  });
  el.video.onended = () => state.running && completeAnalysis(start, end);
  // Browsers pause muted video in hidden tabs; resume when visible again.
  el.video.onpause = () => {
    if (state.running && !el.video.ended && document.visibilityState === 'hidden') {
      setStatus('warming', 'paused — keep this tab visible');
    }
  };
  state.timer = setInterval(() => {
    const snap = state.session.update();
    applySnapshot({ ...snap, final: null }, { allowLock: false });
  }, UPDATE_MS);
  try {
    await el.video.play();
  } catch (e) {
    showMessage(`Playback failed: ${e.message}`);
    stopAll();
  }
};

function completeAnalysis(start, end) {
  if (!state.running) return;
  stopAll();
  el.btnAnalyze.textContent = 'Analyze';
  state.analyzed = { start, end };
  finishFit(start, end);
}

function finishFit(start, end) {
  const r = state.session.fitRange(start, end);
  state.series = seriesFor(r);
  if (r.valid) {
    state.period = { T: r.fit.T, sigmaT: r.fit.sigmaT, final: true, fit: r.fit, cycles: r.fit.cycles, excluded: r.excluded };
    setStatus('done', 'done ✓');
    showMessage('');
  } else {
    state.period = null;
    setStatus('idle', 'no clean swing found');
    showMessage('Could not find a clean oscillation. Try drawing a region around the butt cap or trimming the range.');
  }
  renderPeriod();
  renderResult();
  drawTrace();
}

// ---------- ROI ----------

function pointerPos(e) {
  const rect = el.overlay.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

el.overlay.addEventListener('pointerdown', (e) => {
  el.overlay.setPointerCapture(e.pointerId);
  const p = pointerPos(e);
  state.dragging = { a: p, b: p };
  drawOverlay();
});
el.overlay.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  state.dragging.b = pointerPos(e);
  drawOverlay();
});
el.overlay.addEventListener('pointerup', () => {
  const d = state.dragging;
  state.dragging = null;
  if (!d) return;
  const roi = { x0: Math.min(d.a.x, d.b.x), y0: Math.min(d.a.y, d.b.y), x1: Math.max(d.a.x, d.b.x), y1: Math.max(d.a.y, d.b.y) };
  state.roi = roi.x1 - roi.x0 > 0.05 && roi.y1 - roi.y0 > 0.05 ? roi : null;
  drawOverlay();
});
el.btnClearRoi.onclick = () => {
  state.roi = null;
  drawOverlay();
};

// ---------- drawing ----------

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { ctx: canvas.getContext('2d'), w, h, dpr };
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawOverlay() {
  const { ctx, w, h, dpr } = fitCanvas(el.overlay);
  ctx.clearRect(0, 0, w, h);
  const rect = state.dragging
    ? { x0: Math.min(state.dragging.a.x, state.dragging.b.x), y0: Math.min(state.dragging.a.y, state.dragging.b.y), x1: Math.max(state.dragging.a.x, state.dragging.b.x), y1: Math.max(state.dragging.a.y, state.dragging.b.y) }
    : state.roi;
  if (rect) {
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeRect(rect.x0 * w, rect.y0 * h, (rect.x1 - rect.x0) * w, (rect.y1 - rect.y0) * h);
    ctx.setLineDash([]);
  }
  const tr = state.lastTrack;
  if (tr && Number.isFinite(tr.x)) {
    ctx.fillStyle = tr.ok ? '#00e676' : '#ff5252';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc((tr.x / tr.w) * w, (tr.y / tr.h) * h, 7 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

function drawTrace() {
  const { ctx, w, h, dpr } = fitCanvas(el.trace);
  ctx.clearRect(0, 0, w, h);
  const s = state.series;
  if (!s || s.t.length < 2) {
    ctx.fillStyle = css('--muted');
    ctx.font = `${13 * dpr}px system-ui`;
    ctx.fillText('No swing data yet', 10 * dpr, h / 2);
    return;
  }
  const t0 = s.t[0];
  const t1 = s.t.at(-1);
  let vmax = 1;
  for (const v of s.v) vmax = Math.max(vmax, Math.abs(v - (s.fit?.c ?? 0)));
  const c = s.fit?.c ?? 0;
  const pad = 6 * dpr;
  const X = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - 2 * pad);
  const Y = (v) => h / 2 - ((v - c) / vmax) * (h / 2 - pad);

  ctx.strokeStyle = css('--line');
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.fillStyle = css('--trace');
  const r = 1.4 * dpr;
  for (let i = 0; i < s.t.length; i++) ctx.fillRect(X(s.t[i]) - r / 2, Y(s.v[i]) - r / 2, r, r);

  if (s.fit) {
    ctx.strokeStyle = css('--fit');
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    const steps = Math.max(200, Math.round(w / 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps;
      const x = X(t);
      const y = Y(s.fit.evaluate(t));
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = css('--muted');
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.fillText(`${(t1 - t0).toFixed(1)} s`, w - 44 * dpr, h - 6 * dpr);
}

// ---------- readouts ----------

function renderPeriod() {
  const p = state.period;
  if (!p) {
    el.period.textContent = el.cycles.textContent = el.decay.textContent = el.rms.textContent = '—';
    el.excluded.textContent = '';
    return;
  }
  el.excluded.textContent = p.excluded?.length
    ? `Ignored irregular motion at ${p.excluded.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(', ')}.`
    : '';
  el.period.textContent = `${p.T.toFixed(5)} ± ${p.sigmaT.toFixed(5)} s`;
  el.cycles.textContent = (p.cycles ?? p.fit.cycles).toFixed(1);
  el.decay.textContent = `${p.fit.gamma.toFixed(4)} /s`;
  el.rms.textContent = `${((100 * p.fit.rms) / p.fit.A).toFixed(1)} % of amplitude`;
}

function readInputs() {
  const num = (input) => (input.value.trim() === '' ? NaN : Number(input.value));
  return {
    massG: num(el.mass),
    balanceCm: num(el.balance),
    pivotCm: num(el.pivot),
    amplitudeDeg: num(el.amp) || 0,
    g: num(el.g) || 980.665,
  };
}

function renderResult() {
  const inputs = readInputs();
  const p = state.period;
  const clear = (note, isError = false) => {
    el.sw.textContent = '—';
    el.swSigma.textContent = '';
    el.ip.textContent = el.icm.textContent = '—';
    el.sens.textContent = '';
    el.swNote.textContent = note;
    el.swNote.classList.toggle('error', isError);
  };
  for (const k of ['mass', 'balance', 'pivot']) el[k].classList.remove('bad');

  if ([inputs.massG, inputs.balanceCm, inputs.pivotCm].some((v) => !Number.isFinite(v))) {
    clear(p ? 'Enter mass, balance and pivot to compute swingweight.' : 'Waiting for a period measurement.');
    return;
  }
  if (!p) {
    clear('Waiting for a period measurement.');
    return;
  }
  const r = swingweight({ ...inputs, periodS: p.T, periodSigmaS: p.sigmaT });
  if (r.error) {
    clear(r.error, true);
    if (/pivot|balance/i.test(r.error)) el.pivot.classList.add('bad');
    if (/mass/i.test(r.error)) el.mass.classList.add('bad');
    return;
  }
  el.sw.textContent = r.SW.toFixed(1);
  el.swSigma.textContent = `± ${r.sigmaSW.toFixed(1)} kg·cm²`;
  el.ip.textContent = `${r.Ip.toFixed(1)} kg·cm²`;
  el.icm.textContent = `${r.Icm.toFixed(1)} kg·cm²`;
  el.swNote.classList.remove('error');
  el.swNote.textContent = p.final ? 'Swingweight about the axis 10 cm from the butt.' : 'Provisional — still measuring.';
  const s = r.sensitivity;
  el.sens.textContent = `Sensitivity: ${fmtSigned(s.perCmPivot)} per cm of pivot, ${fmtSigned(s.perCmBalance)} per cm of balance, ${fmtSigned(s.perGram)} per gram.`;
}

const fmtSigned = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

// ---------- inputs persistence ----------

function loadInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const k of ['mass', 'balance', 'pivot', 'amp', 'g']) if (saved[k] != null) el[k].value = saved[k];
  } catch { /* ignore corrupt storage */ }
}

el.inputs.addEventListener('input', () => {
  const data = {};
  for (const k of ['mass', 'balance', 'pivot', 'amp', 'g']) data[k] = el[k].value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  renderResult();
});
el.inputs.addEventListener('submit', (e) => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running && state.mode === 'file' && el.video.paused && !el.video.ended) {
    setStatus('analyzing', 'tracking…');
    el.video.play().catch(() => {});
  }
});

window.addEventListener('resize', () => {
  drawOverlay();
  drawTrace();
});
el.video.addEventListener('loadeddata', drawOverlay);

loadInputs();
resetMeasurement();
