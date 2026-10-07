# User Login and Saved History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users sign in with a Supabase email magic link, save final swingweight results, and view/delete their saved history.

**Architecture:** Pure helpers (`src/history.js`) build records and decide save-button state; `src/account.js` wraps a Supabase client behind a small `{data}|{error}` API and lazily loads `supabase-js` from a pinned CDN URL; `src/accountUi.js` owns the Account card, Save row and History card DOM. `src/ui.js` only reports each computed result to `accountUi.resultChanged(...)`. A failed CDN load or missing config leaves measuring untouched.

**Tech Stack:** Vanilla ES modules, no build step; `@supabase/supabase-js@2.117.3` via `https://esm.sh/`; Supabase Postgres with RLS; `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-10-07-user-login-history-design.md`

## Global Constraints

- No build step and no npm runtime dependencies; the only remote module is `https://esm.sh/@supabase/supabase-js@2.117.3`, loaded with dynamic `import()` inside `loadAccount()`.
- No module statically imported by `src/ui.js` may import a network URL (so `node --test` and offline use keep working).
- Only the publishable/anon key goes in `src/config.js`; never a secret/service_role key.
- Measuring must work when signed out, when Supabase is unreachable, and when `src/config.js` still has placeholders.
- History shows the newest 50 rows (`HISTORY_LIMIT = 50`).
- Only results with `period.final === true` and no `result.error` can be saved.
- User-supplied text (racket, note, email) is rendered with `textContent`, never `innerHTML`.
- Copy: "Check your email", "Too many emails, try again later.", "No saved measurements yet.", "Sign-in unavailable.", button states "Save" / "Saving…" / "Saved ✓".

## Review Focus

1. Supabase CDN unreachable or config placeholders → Account card says "Sign-in unavailable…", measuring/result card behave exactly as before. (Task 2 `isConfigured` tests; Task 3 preview check.)
2. Double-click on Save, or Save pressed again for the same numbers → exactly one row; button shows "Saving…" then "Saved ✓" and stays disabled until the measurement changes. (Task 1 `saveButtonState` tests.)
3. Magic-link rate limit (HTTP 429) or invalid email → friendly inline message, no thrown error. (Task 2 tests.)
4. Racket/note containing HTML like `<img src=x onerror=alert(1)>` → shown literally. (Task 4 grep step + `textContent` only.)
5. Provisional (not final) result, or a physics error → Save row hidden. (Task 1 `buildRecord` tests.)

---

## File map

| File | Responsibility |
|---|---|
| `src/history.js` (new) | Pure: `buildRecord`, `recordKey`, `saveButtonState`, `formatRow` |
| `src/account.js` (new) | `createAccount(client, opts)`, `isConfigured(url, key)`, `loadAccount()` |
| `src/config.js` (new) | `SUPABASE_URL`, `SUPABASE_KEY` (placeholders until the user supplies them) |
| `src/accountUi.js` (new) | DOM wiring for Account card, Save row, History card; `initAccountUi()` |
| `supabase/schema.sql` (new) | Table, index, grants, RLS policies |
| `src/ui.js` (modify) | Create `accountUi`, call `resultChanged` from `renderResult` |
| `index.html`, `styles.css`, `README.md` (modify) | Markup, styles, setup docs |
| `tests/history.test.js`, `tests/account.test.js` (new) | Unit tests |

---

### Task 1: Pure history helpers

**Files:**
- Create: `src/history.js`
- Test: `tests/history.test.js`

**Interfaces:**
- Consumes: `swingweight` from `src/physics.js` (tests only). Its result has `SW, sigmaSW, Ip, Icm` or `error`.
- Produces:
  - `buildRecord({ inputs, period, result, racket, note, source }) → Record | null` where `inputs = { massG, balanceCm, pivotCm, amplitudeDeg, g }`, `period = { T, sigmaT, final, cycles? }`, `source ∈ 'live'|'file'`. `Record` keys are the DB column names (snake_case, no `id/user_id/created_at`).
  - `recordKey(record) → string` (ignores `racket` and `note`).
  - `saveButtonState({ signedIn, record, savedKey, saving }) → { visible: boolean, disabled?: boolean, label?: string }`.
  - `formatRow(row) → { id, date, racket, sw, inputs, note }` (all strings except `id`).

- [ ] **Step 1: Write the failing tests**

`tests/history.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/history.test.js`
Expected: FAIL — `Cannot find module '.../src/history.js'`.

- [ ] **Step 3: Implement `src/history.js`**

```js
// Pure helpers for saved measurements: record building, save-button state, display.

const SOURCES = new Set(['live', 'file']);

const clean = (s) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t === '' ? null : t;
};

/** DB row for a final, error-free result, or null if it must not be saved. */
export function buildRecord({ inputs, period, result, racket, note, source }) {
  if (!period?.final || !result || result.error) return null;
  if (![inputs?.massG, inputs?.balanceCm, inputs?.pivotCm].every(Number.isFinite)) return null;
  return {
    racket: clean(racket),
    note: clean(note),
    mass_g: inputs.massG,
    balance_cm: inputs.balanceCm,
    pivot_cm: inputs.pivotCm,
    amplitude_deg: inputs.amplitudeDeg,
    g: inputs.g,
    period_s: period.T,
    period_sigma_s: period.sigmaT ?? null,
    cycles: period.cycles ?? null,
    source: SOURCES.has(source) ? source : null,
    swingweight: result.SW,
    swingweight_sigma: result.sigmaSW ?? null,
    i_pivot: result.Ip,
    i_cm: result.Icm,
  };
}

/** Identity of the measurement itself; labels don't make it a new measurement. */
export function recordKey(record) {
  const { racket, note, ...rest } = record;
  return JSON.stringify(rest);
}

export function saveButtonState({ signedIn, record, savedKey, saving }) {
  if (!signedIn || !record) return { visible: false };
  if (saving) return { visible: true, disabled: true, label: 'Saving…' };
  if (savedKey === recordKey(record)) return { visible: true, disabled: true, label: 'Saved ✓' };
  return { visible: true, disabled: false, label: 'Save' };
}

const num = (v) => String(Number(v.toFixed(1)));

export function formatRow(row) {
  return {
    id: row.id,
    date: new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    racket: row.racket || 'Unnamed racket',
    sw: row.swingweight_sigma != null
      ? `${row.swingweight.toFixed(1)} ± ${row.swingweight_sigma.toFixed(1)}`
      : row.swingweight.toFixed(1),
    inputs: `${num(row.mass_g)} g · ${row.balance_cm.toFixed(1)} cm · ${row.pivot_cm.toFixed(1)} cm`,
    note: row.note || '',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (29 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/history.js tests/history.test.js
git commit -m "Add pure helpers for saved measurement records"
```

---

### Task 2: Supabase account module, config and schema

**Files:**
- Create: `src/account.js`, `src/config.js`, `supabase/schema.sql`
- Test: `tests/account.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `isConfigured(url, key) → boolean`
  - `createAccount(client, { redirectTo }) → Account`
  - `loadAccount() → Promise<Account>` (rejects with `Error('Sign-in is not configured.')` on placeholders, or with the import error if the CDN fails)
  - `Account` = `{ onAuthChange(cb: (user|null) => void) → unsubscribe(), sendMagicLink(email) , signOut(), saveMeasurement(record), listMeasurements(), deleteMeasurement(id) }`; every method except `onAuthChange` resolves to `{ data }` or `{ error: string }` and never rejects. `onAuthChange` delivers callbacks asynchronously (`setTimeout 0`) so callers may call other Supabase methods inside them without deadlocking supabase-js.
  - Constants `HISTORY_LIMIT = 50`, `RATE_LIMIT_MESSAGE = 'Too many emails, try again later.'`.

- [ ] **Step 1: Write the failing tests**

`tests/account.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/account.test.js`
Expected: FAIL — `Cannot find module '.../src/account.js'`.

- [ ] **Step 3: Implement `src/account.js`**

```js
// Supabase auth + measurements table behind a small { data } | { error } API.
// supabase-js is imported lazily from a pinned CDN URL so a network failure
// only disables account features, never the measuring app.

const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.117.3';
const TABLE = 'measurements';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const HISTORY_LIMIT = 50;
export const RATE_LIMIT_MESSAGE = 'Too many emails, try again later.';

export function isConfigured(url, key) {
  return [url, key].every((v) => typeof v === 'string' && v.trim() !== '' && !v.includes('<'));
}

function message(error) {
  if (error.status === 429 || /rate limit/i.test(error.message ?? '')) return RATE_LIMIT_MESSAGE;
  return error.message || String(error);
}

async function run(fn) {
  try {
    const { data, error } = await fn();
    return error ? { error: message(error) } : { data };
  } catch (e) {
    return { error: e?.message || 'Network error' };
  }
}

export function createAccount(client, { redirectTo }) {
  return {
    onAuthChange(cb) {
      // supabase-js deadlocks if its own methods are awaited inside this callback; defer.
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => cb(session?.user ?? null), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async sendMagicLink(email) {
      const e = String(email ?? '').trim();
      if (!EMAIL_RE.test(e)) return { error: 'Enter a valid email address.' };
      return run(() => client.auth.signInWithOtp({ email: e, options: { emailRedirectTo: redirectTo } }));
    },
    signOut: () => run(() => client.auth.signOut()),
    saveMeasurement: (record) => run(() => client.from(TABLE).insert(record).select().single()),
    listMeasurements: () =>
      run(() => client.from(TABLE).select('*').order('created_at', { ascending: false }).limit(HISTORY_LIMIT)),
    deleteMeasurement: (id) => run(() => client.from(TABLE).delete().eq('id', id)),
  };
}

export async function loadAccount() {
  const { SUPABASE_URL, SUPABASE_KEY } = await import('./config.js');
  if (!isConfigured(SUPABASE_URL, SUPABASE_KEY)) throw new Error('Sign-in is not configured.');
  const { createClient } = await import(SUPABASE_JS);
  const client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return createAccount(client, { redirectTo: location.origin + location.pathname });
}
```

- [ ] **Step 4: Create `src/config.js`**

```js
// Supabase project settings (Project Settings → API Keys).
// The publishable/anon key is public by design; RLS protects the data.
// Never put the secret/service_role key here.
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_KEY = '<publishable key>';
```

- [ ] **Step 5: Create `supabase/schema.sql`**

```sql
-- Run once in the Supabase SQL Editor.
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  racket text,
  note text,
  mass_g real not null,
  balance_cm real not null,
  pivot_cm real not null,
  amplitude_deg real not null,
  g real not null,
  period_s real not null,
  period_sigma_s real,
  cycles real,
  source text check (source in ('live', 'file')),
  swingweight real not null,
  swingweight_sigma real,
  i_pivot real,
  i_cm real
);

create index measurements_user_created_idx on public.measurements (user_id, created_at desc);

alter table public.measurements enable row level security;

grant select, insert, delete on public.measurements to authenticated;

create policy "select own measurements" on public.measurements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own measurements" on public.measurements
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own measurements" on public.measurements
  for delete to authenticated using ((select auth.uid()) = user_id);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (including 9 new in `account.test.js`).

- [ ] **Step 7: Commit**

```bash
git add src/account.js src/config.js supabase/schema.sql tests/account.test.js
git commit -m "Add Supabase account module, config placeholder and schema"
```

---

### Task 3: Account card (sign in / sign out) and docs

**Files:**
- Create: `src/accountUi.js`
- Modify: `index.html` (top of `<section class="panel-col">`), `styles.css` (append), `src/ui.js` (imports + after `state`), `README.md`

**Interfaces:**
- Consumes: `loadAccount()` from Task 2.
- Produces: `initAccountUi() → { resultChanged(snapshot | null) }` where `snapshot = { inputs, period, result, source }` (Task 4 fills in the save/history behaviour behind the same function).

- [ ] **Step 1: Add the Account card to `index.html`** as the first child of `<section class="panel-col">`:

```html
        <div class="card" id="account">
          <h2>Account</h2>
          <p id="account-status" class="note">Loading sign-in…</p>
          <form id="signin" class="account-row" hidden>
            <input id="email" type="email" required placeholder="you@example.com" autocomplete="email" />
            <button id="btn-send-link" class="primary" type="submit">Send link</button>
          </form>
          <div id="signed-in" class="account-row" hidden>
            <span>Signed in as <strong id="user-email"></strong></span>
            <button id="btn-signout" type="button">Sign out</button>
          </div>
          <p id="account-note" class="note"></p>
        </div>
```

- [ ] **Step 2: Append to `styles.css`**

```css
.account-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.account-row input, .save input {
  flex: 1 1 160px; min-width: 0; font: inherit; padding: 6px 8px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink);
}
```

- [ ] **Step 3: Create `src/accountUi.js`** (sign-in part only; Task 4 extends it)

```js
// Account card, Save row and History card. Everything Supabase-related is
// optional: if loading fails the measuring app is unaffected.
import { loadAccount } from './account.js';

const $ = (id) => document.getElementById(id);

export function initAccountUi() {
  const el = {
    status: $('account-status'), signin: $('signin'), email: $('email'), btnSend: $('btn-send-link'),
    signedIn: $('signed-in'), userEmail: $('user-email'), btnSignOut: $('btn-signout'), note: $('account-note'),
  };
  const state = { account: null, user: null, snapshot: null };

  const setNote = (node, text, isError = false) => {
    node.textContent = text;
    node.classList.toggle('error', isError);
  };

  function renderAccount() {
    const signedIn = !!state.user;
    el.status.hidden = true;
    el.signin.hidden = signedIn;
    el.signedIn.hidden = !signedIn;
    if (signedIn) el.userEmail.textContent = state.user.email ?? 'anonymous';
  }

  el.signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.btnSend.disabled = true;
    setNote(el.note, 'Sending…');
    const email = el.email.value.trim();
    const { error } = await state.account.sendMagicLink(email);
    el.btnSend.disabled = false;
    setNote(el.note, error ?? `Check your email (${email}) for a sign-in link.`, !!error);
  });

  el.btnSignOut.addEventListener('click', async () => {
    const { error } = await state.account.signOut();
    if (error) setNote(el.note, `Could not sign out: ${error}`, true);
  });

  loadAccount()
    .then((account) => {
      state.account = account;
      account.onAuthChange((user) => {
        const changed = user?.id !== state.user?.id;
        state.user = user;
        if (changed) setNote(el.note, '');
        renderAccount();
      });
    })
    .catch((err) => {
      console.warn('Account features unavailable:', err);
      setNote(el.status, /not configured/.test(err?.message) ? 'Sign-in unavailable: not configured.' : 'Sign-in unavailable.', true);
    });

  return {
    resultChanged(snapshot) {
      state.snapshot = snapshot;
    },
  };
}
```

- [ ] **Step 4: Wire into `src/ui.js`**

Add after the existing imports:

```js
import { initAccountUi } from './accountUi.js';
```

Add directly after the `const state = { ... };` block:

```js
const accountUi = initAccountUi();
```

- [ ] **Step 5: Update `README.md`**

Replace the line `No build step, no dependencies, everything runs client-side.` with:

```markdown
No build step and no npm dependencies; measuring runs entirely client-side.
Optional sign-in and saved history use Supabase (`supabase-js` is loaded from
esm.sh at runtime — if it can't load, everything except saving still works).
```

Add a section after `## Measure`:

```markdown
## Accounts and history (optional)

1. In the Supabase SQL Editor, run `supabase/schema.sql`.
2. Authentication → URL Configuration: set the Site URL and add every origin you
   serve from (e.g. `http://localhost:8000`) to Redirect URLs.
3. Put the project URL and publishable key in `src/config.js`. The publishable
   key is public; row-level security restricts each user to their own rows.
   Never put the secret/service_role key in the app.

Sign in with an email magic link, press *Save* on a final result, and manage
saved results in the History card. Supabase's built-in email sender allows only
a few emails per hour.
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass (no test imports `accountUi.js`).

- [ ] **Step 7: Verify in the browser preview (config still has placeholders)**

`preview_start` with `swvision`, then:
- `preview_console_logs` level `error`: no errors (one `console.warn` "Account features unavailable" is expected).
- `preview_snapshot`: Account card shows "Sign-in unavailable: not configured."; Swing, Racket, Swingweight cards render as before.
- Click `#tab-file`, click `#btn-sample` only if `assets/IMG_7825.MOV` exists (it is gitignored); otherwise confirm the tabs still switch. Measuring must not depend on account state.

- [ ] **Step 8: Commit**

```bash
git add src/accountUi.js src/ui.js index.html styles.css README.md
git commit -m "Add Account card with magic-link sign-in"
```

---

### Task 4: Save row and History card

**Files:**
- Modify: `index.html` (Swingweight card + new History card), `styles.css` (append), `src/accountUi.js`, `src/ui.js` (`renderResult`, around lines 537–575)

**Interfaces:**
- Consumes: `buildRecord`, `recordKey`, `saveButtonState`, `formatRow` (Task 1); `Account` methods (Task 2); `initAccountUi` (Task 3).
- Produces: user-visible Save/History behaviour. `resultChanged(snapshot|null)` now re-renders the Save row.

- [ ] **Step 1: Add markup to `index.html`**

Inside `<div class="card result">`, after `<p id="sens" class="note"></p>`:

```html
          <form id="save" class="save" hidden>
            <input id="save-racket" placeholder="Racket (optional)" maxlength="80" />
            <input id="save-note" placeholder="Note (optional)" maxlength="200" />
            <button id="btn-save" class="primary" type="submit">Save</button>
            <p id="save-msg" class="note"></p>
          </form>
```

After the closing `</div>` of the result card (still inside `panel-col`):

```html
        <div class="card" id="history" hidden>
          <h2>History</h2>
          <p id="history-msg" class="note"></p>
          <button id="btn-history-retry" class="link" type="button" hidden>Retry</button>
          <ul id="history-list" class="history"></ul>
        </div>
```

- [ ] **Step 2: Append to `styles.css`**

```css
.save { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.save .note { width: 100%; }
.history { list-style: none; margin: 0; padding: 0; }
.history li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 8px 0; border-top: 1px solid var(--line); }
.history li:first-child { border-top: none; }
.history .h-main { display: flex; gap: 8px; align-items: baseline; }
.history .h-main strong { font-variant-numeric: tabular-nums; }
.history .h-meta { grid-column: 1; color: var(--muted); font-size: 13px; }
.history li button { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
```

- [ ] **Step 3: Replace `src/accountUi.js` with the full version**

```js
// Account card, Save row and History card. Everything Supabase-related is
// optional: if loading fails the measuring app is unaffected.
import { loadAccount } from './account.js';
import { buildRecord, recordKey, saveButtonState, formatRow } from './history.js';

const $ = (id) => document.getElementById(id);

export function initAccountUi() {
  const el = {
    status: $('account-status'), signin: $('signin'), email: $('email'), btnSend: $('btn-send-link'),
    signedIn: $('signed-in'), userEmail: $('user-email'), btnSignOut: $('btn-signout'), note: $('account-note'),
    save: $('save'), racket: $('save-racket'), saveNote: $('save-note'), btnSave: $('btn-save'), saveMsg: $('save-msg'),
    history: $('history'), historyMsg: $('history-msg'), btnRetry: $('btn-history-retry'), list: $('history-list'),
  };
  const state = { account: null, user: null, snapshot: null, saving: false, savedKey: null };

  const setNote = (node, text, isError = false) => {
    node.textContent = text;
    node.classList.toggle('error', isError);
  };

  // ---------- account ----------

  function renderAccount() {
    const signedIn = !!state.user;
    el.status.hidden = true;
    el.signin.hidden = signedIn;
    el.signedIn.hidden = !signedIn;
    el.history.hidden = !signedIn;
    if (signedIn) el.userEmail.textContent = state.user.email ?? 'anonymous';
    renderSave();
  }

  el.signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.btnSend.disabled = true;
    setNote(el.note, 'Sending…');
    const email = el.email.value.trim();
    const { error } = await state.account.sendMagicLink(email);
    el.btnSend.disabled = false;
    setNote(el.note, error ?? `Check your email (${email}) for a sign-in link.`, !!error);
  });

  el.btnSignOut.addEventListener('click', async () => {
    const { error } = await state.account.signOut();
    if (error) setNote(el.note, `Could not sign out: ${error}`, true);
  });

  // ---------- save ----------

  function currentRecord() {
    if (!state.snapshot) return null;
    return buildRecord({ ...state.snapshot, racket: el.racket.value, note: el.saveNote.value });
  }

  function renderSave() {
    const s = saveButtonState({
      signedIn: !!state.user, record: currentRecord(), savedKey: state.savedKey, saving: state.saving,
    });
    el.save.hidden = !s.visible;
    if (!s.visible) return;
    el.btnSave.disabled = s.disabled;
    el.btnSave.textContent = s.label;
  }

  el.save.addEventListener('submit', async (e) => {
    e.preventDefault();
    const record = currentRecord();
    if (!record || state.saving) return;
    state.saving = true;
    setNote(el.saveMsg, '');
    renderSave();
    const { error } = await state.account.saveMeasurement(record);
    state.saving = false;
    if (error) {
      setNote(el.saveMsg, `Could not save: ${error}`, true);
    } else {
      state.savedKey = recordKey(record);
      loadHistory();
    }
    renderSave();
  });

  // ---------- history ----------

  async function loadHistory() {
    el.btnRetry.hidden = true;
    setNote(el.historyMsg, 'Loading…');
    const { data, error } = await state.account.listMeasurements();
    if (!state.user) return; // signed out while loading
    if (error) {
      setNote(el.historyMsg, `Could not load history: ${error}`, true);
      el.btnRetry.hidden = false;
      return;
    }
    el.list.replaceChildren(...data.map(rowItem));
    setNote(el.historyMsg, data.length ? '' : 'No saved measurements yet.');
  }

  function rowItem(row) {
    const f = formatRow(row);
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'h-main';
    const sw = document.createElement('strong');
    sw.textContent = f.sw;
    const racket = document.createElement('span');
    racket.textContent = f.racket;
    main.append(sw, racket);
    const meta = document.createElement('div');
    meta.className = 'h-meta';
    meta.textContent = [f.date, f.inputs, f.note].filter(Boolean).join(' · ');
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '🗑';
    del.setAttribute('aria-label', `Delete ${f.racket} measurement from ${f.date}`);
    del.addEventListener('click', () => removeRow(row.id, f, del));
    li.append(main, meta, del);
    return li;
  }

  async function removeRow(id, f, btn) {
    if (!confirm(`Delete the ${f.sw} measurement (${f.racket}) from ${f.date}?`)) return;
    btn.disabled = true;
    const { error } = await state.account.deleteMeasurement(id);
    if (error) {
      btn.disabled = false;
      setNote(el.historyMsg, `Could not delete: ${error}`, true);
      return;
    }
    loadHistory();
  }

  el.btnRetry.addEventListener('click', () => loadHistory());

  // ---------- startup ----------

  loadAccount()
    .then((account) => {
      state.account = account;
      account.onAuthChange((user) => {
        const changed = user?.id !== state.user?.id;
        state.user = user;
        if (changed) {
          state.savedKey = null;
          el.list.replaceChildren();
          setNote(el.note, '');
          setNote(el.saveMsg, '');
          if (user) loadHistory();
        }
        renderAccount();
      });
    })
    .catch((err) => {
      console.warn('Account features unavailable:', err);
      setNote(el.status, /not configured/.test(err?.message) ? 'Sign-in unavailable: not configured.' : 'Sign-in unavailable.', true);
    });

  return {
    resultChanged(snapshot) {
      state.snapshot = snapshot;
      renderSave();
    },
  };
}
```

- [ ] **Step 4: Report results from `renderResult` in `src/ui.js`**

In `renderResult()`, inside the `clear` closure, add as its first line:

```js
    accountUi.resultChanged(null);
```

At the end of `renderResult()` (after the `el.sens.textContent = ...` line), add:

```js
  accountUi.resultChanged({ inputs, period: p, result: r, source: state.mode });
```

- [ ] **Step 5: Check user text is never parsed as HTML**

Run: `grep -n "innerHTML\|insertAdjacentHTML\|outerHTML" src/accountUi.js src/ui.js`
Expected: no output.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Verify in the browser preview (placeholders)**

Reload the preview, then `preview_console_logs` level `error` (none), and `preview_snapshot`: Save row and History card are hidden; the result card behaves as before.

- [ ] **Step 8: Commit**

```bash
git add src/accountUi.js src/ui.js index.html styles.css
git commit -m "Add Save button and saved-measurement history"
```

---

### Task 5: Connect the real Supabase project and verify end to end

Requires the user: project URL, publishable key, running `supabase/schema.sql`, URL configuration, and clicking the emailed link.

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Ask the user** to run `supabase/schema.sql` in the SQL Editor, add `http://localhost:8000` to Authentication → URL Configuration → Redirect URLs (and set Site URL), and paste the project URL and publishable key.

- [ ] **Step 2: Fill in `src/config.js`** with the supplied values. Refuse and warn if the key looks like a secret key (`sb_secret_…`, or a JWT whose payload `role` is `service_role`).

- [ ] **Step 3: Verify in the preview**

Reload; `preview_snapshot` shows the email field and *Send link*. Fill `#email` with the user's address (ask first — this sends an email on their behalf), click `#btn-send-link`, `preview_network` shows `POST …/auth/v1/otp` → 200, and the note says "Check your email …".

- [ ] **Step 4: User completes sign-in** by opening the link in the same browser at `http://localhost:8000`. Then verify with `preview_snapshot`: "Signed in as …", History card shows "No saved measurements yet." (or rows).

- [ ] **Step 5: Save / delete round trip**

Produce a final result (Video file tab + sample video if present, or the user's own video), enter mass/balance/pivot, type racket `<b>test</b>`, click Save. Confirm: button goes Saving… → Saved ✓ and stays disabled; History shows the literal text `<b>test</b>`; change pivot by 0.1 → Save re-enables. Delete the row (accept the confirm dialog) and confirm it disappears.

- [ ] **Step 6: Commit**

```bash
git add src/config.js
git commit -m "Configure Supabase project"
```
