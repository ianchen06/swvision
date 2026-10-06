import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Background } from '../src/background.js';
import { track } from '../src/tracker.js';
import { principalAxis, project } from '../src/signal.js';

const W = 108;
const H = 192;

// Light background with a static dark "strap" across the top.
function scene() {
  const g = new Uint8Array(W * H).fill(200);
  for (let y = 10; y < 20; y++) for (let x = 20; x < 90; x++) g[y * W + x] = 20;
  return g;
}

function withDisc(cx, cy, r = 12) {
  const g = scene();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y * W + x] = 15;
    }
  }
  return g;
}

// Disc moves along a line tilted 20° from vertical.
const tilt = (20 * Math.PI) / 180;
const pos = (s) => [54 + s * Math.sin(tilt), 100 + s * Math.cos(tilt)];

test('background median recovers the static scene from moving frames', () => {
  const bg = new Background({ capacity: 40, intervalS: 0.25, minSamples: 12 });
  assert.equal(bg.ready, false);
  for (let i = 0; i < 40; i++) {
    const [x, y] = pos(50 * Math.sin(i * 0.9));
    bg.add(withDisc(x, y), W, H, i * 0.25);
  }
  assert.equal(bg.ready, true);
  const med = bg.median();
  const ref = scene();
  let diff = 0;
  for (let i = 0; i < med.length; i++) diff += med[i] !== ref[i];
  assert.ok(diff < 10, `differing pixels: ${diff}`);
});

test('background ignores frames arriving faster than the sample interval', () => {
  const bg = new Background({ capacity: 40, intervalS: 0.25, minSamples: 12 });
  for (let i = 0; i < 30; i++) bg.add(scene(), W, H, i * 0.1);
  assert.equal(bg.count, 10); // t = 0, 0.3, ... 2.7 → one every 3 frames
});

test('tracker finds the disc centroid and ignores the static strap', () => {
  const bg = scene();
  const [x, y] = pos(30);
  const r = track(withDisc(x, y), bg, W, H);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.x - x) < 0.5 && Math.abs(r.y - y) < 0.5, JSON.stringify(r));
});

test('tracker reports not ok when the disc is missing', () => {
  const r = track(scene(), scene(), W, H);
  assert.equal(r.ok, false);
});

test('tracker respects the ROI', () => {
  const bg = scene();
  const r = track(withDisc(30, 150), bg, W, H, { roi: { x0: 0.5, y0: 0, x1: 1, y1: 1 } });
  assert.equal(r.ok, false);
});

test('principal axis recovers the tilt and projection is centered', () => {
  const xs = [];
  const ys = [];
  for (let i = 0; i < 200; i++) {
    const [x, y] = pos(40 * Math.sin(i * 0.1));
    xs.push(x);
    ys.push(y);
  }
  const ax = principalAxis(xs, ys);
  const angle = Math.atan2(Math.abs(ax.ux), Math.abs(ax.uy));
  assert.ok(Math.abs(angle - tilt) < 1e-6, `angle=${angle}`);
  const v = project(xs, ys).values;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(Math.abs(mean) < 1e-9);
  const range = Math.max(...v) - Math.min(...v);
  assert.ok(Math.abs(range - 80) < 0.5, `range=${range}`);
});
