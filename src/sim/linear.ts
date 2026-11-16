// Dense linear solver: Gaussian elimination with partial pivoting.

/**
 * Solves A x = z. `a` (rows) and `z` are overwritten. Returns null when the
 * matrix is singular.
 */
export function solveLinear(a: Float64Array[], z: Float64Array): Float64Array | null {
  const n = z.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (!(best > 1e-300)) return null; // also catches NaN
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [z[col], z[pivot]] = [z[pivot], z[col]];
    }
    const prow = a[col];
    for (let r = col + 1; r < n; r++) {
      const row = a[r];
      const f = row[col] / prow[col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) row[c] -= f * prow[c];
      z[r] -= f * z[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = z[r];
    const row = a[r];
    for (let c = r + 1; c < n; c++) sum -= row[c] * x[c];
    x[r] = sum / row[r];
  }
  return x;
}
