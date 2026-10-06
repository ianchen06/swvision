import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFrequency, fitDampedSine } from '../src/fit.js';

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

function synth({ T, fps, duration, A = 40, gamma = 0.01, phi = 0.7, c = 90, noise = 0.05, seed = 1 }) {
  const rand = rng(seed);
  const t = [];
  const y = [];
  for (let i = 0; i * (1 / fps) < duration; i++) {
    const ti = i / fps + (rand() - 0.5) * 0.3 / fps; // timestamp jitter
    t.push(ti);
    y.push(A * Math.exp(-gamma * ti) * Math.cos((2 * Math.PI / T) * ti + phi) + c + noise * A * gaussian(rand));
  }
  return { t, y };
}

test('estimateFrequency finds the dominant frequency within 1%', () => {
  const { t, y } = synth({ T: 1.37, fps: 60, duration: 30 });
  const f = estimateFrequency(t, y);
  assert.ok(Math.abs(f - 1 / 1.37) / (1 / 1.37) < 0.01, `f=${f}`);
});

for (const T of [1.0, 1.37, 2.0]) {
  for (const fps of [30, 60]) {
    test(`fitDampedSine recovers T=${T}s at ${fps}fps within 0.05%`, () => {
      const { t, y } = synth({ T, fps, duration: 30, seed: Math.round(T * 100) + fps });
      const fit = fitDampedSine(t, y, estimateFrequency(t, y));
      const err = Math.abs(fit.T - T);
      assert.ok(err / T < 0.0005, `T=${fit.T}`);
      assert.ok(err < 3 * fit.sigmaT + 1e-6, `err=${err} sigma=${fit.sigmaT}`);
      assert.ok(fit.ok);
      assert.ok(fit.cycles > 14 && fit.cycles < 31);
    });
  }
}

test('fitDampedSine flags fits with fewer than 2 cycles', () => {
  const { t, y } = synth({ T: 1.37, fps: 60, duration: 2 });
  const fit = fitDampedSine(t, y, 1 / 1.37);
  assert.equal(fit.ok, false);
});

test('fitDampedSine recovers decay and amplitude', () => {
  const { t, y } = synth({ T: 1.5, fps: 60, duration: 30, gamma: 0.05, A: 30, noise: 0.02 });
  const fit = fitDampedSine(t, y, estimateFrequency(t, y));
  assert.ok(Math.abs(fit.gamma - 0.05) < 0.005, `gamma=${fit.gamma}`);
  assert.ok(Math.abs(fit.A - 30) < 1.5, `A=${fit.A}`);
  // evaluate() reproduces the model
  const v = fit.evaluate(t[100]);
  assert.ok(Math.abs(v - y[100]) < 5);
});

test('estimateFrequency returns null for too few samples', () => {
  assert.equal(estimateFrequency([0, 0.1, 0.2], [1, 2, 3]), null);
});
