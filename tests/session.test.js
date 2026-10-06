import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';

function feed(session, { T, fps, from, to, A = 40, noise = 1, lostEvery = 0 }) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5);
  const snaps = [];
  let nextUpdate = from;
  for (let i = Math.ceil(from * fps); i / fps < to; i++) {
    const t = i / fps;
    const s = A * Math.cos((2 * Math.PI * t) / T);
    const ok = !(lostEvery && i % lostEvery === 0);
    session.add({ t, x: 50 + 0.3 * s + noise * rand(), y: 100 + s + noise * rand(), ok });
    if (t >= nextUpdate) {
      snaps.push(session.update());
      nextUpdate += 0.25;
    }
  }
  return snaps;
}

test('session moves from idle to measuring to locked', () => {
  const s = new Session();
  assert.equal(s.update().state, 'idle');
  const snaps = feed(s, { T: 1.37, fps: 30, from: 0, to: 25 });
  const states = [...new Set(snaps.map((x) => x.state))];
  assert.deepEqual(states, ['measuring', 'locked']);
  const last = snaps.at(-1);
  assert.ok(Math.abs(last.final.T - 1.37) / 1.37 < 0.0005, `T=${last.final.T}`);
  // No lock before 10 cycles.
  const firstLock = snaps.find((x) => x.state === 'locked');
  assert.ok(firstLock.cycles >= 10);
});

test('session does not report a window estimate before 4 cycles', () => {
  const s = new Session();
  const snaps = feed(s, { T: 1.37, fps: 30, from: 0, to: 4 });
  assert.ok(snaps.every((x) => x.window === null || x.window.cycles >= 4));
  assert.equal(snaps.at(-1).state, 'measuring');
});

test('frames marked not ok are excluded', () => {
  const s = new Session();
  feed(s, { T: 1.2, fps: 60, from: 0, to: 20, lostEvery: 5 });
  const r = s.fitRange(0, 20);
  assert.ok(r.fit.ok);
  assert.ok(Math.abs(r.fit.T - 1.2) / 1.2 < 0.0005);
  assert.equal(r.t.length, Math.round(20 * 60 * 0.8));
});

test('reset clears state', () => {
  const s = new Session();
  feed(s, { T: 1.37, fps: 30, from: 0, to: 25 });
  s.reset();
  assert.equal(s.update().state, 'idle');
});

test('buffer keeps only the last bufferS seconds', () => {
  const s = new Session({ bufferS: 10 });
  feed(s, { T: 1.37, fps: 30, from: 0, to: 30 });
  assert.ok(s.samples[0].t >= 19.9);
});
