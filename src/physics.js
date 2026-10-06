// Compound-pendulum swingweight. Distances in cm from the butt end,
// mass in grams, inertia in kg·cm² (the conventional swingweight unit).

export const G_CM = 980.665; // standard gravity, cm/s²
export const SWINGWEIGHT_AXIS_CM = 10;

// Measurement tolerances used for the combined uncertainty.
export const TOLERANCES = { massG: 1, balanceCm: 0.2, pivotCm: 0.2 };

function compute({ massG, balanceCm, pivotCm, periodS, amplitudeDeg = 0, g = G_CM }) {
  const m = massG / 1000;
  const theta = (amplitudeDeg * Math.PI) / 180;
  const T0 = periodS / (1 + (theta * theta) / 16);
  const L = (g * T0 * T0) / (4 * Math.PI * Math.PI);
  const d = Math.abs(pivotCm - balanceCm);
  const Ip = m * d * L;
  const Icm = m * d * (L - d);
  const SW = Icm + m * (balanceCm - SWINGWEIGHT_AXIS_CM) ** 2;
  return { L, d, Ip, Icm, SW };
}

function validate({ massG, balanceCm, pivotCm, periodS, amplitudeDeg = 0, g = G_CM }) {
  const nums = { massG, balanceCm, pivotCm, periodS, amplitudeDeg, g };
  for (const [k, v] of Object.entries(nums)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} must be a number`;
  }
  if (massG <= 0) return 'Mass must be positive';
  if (periodS <= 0) return 'Period must be positive';
  if (g <= 0) return 'g must be positive';
  if (balanceCm < 0 || pivotCm < 0) return 'Distances must be measured from the butt (≥ 0)';
  if (Math.abs(pivotCm - balanceCm) < 0.5) return 'Pivot must be away from the balance point';
  return null;
}

/**
 * Returns { L, d, Ip, Icm, SW, sigmaSW, sensitivity } or { error }.
 * sensitivity: SW change per +1 cm pivot, +1 cm balance, +1 g mass, +1 ms period.
 */
export function swingweight(input) {
  const error = validate(input);
  if (error) return { error };
  const r = compute(input);
  if (!(r.L > r.d)) {
    return { error: 'Period is too short for this pivot distance — check pivot and balance' };
  }

  const deriv = (key, h) => (compute({ ...input, [key]: input[key] + h }).SW - compute({ ...input, [key]: input[key] - h }).SW) / (2 * h);
  const dPivot = deriv('pivotCm', 1e-3);
  const dBalance = deriv('balanceCm', 1e-3);
  const dMass = deriv('massG', 1e-3);
  const dPeriod = deriv('periodS', 1e-6);

  const sigmaT = input.periodSigmaS ?? 0;
  const sigmaSW = Math.sqrt(
    (dPeriod * sigmaT) ** 2 +
      (dMass * TOLERANCES.massG) ** 2 +
      (dBalance * TOLERANCES.balanceCm) ** 2 +
      (dPivot * TOLERANCES.pivotCm) ** 2,
  );

  return {
    ...r,
    sigmaSW,
    sensitivity: { perCmPivot: dPivot, perCmBalance: dBalance, perGram: dMass, perMsPeriod: dPeriod / 1000 },
  };
}
