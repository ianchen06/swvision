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
