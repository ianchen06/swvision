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
