import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, isConfigured, HISTORY_LIMIT, RATE_LIMIT_MESSAGE } from '../src/account.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Chainable stand-in for a supabase-js client; records every call. */
function fakeClient({ result = { data: null, error: null }, otp = { data: {}, error: null }, throwOn } = {}) {
  const calls = [];
  const query = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(result).then(res, rej);
      return (...args) => {
        if (prop === throwOn) throw new Error('boom');
        calls.push([prop, ...args]);
        return query;
      };
    },
  });
  let listener;
  return {
    calls,
    emit: (session) => listener('SIGNED_IN', session),
    auth: {
      async signInWithOtp(args) { calls.push(['signInWithOtp', args]); return otp; },
      async signOut() { calls.push(['signOut']); return { error: null }; },
      onAuthStateChange(cb) {
        listener = cb;
        cb('INITIAL_SESSION', null);
        return { data: { subscription: { unsubscribe: () => calls.push(['unsubscribe']) } } };
      },
    },
    from(table) { calls.push(['from', table]); return query; },
  };
}

const opts = { redirectTo: 'http://localhost:8000/' };

test('isConfigured rejects placeholders and blanks', () => {
  assert.equal(isConfigured('https://<project-ref>.supabase.co', '<publishable key>'), false);
  assert.equal(isConfigured('', 'sb_publishable_x'), false);
  assert.equal(isConfigured('https://abc.supabase.co', ''), false);
  assert.equal(isConfigured('https://abc.supabase.co', 'sb_publishable_x'), true);
});

test('sendMagicLink trims the email and passes the redirect', async () => {
  const c = fakeClient();
  const r = await createAccount(c, opts).sendMagicLink('  me@example.com ');
  assert.deepEqual(r, { data: {} });
  assert.deepEqual(c.calls, [['signInWithOtp', { email: 'me@example.com', options: { emailRedirectTo: opts.redirectTo } }]]);
});

test('sendMagicLink rejects an invalid email without calling Supabase', async () => {
  const c = fakeClient();
  const r = await createAccount(c, opts).sendMagicLink('not-an-email');
  assert.equal(r.error, 'Enter a valid email address.');
  assert.deepEqual(c.calls, []);
});

test('sendMagicLink maps rate limiting to a friendly message', async () => {
  const c = fakeClient({ otp: { data: null, error: { status: 429, message: 'email rate limit exceeded' } } });
  const r = await createAccount(c, opts).sendMagicLink('me@example.com');
  assert.deepEqual(r, { error: RATE_LIMIT_MESSAGE });
});

test('listMeasurements queries newest first with the limit', async () => {
  const rows = [{ id: '1' }];
  const c = fakeClient({ result: { data: rows, error: null } });
  const r = await createAccount(c, opts).listMeasurements();
  assert.deepEqual(r, { data: rows });
  assert.deepEqual(c.calls, [
    ['from', 'measurements'], ['select', '*'], ['order', 'created_at', { ascending: false }], ['limit', HISTORY_LIMIT],
  ]);
});

test('saveMeasurement inserts and returns the row', async () => {
  const c = fakeClient({ result: { data: { id: 'new' }, error: null } });
  const r = await createAccount(c, opts).saveMeasurement({ mass_g: 320 });
  assert.deepEqual(r, { data: { id: 'new' } });
  assert.deepEqual(c.calls, [['from', 'measurements'], ['insert', { mass_g: 320 }], ['select'], ['single']]);
});

test('deleteMeasurement filters by id', async () => {
  const c = fakeClient();
  await createAccount(c, opts).deleteMeasurement('abc');
  assert.deepEqual(c.calls, [['from', 'measurements'], ['delete'], ['eq', 'id', 'abc']]);
});

test('Supabase errors and thrown exceptions become { error }', async () => {
  const a = createAccount(fakeClient({ result: { data: null, error: { message: 'permission denied' } } }), opts);
  assert.deepEqual(await a.listMeasurements(), { error: 'permission denied' });
  const b = createAccount(fakeClient({ throwOn: 'insert' }), opts);
  assert.deepEqual(await b.saveMeasurement({}), { error: 'boom' });
});

test('onAuthChange delivers users asynchronously and unsubscribes', async () => {
  const c = fakeClient();
  const seen = [];
  const off = createAccount(c, opts).onAuthChange((u) => seen.push(u));
  assert.deepEqual(seen, []); // deferred, never inside the supabase callback
  await tick();
  c.emit({ user: { id: 'u1', email: 'me@example.com' } });
  await tick();
  assert.deepEqual(seen, [null, { id: 'u1', email: 'me@example.com' }]);
  off();
  assert.deepEqual(c.calls.at(-1), ['unsubscribe']);
});
