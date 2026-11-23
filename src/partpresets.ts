import type { ExtraField, PartState, PartType } from './parts';

export type PresetSetting = 'value' | Exclude<ExtraField['key'], 'wave'>;

export interface PartCatalog {
  file: string;
  label: string;
  keys: readonly PresetSetting[];
  /** Keep the key already used by diode projects. */
  nameKey?: 'diodePreset';
}

export interface PartPreset {
  name: string;
  hint: string;
  settings: Partial<Record<PresetSetting, number>>;
}

export function isPartPresetName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 .,_+/()-]{0,79}$/.test(value);
}

export function partPresetName(type: PartType, state: PartState | undefined): string | undefined {
  return type.catalog ? state?.[type.catalog.nameKey ?? 'partPreset'] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPartCatalog(data: unknown, type: PartType): PartPreset[] {
  const catalog = type.catalog;
  if (!catalog || !Array.isArray(data)) throw new Error('Invalid part catalog');
  const names = new Set<string>();
  const fields = catalog.keys.map((key) => {
    const spec = type.value && (type.value.key ?? 'value') === key ? type.value : undefined;
    const field = spec ?? type.fields?.find((candidate) => candidate.key === key && !candidate.choices);
    if (!field) throw new Error(`Catalog setting is not editable: ${type.id}.${key}`);
    return { key, min: field.min, max: field.max, options: spec?.options };
  });
  return data.map((item: unknown) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !isPartPresetName(item.name)
      || typeof item.hint !== 'string' || !isRecord(item.settings)) throw new Error('Invalid part preset');
    const nameKey = item.name.toUpperCase();
    if (names.has(nameKey)) throw new Error(`Duplicate part preset: ${item.name}`);
    names.add(nameKey);
    if (Object.keys(item.settings).length !== fields.length) throw new Error(`Invalid settings for ${item.name}`);
    const settings: PartPreset['settings'] = {};
    for (const { key, min, max, options } of fields) {
      const value = item.settings[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
        || (options && !options.includes(value))) throw new Error(`Invalid ${key} setting for ${item.name}`);
      settings[key] = value;
    }
    const error = type.validateSettings?.({ ...type.defaults, ...settings });
    if (error) throw new Error(`Invalid settings for ${item.name}: ${error}`);
    return { name: item.name, hint: item.hint, settings };
  });
}

const catalogs = new Map<string, Promise<PartPreset[]>>();

export function loadPartCatalog(type: PartType, catalog: PartCatalog): Promise<PartPreset[]> {
  const cached = catalogs.get(type.id);
  if (cached) return cached;
  const url = new URL(`part-library/${catalog.file}`, document.baseURI);
  const request = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error('Part catalog unavailable');
    return readPartCatalog(await response.json(), type);
  }).catch((error: unknown) => {
    catalogs.delete(type.id);
    throw error;
  });
  catalogs.set(type.id, request);
  return request;
}
