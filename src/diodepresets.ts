import { D1N4148, VT } from './sim/devices';
import type { ComponentModel } from './sim/types';
import { ZENER_MAX_VOLTS, ZENER_MIN_VOLTS } from './sim/zener';

const DIODE_CATALOG_FILES = {
  diode: 'diodes.json',
  schottky: 'schottky.json',
  zener: 'zeners.json',
} as const;

export type DiodeFamily = keyof typeof DIODE_CATALOG_FILES;

export function isDiodeFamily(typeId: string): typeId is DiodeFamily {
  return Object.hasOwn(DIODE_CATALOG_FILES, typeId);
}

export const DIODE_FIELDS = [
  { key: 'diodeIs', label: 'Saturation current', unit: 'A', min: 1e-12, max: 1e-3 },
  { key: 'diodeN', label: 'Ideality factor', unit: '', min: 0.5, max: 5 },
  { key: 'diodeRs', label: 'Series resistance', unit: 'Ω', min: 0, max: 1000 },
  { key: 'diodeForwardAmps', label: 'Forward current rating', unit: 'A', min: 0.001, max: 1000 },
  { key: 'diodeReverseVolts', label: 'Reverse voltage rating', unit: 'V', min: 1, max: 10000 },
] as const;

export type DiodeField = typeof DIODE_FIELDS[number]['key'];
export type DiodeSettings = Record<DiodeField, number>;

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

export interface DiodePreset {
  name: string;
  hint: string;
  settings: Partial<DiodeSettings> & { value?: number };
}

export function isDiodeField(key: string): key is DiodeField {
  return DIODE_FIELDS.some((field) => field.key === key);
}

export function isDiodePresetName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$/.test(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readDiodeCatalog(data: unknown, family: DiodeFamily = 'diode'): DiodePreset[] {
  if (!Array.isArray(data)) throw new Error('Invalid diode catalog');
  const fields = family === 'zener' ? [{ key: 'value', min: ZENER_MIN_VOLTS, max: ZENER_MAX_VOLTS }] as const : DIODE_FIELDS;
  const names = new Set<string>();
  return data.map((item: unknown) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !isDiodePresetName(item.name)
      || typeof item.hint !== 'string' || !isRecord(item.settings)) throw new Error('Invalid diode preset');
    const nameKey = item.name.toUpperCase();
    if (names.has(nameKey)) throw new Error('Duplicate diode preset');
    names.add(nameKey);
    if (Object.keys(item.settings).length !== fields.length) throw new Error('Invalid diode preset settings');
    const settings: DiodePreset['settings'] = {};
    for (const field of fields) {
      const value = item.settings[field.key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) {
        throw new Error('Invalid diode setting: ' + field.key);
      }
      settings[field.key] = value;
    }
    return { name: item.name, hint: item.hint, settings };
  });
}

const catalogs = new Map<DiodeFamily, Promise<DiodePreset[]>>();

export function loadDiodeCatalog(family: DiodeFamily): Promise<DiodePreset[]> {
  const cached = catalogs.get(family);
  if (cached) return cached;
  const url = new URL(`part-library/${DIODE_CATALOG_FILES[family]}`, document.baseURI);
  const catalog = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error('Diode catalog unavailable');
    return readDiodeCatalog(await response.json(), family);
  }).catch((error: unknown) => {
    catalogs.delete(family);
    throw error;
  });
  catalogs.set(family, catalog);
  return catalog;
}
