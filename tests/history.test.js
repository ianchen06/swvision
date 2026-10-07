import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingweight } from '../src/physics.js';
import { buildRecord, recordKey, saveButtonState, formatRow } from '../src/history.js';

const inputs = { massG: 320, balanceCm: 32, pivotCm: 67, amplitudeDeg: 0, g: 980.665 };
const period = { T: 1.36835, sigmaT: 0.00002, final: true, cycles: 9.5 };
const result = swingweight({ ...inputs, periodS: period.T, periodSigmaS: period.sigmaT });
const base = { inputs, period, result, racket: '', note: '', source: 'live' };

test('buildRecord maps a final result to DB columns', () => {
  const r = buildRecord({ ...base, racket: '  Pure Aero ', note: ' lead @12 ' });
  assert.deepEqual(Object.keys(r).sort(), [
    'amplitude_deg', 'balance_cm', 'cycles', 'g', 'i_cm', 'i_pivot', 'mass_g', 'note', 'period_s',
    'period_sigma_s', 'pivot_cm', 'racket', 'source', 'swingweight', 'swingweight_sigma',
  ]);
  assert.equal(r.racket, 'Pure Aero');
  assert.equal(r.note, 'lead @12');
  assert.equal(r.mass_g, 320);
  assert.equal(r.period_s, 1.36835);
  assert.equal(r.cycles, 9.5);
  assert.equal(r.source, 'live');
  assert.ok(Math.abs(r.swingweight - 283.8) < 0.1);
  assert.equal(r.swingweight_sigma, result.sigmaSW);
  assert.equal(r.i_pivot, result.Ip);
  assert.equal(r.i_cm, result.Icm);
});

test('buildRecord turns blank labels and unknown source into null', () => {
  const r = buildRecord({ ...base, racket: '   ', note: undefined, source: 'bogus' });
  assert.equal(r.racket, null);
  assert.equal(r.note, null);
  assert.equal(r.source, null);
});

test('buildRecord refuses non-final, missing or errored results', () => {
  assert.equal(buildRecord({ ...base, period: { ...period, final: false } }), null);
  assert.equal(buildRecord({ ...base, period: null }), null);
  assert.equal(buildRecord({ ...base, result: null }), null);
  assert.equal(buildRecord({ ...base, result: { error: 'Mass must be positive' } }), null);
  assert.equal(buildRecord({ ...base, inputs: { ...inputs, massG: NaN } }), null);
});

test('recordKey ignores labels but tracks measurement values', () => {
  const a = buildRecord(base);
  const b = buildRecord({ ...base, racket: 'X', note: 'Y' });
  const c = buildRecord({ ...base, inputs: { ...inputs, pivotCm: 67.2 } });
  assert.equal(recordKey(a), recordKey(b));
  assert.notEqual(recordKey(a), recordKey(c));
});

test('saveButtonState covers hidden, ready, saving and saved', () => {
  const record = buildRecord(base);
  assert.deepEqual(saveButtonState({ signedIn: false, record, savedKey: null, saving: false }), { visible: false });
  assert.deepEqual(saveButtonState({ signedIn: true, record: null, savedKey: null, saving: false }), { visible: false });
  assert.deepEqual(saveButtonState({ signedIn: true, record, savedKey: null, saving: false }),
    { visible: true, disabled: false, label: 'Save' });
  assert.deepEqual(saveButtonState({ signedIn: true, record, savedKey: null, saving: true }),
    { visible: true, disabled: true, label: 'Saving…' });
  assert.deepEqual(saveButtonState({ signedIn: true, record, savedKey: recordKey(record), saving: false }),
    { visible: true, disabled: true, label: 'Saved ✓' });
  const changed = buildRecord({ ...base, inputs: { ...inputs, massG: 321 } });
  assert.equal(saveButtonState({ signedIn: true, record: changed, savedKey: recordKey(record), saving: false }).label, 'Save');
});

test('formatRow produces display strings', () => {
  const row = {
    id: 'abc', created_at: '2026-10-07T12:34:00Z', racket: 'Pure Aero', note: 'lead',
    mass_g: 320.5, balance_cm: 32, pivot_cm: 67, swingweight: 329.44, swingweight_sigma: 1.23,
  };
  const f = formatRow(row);
  assert.equal(f.id, 'abc');
  assert.equal(f.racket, 'Pure Aero');
  assert.equal(f.sw, '329.4 ± 1.2');
  assert.equal(f.inputs, '320.5 g · 32.0 cm · 67.0 cm');
  assert.equal(f.note, 'lead');
  assert.ok(f.date.length > 0 && f.date !== 'Invalid Date');
});

test('formatRow handles missing optional fields', () => {
  const f = formatRow({
    id: 'x', created_at: '2026-10-07T12:34:00Z', racket: null, note: null,
    mass_g: 320, balance_cm: 32, pivot_cm: 67, swingweight: 283.8, swingweight_sigma: null,
  });
  assert.equal(f.racket, 'Unnamed racket');
  assert.equal(f.sw, '283.8');
  assert.equal(f.inputs, '320 g · 32.0 cm · 67.0 cm');
  assert.equal(f.note, '');
});
