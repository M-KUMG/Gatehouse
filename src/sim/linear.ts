// Dense linear solver: Gaussian elimination with partial pivoting.
// MNA matrices are sparse (a node touches only its neighbours), so each
// elimination step only visits the nonzero columns of the pivot row; the
// arithmetic done is the same as the plain dense loop (it only skips adding
// f * 0), so the answer is too.

/**
 * Solves A x = z. `a` (rows) and `z` are overwritten (the rows may be
 * swapped). The answer goes into `out` when given (it must not be `z`).
 * Returns null when the matrix is singular.
 */
export function solveLinear(a: Float64Array[], z: Float64Array, out?: Float64Array): Float64Array | null {
  const n = z.length;
  const cols = new Int32Array(n);
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
    const p = prow[col];
    let count = 0;
    for (let c = col + 1; c < n; c++) if (prow[c] !== 0) cols[count++] = c;
    for (let r = col + 1; r < n; r++) {
      const row = a[r];
      const f = row[col] / p;
      if (f === 0) continue;
      row[col] -= f * p;
      for (let k = 0; k < count; k++) {
        const c = cols[k];
        row[c] -= f * prow[c];
      }
      z[r] -= f * z[col];
    }
  }
  const x = out ?? new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = z[r];
    const row = a[r];
    for (let c = r + 1; c < n; c++) sum -= row[c] * x[c];
    x[r] = sum / row[r];
  }
  return x;
}
