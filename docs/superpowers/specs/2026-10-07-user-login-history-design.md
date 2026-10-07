# User login and saved measurement history

## Goal

Signed-in users can save swingweight results to their account and view or delete
them from any device. Measuring keeps working without signing in and without
network access.

## Decisions

- Auth: Supabase email magic link (`signInWithOtp`). No passwords, no OAuth.
- Saving: explicit *Save* button with optional racket name and note. No auto-save.
- History: newest 50 entries, list with delete. No editing, filtering or export.
- Client: `supabase-js` v2 from a pinned esm.sh URL, loaded with a dynamic
  `import()` so a CDN/Supabase failure only disables the account features.
- App stays static with no build step. Config lives in a committed JS file; the
  publishable key is public by design and access control is enforced by RLS.

## Components

### `src/config.js` (new, committed)

```js
export const SUPABASE_URL = 'https://<ref>.supabase.co';
export const SUPABASE_KEY = '<publishable key>';
```

Never holds the secret/service_role key.

### `src/account.js` (new)

The only module that imports Supabase. Every async function resolves to
`{ data }` or `{ error: string }` (human-readable message), never throws.

- `onAuthChange(cb)` — calls `cb(user | null)` now and on every change.
- `sendMagicLink(email)` — `emailRedirectTo` = `location.origin + location.pathname`.
  Maps Supabase's rate-limit error to "Too many emails, try again later."
- `signOut()`
- `saveMeasurement(record)` — insert one row, return it.
- `listMeasurements()` — newest first, limit 50.
- `deleteMeasurement(id)`

### `src/history.js` (new, pure)

- `buildRecord({ inputs, period, result, racket, note, source })` — returns the
  row object, or `null` if the period is not final or the result has an error.
  Empty racket/note become `null`; strings are trimmed.
- `formatRow(row)` — `{ date, racket, sw, inputs }` display strings, e.g.
  `sw: "329.4 ± 1.2"`, `inputs: "320 g · 32.0 cm · 67.0 cm"`.

### `ui.js` / `index.html` / `styles.css`

- **Account card** (top of right column): signed out → email input + *Send link*,
  then "Check your email."; signed in → "Signed in as <email>" + *Sign out*.
  If the account module fails to load: "Sign-in unavailable."
- **Save row** in the Swingweight card: racket name, note, *Save*. Visible only
  when signed in and the result is final. States: Save → Saving… → Saved ✓
  (disabled until the result or inputs change). Inline error on failure.
- **History card** below the result: loads on sign-in and after save/delete.
  Rows show date, racket, SW ± σ, inputs, and a delete button (with
  `confirm()`). Empty state "No saved measurements yet."; load failure shows
  an error with *Retry*. Hidden when signed out.

## Database (`supabase/schema.sql`)

```sql
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
create index on public.measurements (user_id, created_at desc);
alter table public.measurements enable row level security;
-- select / insert / delete only where user_id = auth.uid(); no update policy.
```

## Testing

- `tests/history.test.js`: `buildRecord` (final result, non-final → null,
  error result → null, blank labels → null) and `formatRow`.
- Existing tests keep passing.
- Manual in browser preview: page loads, Account card renders, *Send link*
  returns success. Completing the email link is done by the user.

## Setup the user performs in Supabase

1. Run `supabase/schema.sql` in the SQL Editor.
2. Authentication → URL Configuration: set Site URL and add
   `http://localhost:8000` (plus any HTTPS host) to Redirect URLs.
3. Provide the project URL and publishable key for `src/config.js`.

## Out of scope

Editing entries, per-racket filtering/charts, CSV export, other sign-in methods,
storing videos.
