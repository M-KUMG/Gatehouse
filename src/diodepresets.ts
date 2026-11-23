import { D1N4148, VT } from './sim/devices';
import type { ComponentModel } from './sim/types';
import type { PartCatalog } from './partpresets';

export const DIODE_FIELDS = [
  { key: 'diodeIs', label: 'Saturation current', unit: 'A', min: 1e-12, max: 1e-3 },
  { key: 'diodeN', label: 'Ideality factor', unit: '', min: 0.5, max: 5 },
  { key: 'diodeRs', label: 'Series resistance', unit: 'Ω', min: 0, max: 1000 },
  { key: 'diodeForwardAmps', label: 'Forward current rating', unit: 'A', min: 0.001, max: 1000 },
  { key: 'diodeReverseVolts', label: 'Reverse voltage rating', unit: 'V', min: 1, max: 10000 },
] as const;

export type DiodeField = typeof DIODE_FIELDS[number]['key'];
export type DiodeSettings = Record<DiodeField, number>;

const diodeKeys = DIODE_FIELDS.map((field) => field.key);
export const DIODE_CATALOGS = {
  diode: { file: 'diodes.json', label: 'diode', keys: diodeKeys, nameKey: 'diodePreset' },
  schottky: { file: 'schottky.json', label: 'Schottky', keys: diodeKeys, nameKey: 'diodePreset' },
  zener: { file: 'zeners.json', label: 'Zener', keys: ['value'], nameKey: 'diodePreset' },
} as const satisfies Record<string, PartCatalog>;

export const DEFAULT_DIODE_SETTINGS: DiodeSettings = {
  diodeIs: D1N4148.is,
  diodeN: D1N4148.n,
  diodeRs: D1N4148.rs,
  diodeForwardAmps: 0.2,
  diodeReverseVolts: 75,
};

// Existing 1N5819 fit: 0.34 V at 100 mA and 0.60 V at 3 A at 25 °C.
const SCHOTTKY_RS = (0.26 - VT * Math.log(30)) / 2.9;
export const DEFAULT_SCHOTTKY_SETTINGS: DiodeSettings = {
  diodeIs: 0.1 / Math.exp((0.34 - 0.1 * SCHOTTKY_RS) / VT),
  diodeN: 1,
  diodeRs: SCHOTTKY_RS,
  diodeForwardAmps: 1,
  diodeReverseVolts: 40,
};

export function isDiodeField(key: string): key is DiodeField {
  return DIODE_FIELDS.some((field) => field.key === key);
}

/** The chosen numeric settings travel with the project. No catalog lookup is needed to solve it. */
export function diodeModel(state: Partial<DiodeSettings>, defaults = DEFAULT_DIODE_SETTINGS): ComponentModel {
  const { diodeIs, diodeN, diodeRs } = defaults;
  return {
    kind: 'diode', is: state.diodeIs ?? diodeIs, n: state.diodeN ?? diodeN, rs: state.diodeRs ?? diodeRs,
    ...(state.diodeForwardAmps === undefined ? {} : { ratedForwardAmps: state.diodeForwardAmps }),
    ...(state.diodeReverseVolts === undefined ? {} : { ratedReverseVolts: state.diodeReverseVolts }),
  };
}
