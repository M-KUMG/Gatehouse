import type { ExtraField } from './parts';

export function contactRatingField(defaultAmps: number): ExtraField {
  return { key: 'contactAmps', label: 'Rated contact current', unit: 'A', min: 0.001, max: 100, defaultValue: () => defaultAmps };
}
