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
