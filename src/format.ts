// Engineering notation for readouts and the value editor.

const PREFIXES: [number, string][] = [
  [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
];

/** 0.0213, 'A' -> "21.3 mA"; 4700, 'Ω' -> "4.7 kΩ". */
export function formatSI(value: number, unit: string, digits = 3): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return `? ${unit}`;
  if (abs < 0.5e-12) return `0 ${unit}`;
  const [scale, prefix] = PREFIXES.find(([s]) => abs >= s * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  return `${parseFloat((value / scale).toPrecision(digits))} ${prefix}${unit}`;
}

/** "220", "4.7k", "4k7", "1M", "10 kΩ", "100n", "4.7u", "10p", "10mH" -> number, or null when it is not a value. */
export function parseSI(text: string): number | null {
  const m = /^\s*(\d*[.,]?\d*)\s*([kKmMRrµμunp]?)(\d*)\s*[ΩVvAaFH]?\s*$/.exec(text.replace(/ohms?/i, ''));
  if (!m || (m[1] === '' && m[3] === '') || m[1] === '.' || m[1] === ',') return null;
  const scale: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, m: 1e-3, 'µ': 1e-6, 'μ': 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, R: 1, r: 1, '': 1 };
  // "4k7" means 4.7 k: digits after the prefix are the decimals.
  const mantissa = m[3] ? `${m[1] || '0'}.${m[3]}` : m[1].replace(',', '.');
  const value = Number(mantissa) * scale[m[2]];
  return Number.isFinite(value) ? value : null;
}
