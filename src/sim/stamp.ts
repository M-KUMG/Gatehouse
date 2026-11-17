// How a device writes its linearized companion model into the MNA system.
// Node numbers: 0 is the reference, k > 0 is unknown k - 1.

export interface Stamp {
  /** Conductance g between two nodes. */
  addG(n1: number, n2: number, g: number): void;
  /** Constant current i flowing from one node to the other through the element. */
  addI(from: number, to: number, i: number): void;
  /** Current g * (v[cp] - v[cm]) flowing from one node to the other. */
  addGm(from: number, to: number, cp: number, cm: number, g: number): void;
}

/** Volts of a node in the current solution. */
export type VoltOf = (node: number) => number;

/** Stamp functions writing into matrix `a` and right-hand side `z`. */
export function stampInto(a: Float64Array[], z: Float64Array): Stamp {
  return {
    addG(n1, n2, g) {
      if (n1 > 0) a[n1 - 1][n1 - 1] += g;
      if (n2 > 0) a[n2 - 1][n2 - 1] += g;
      if (n1 > 0 && n2 > 0) {
        a[n1 - 1][n2 - 1] -= g;
        a[n2 - 1][n1 - 1] -= g;
      }
    },
    addI(from, to, i) {
      if (from > 0) z[from - 1] -= i;
      if (to > 0) z[to - 1] += i;
    },
    addGm(from, to, cp, cm, g) {
      if (from > 0) {
        if (cp > 0) a[from - 1][cp - 1] += g;
        if (cm > 0) a[from - 1][cm - 1] -= g;
      }
      if (to > 0) {
        if (cp > 0) a[to - 1][cp - 1] -= g;
        if (cm > 0) a[to - 1][cm - 1] += g;
      }
    },
  };
}
