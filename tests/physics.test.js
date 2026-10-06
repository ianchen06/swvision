import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingweight, G_CM } from '../src/physics.js';

test('uniform rod pivoted at one end round-trips', () => {
  // Rod of length 68 cm, mass 300 g, pivot at the far end (68 cm from "butt").
  const l = 68, m = 0.3;
  const T = 2 * Math.PI * Math.sqrt((2 * l) / (3 * G_CM));
  const r = swingweight({ massG: 300, balanceCm: l / 2, pivotCm: l, periodS: T });
  const Icm = (m * l * l) / 12;
  assert.ok(Math.abs(r.Icm - Icm) / Icm < 1e-4, `Icm=${r.Icm}`);
  assert.ok(Math.abs(r.Ip - (m * l * l) / 3) / r.Ip < 1e-4);
  const sw = Icm + m * (l / 2 - 10) ** 2;
  assert.ok(Math.abs(r.SW - sw) / sw < 1e-4);
});

test('hand-checked racket case', () => {
  const r = swingweight({ massG: 320, balanceCm: 32, pivotCm: 67, periodS: 1.36835 });
  assert.ok(Math.abs(r.SW - 283.8) < 0.1, `SW=${r.SW}`);
  assert.ok(Math.abs(r.d - 35) < 1e-9);
  // Hanging from the head: SW is very sensitive to pivot position.
  assert.ok(Math.abs(r.sensitivity.perCmPivot) > 5);
  assert.ok(r.sigmaSW > 0 && r.sigmaSW < 10);
});

test('pivot below the balance point (hung from the handle) works', () => {
  const r = swingweight({ massG: 320, balanceCm: 32, pivotCm: 10, periodS: 1.28 });
  assert.equal(r.error, undefined);
  assert.ok(Math.abs(r.d - 22) < 1e-9);
});

test('amplitude correction shortens the effective period', () => {
  const a = swingweight({ massG: 320, balanceCm: 32, pivotCm: 67, periodS: 1.36835 });
  const b = swingweight({ massG: 320, balanceCm: 32, pivotCm: 67, periodS: 1.36835, amplitudeDeg: 10 });
  assert.ok(b.SW < a.SW && a.SW - b.SW < 5);
});

test('invalid inputs return an error', () => {
  assert.ok(swingweight({ massG: 320, balanceCm: 32, pivotCm: 32, periodS: 1.3 }).error);
  assert.ok(swingweight({ massG: 0, balanceCm: 32, pivotCm: 67, periodS: 1.3 }).error);
  assert.ok(swingweight({ massG: 320, balanceCm: 32, pivotCm: 67, periodS: 0 }).error);
  // L <= d: period too short for that pivot distance
  assert.ok(swingweight({ massG: 320, balanceCm: 32, pivotCm: 67, periodS: 0.5 }).error);
  assert.ok(swingweight({ massG: NaN, balanceCm: 32, pivotCm: 67, periodS: 1.3 }).error);
});
