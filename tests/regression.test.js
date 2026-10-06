// End-to-end check of the file-mode pipeline on assets/IMG_7825.MOV.
// Generate the fixture with scripts/make-fixture.sh; skipped when absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Background } from '../src/background.js';
import { track } from '../src/tracker.js';
import { Session } from '../src/session.js';

const W = 108;
const H = 192;
const BIN = new URL('./fixtures/img7825_gray.bin', import.meta.url);
const PTS = new URL('./fixtures/img7825_pts.txt', import.meta.url);
const present = existsSync(BIN) && existsSync(PTS);

test('IMG_7825.MOV yields T = 1.3684 ± 0.001 s', { skip: !present && 'fixture missing' }, () => {
  const raw = readFileSync(BIN);
  const times = readFileSync(PTS, 'utf8').trim().split('\n').map(Number);
  const n = Math.min(times.length, Math.floor(raw.length / (W * H)));
  const frame = (i) => raw.subarray(i * W * H, (i + 1) * W * H);

  // File mode: pre-fill the background with 40 evenly spaced frames.
  const bg = new Background({ capacity: 40 });
  for (let k = 0; k < 40; k++) bg.push(frame(Math.floor(((k + 0.5) * n) / 40)), W, H);
  const median = bg.median();

  const session = new Session();
  let okCount = 0;
  for (let i = 0; i < n; i++) {
    const r = track(frame(i), median, W, H);
    okCount += r.ok;
    session.add({ t: times[i], ...r });
  }
  assert.ok(okCount / n > 0.95, `tracked ${okCount}/${n}`);

  const { fit, valid } = session.fitRange(0, Infinity);
  assert.ok(valid);
  assert.ok(Math.abs(fit.T - 1.3684) < 0.001, `T=${fit.T} ± ${fit.sigmaT}`);
  console.log(`T=${fit.T.toFixed(5)} ± ${fit.sigmaT.toFixed(5)} s, cycles=${fit.cycles.toFixed(1)}, rms=${fit.rms.toFixed(2)}px, A=${fit.A.toFixed(1)}px`);

  // Trimmed range agrees.
  const late = session.fitRange(15, 44);
  assert.ok(Math.abs(late.fit.T - 1.3678) < 0.001, `late T=${late.fit.T}`);
});
