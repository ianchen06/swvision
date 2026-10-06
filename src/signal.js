// Turns a 2-D centroid trajectory into a 1-D swing signal by projecting onto
// its principal axis, so camera orientation doesn't matter. Pure, no DOM.

export function principalAxis(xs, ys) {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(theta);
  let uy = Math.sin(theta);
  // Stable sign: point "down" (or right when horizontal) so plots don't flip.
  if (uy < 0 || (uy === 0 && ux < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { ux, uy, mx, my };
}

export function project(xs, ys, axis = principalAxis(xs, ys)) {
  const values = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    values[i] = (xs[i] - axis.mx) * axis.ux + (ys[i] - axis.my) * axis.uy;
  }
  return { values, axis };
}
