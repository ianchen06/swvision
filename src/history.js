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
