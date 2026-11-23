// AC and mains parts: the variable AC supply, the 230 V outlet, the incandescent and the LED light bulb and the
// transformer. Models in sim/acsource.ts, sim/bulb.ts and sim/transformer.ts, artwork in art/ac.ts.
//
// The bulbs are mirrorable too: both leads sit on one edge, a mirror swaps shell and tip (no turn does).
// so is the transformer: a mirror puts its primary on the right with the dots still on top, which no turn does. The AC
// supply and the outlet are, like the DC supply and the 9 V battery: a mirror puts the second terminal above the first.

import {
  ACSOURCE_ART, BULB_ART, LEDBULB_ART, OUTLET_ART, TRANSFORMER_ART, acHzLabel, acVoltsLabel, acsourceSvg, bulbSvg, drawAcLamp, drawBulbGlow,
  drawLedBulbGlow, ledbulbSvg, transformerSvg,
} from './art/ac';
import { BRIDGE_ART, bridgeArt } from './art/bridge';
import { CHANGEOVER_ART, CHANGEOVER_ON_SVG, MAINS_SWITCH_ART, MAINS_SWITCH_ON_SVG, changeoverSvg, mainsSwitchSvg } from './art/mainsswitch';
import { acsourceReadout, bridgeReadout, changeoverReadout, bulbReadout, ledbulbReadout, transformerReadout } from './devicereadouts';
import type { PartState, PartType } from './parts';
import {
  AC_DEFAULT_AMPS, AC_DEFAULT_HZ, AC_DEFAULT_VOLTS, AC_MAX_AMPS, AC_MAX_HZ, AC_MAX_VOLTS, AC_MIN_AMPS, AC_MIN_HZ, OUTLET,
} from './sim/acsource';
import {
  BRIDGE_DEFAULT_AMPS, BRIDGE_DEFAULT_VOLTS, BRIDGE_MAX_AMPS, BRIDGE_MAX_VOLTS, BRIDGE_MIN_AMPS, BRIDGE_MIN_VOLTS, bridgeStress, type BridgeModel,
} from './sim/mainsparts';
import {
  BULB_DEFAULT_VOLTS, BULB_DEFAULT_WATTS, BULB_MAX_VOLTS, BULB_MAX_WATTS, BULB_MIN_VOLTS, LEDBULB_DEFAULT_WATTS, bulbStress, T_AMBIENT,
  type BulbModel, type LedBulbModel,
} from './sim/bulb';
import {
  TRANSFORMER_DEFAULT_PRIMARY, TRANSFORMER_DEFAULT_SECONDARY, TRANSFORMER_MAX_VOLTS, TRANSFORMER_MIN_VOLTS, TRANSFORMER_VA,
  transformerStress, type TransformerModel,
} from './sim/transformer';
import type { ComponentModel } from './sim';
import { contactRatingField } from './switchrating';

const ok = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** An AC supply's settings with defaults for anything missing: value is the RMS voltage. */
export function acsourceSettings(s: PartState): { vrms: number; freq: number; limit: number } {
  return { vrms: ok(s.value, AC_DEFAULT_VOLTS), freq: ok(s.freq, AC_DEFAULT_HZ), limit: ok(s.limit, AC_DEFAULT_AMPS) };
}

export const bulbModelOf = (s: PartState): BulbModel => ({ kind: 'bulb', volts: ok(s.volts, BULB_DEFAULT_VOLTS), watts: ok(s.value, BULB_DEFAULT_WATTS) });
export const ledbulbModelOf = (s: PartState): LedBulbModel => ({ kind: 'ledbulb', volts: ok(s.volts, BULB_DEFAULT_VOLTS), watts: ok(s.value, LEDBULB_DEFAULT_WATTS) });
export const transformerModelOf = (s: PartState): TransformerModel => ({
  kind: 'transformer', primaryVolts: ok(s.volts, TRANSFORMER_DEFAULT_PRIMARY),
  secondaryVolts: ok(s.value, TRANSFORMER_DEFAULT_SECONDARY), va: ok(s.transformerVa, TRANSFORMER_VA),
});

export const bridgeModelOf = (s: PartState): BridgeModel => ({ kind: 'bridge', volts: ok(s.volts, BRIDGE_DEFAULT_VOLTS), amps: ok(s.value, BRIDGE_DEFAULT_AMPS) });

const warn = (st: ReturnType<typeof bulbStress>): string | null => (st.level === 'ok' ? null : st.reason);
const burn = (st: ReturnType<typeof bulbStress>): string | null => (st.level === 'burn' ? st.reason : null);

const RATED_VOLTS_FIELD = { key: 'volts', label: 'Rated voltage (RMS)', unit: 'V', min: BULB_MIN_VOLTS, max: BULB_MAX_VOLTS } as const;

export const AC_PARTS: readonly PartType[] = [
  {
    id: 'acsource', name: 'AC power supply (variable)', ...ACSOURCE_ART, mirrorable: true,
    pins: [{ id: 'pos', name: '~ A', x: 6, y: 1 }, { id: 'neg', name: '~ B', x: 6, y: 3 }],
    defaults: { value: AC_DEFAULT_VOLTS, freq: AC_DEFAULT_HZ, limit: AC_DEFAULT_AMPS },
    value: { label: 'Voltage (RMS)', unit: 'V', min: 0, max: AC_MAX_VOLTS },
    // A sine source set by its RMS voltage and frequency, with an RMS current limit (sim/acsource.ts).
    fields: [
      { key: 'freq', label: 'Frequency', unit: 'Hz', min: AC_MIN_HZ, max: AC_MAX_HZ },
      { key: 'limit', label: 'Current limit (RMS)', unit: 'A', min: AC_MIN_AMPS, max: AC_MAX_AMPS },
    ],
    readout: acsourceReadout,
    overlay: (ctx, _s, r) => {
      if (r) drawAcLamp(ctx, (r.volts?.cc ?? 0) >= 0.5);
    },
    variant: (s) => {
      const a = acsourceSettings(s);
      return a.vrms === AC_DEFAULT_VOLTS && a.freq === AC_DEFAULT_HZ ? null : { key: `${acVoltsLabel(a.vrms)}-${acHzLabel(a.freq)}`, svg: acsourceSvg(a.vrms, a.freq) };
    },
    sim: (s) => ({ kind: 'acsource', ...acsourceSettings(s) }),
  },
  {
    id: 'outlet', name: 'Mains outlet (230 V)', ...OUTLET_ART, mirrorable: true,
    pins: [{ id: 'pos', name: 'L (live)', x: 4, y: 1 }, { id: 'neg', name: 'N (neutral)', x: 4, y: 3 }],
    // 230 V RMS, 50 Hz, behind a 16 A breaker (sim/acsource.ts): a short circuit holds the current at its limit.
    readout: acsourceReadout,
    sim: () => ({ kind: 'acsource', vrms: OUTLET.vrms, freq: OUTLET.freq, limit: OUTLET.limit }),
  },
  {
    // A wall light switch: the same switch model as the toggle, rated for mains (specs.ts: 10 A).
    id: 'mainsswitch', name: 'Mains switch', ...MAINS_SWITCH_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { closed: false },
    catalog: { file: 'mains-switches.json', label: 'mains switch', keys: ['contactAmps'] },
    fields: [contactRatingField(10)],
    control: 'toggle',
    variant: (s) => {
      const amps = s.contactAmps ?? 10;
      if (amps === 10) return s.closed ? { key: 'on', svg: MAINS_SWITCH_ON_SVG } : null;
      return { key: `${s.closed ? 'on' : 'off'}-${amps}`, svg: mainsSwitchSvg(s.closed === true, amps) };
    },
    sim: (s) => ({ kind: 'switch', closed: s.closed === true, ...(s.contactAmps === undefined ? {} : { ratedContactAmps: s.contactAmps }) }),
  },
  {
    // A wall two-way switch (SPDT): the common pin goes to NC at rest and to NO when switched (specs.ts: 10 A).
    id: 'changeover', name: 'Mains switch (changeover, SPDT)', ...CHANGEOVER_ART, mirrorable: true,
    pins: [{ id: 'com', name: 'COM (common)', x: 0, y: 2 }, { id: 'nc', name: 'NC (normally closed)', x: 4, y: 1 }, { id: 'no', name: 'NO (normally open)', x: 4, y: 3 }],
    defaults: { closed: false },
    catalog: { file: 'changeover-switches.json', label: 'changeover switch', keys: ['contactAmps'] },
    fields: [contactRatingField(10)],
    control: 'toggle',
    readout: changeoverReadout,
    variant: (s) => {
      const amps = s.contactAmps ?? 10;
      if (amps === 10) return s.closed ? { key: 'on', svg: CHANGEOVER_ON_SVG } : null;
      return { key: `${s.closed ? 'on' : 'off'}-${amps}`, svg: changeoverSvg(s.closed === true, amps) };
    },
    sim: (s) => ({ kind: 'changeover', no: s.closed === true, ...(s.contactAmps === undefined ? {} : { ratedContactAmps: s.contactAmps }) }),
  },
  {
    // Four diodes in a diamond; rated by reverse voltage (the voltage field) and average output current (the value).
    id: 'bridge', name: 'Bridge rectifier', ...BRIDGE_ART, mirrorable: true,
    pins: [
      { id: 'ac1', name: 'AC 1 (~)', x: 0, y: 1 }, { id: 'ac2', name: 'AC 2 (~)', x: 0, y: 3 },
      { id: 'pos', name: 'DC + (output)', x: 4, y: 1 }, { id: 'neg', name: 'DC − (output)', x: 4, y: 3 },
    ],
    defaults: { value: BRIDGE_DEFAULT_AMPS, volts: BRIDGE_DEFAULT_VOLTS },
    catalog: { file: 'bridge-rectifiers.json', label: 'bridge rectifier', keys: ['value', 'volts'] },
    value: { label: 'Rated current (average)', unit: 'A', min: BRIDGE_MIN_AMPS, max: BRIDGE_MAX_AMPS },
    fields: [{ key: 'volts', label: 'Rated reverse voltage', unit: 'V', min: BRIDGE_MIN_VOLTS, max: BRIDGE_MAX_VOLTS }],
    readout: bridgeReadout,
    warnWhen: (r, s) => warn(bridgeStress(bridgeModelOf(s), r)),
    burnWhen: (r, s) => burn(bridgeStress(bridgeModelOf(s), r)),
    variant: (s) => {
      const m = bridgeModelOf(s);
      return s.burned || m.volts !== BRIDGE_DEFAULT_VOLTS || m.amps !== BRIDGE_DEFAULT_AMPS ? bridgeArt(m.volts, m.amps, s.burned === true) : null;
    },
    sim: (s) => (s.burned ? { kind: 'open' } : bridgeModelOf(s)),
  },
  {
    id: 'transformer', name: 'Transformer', ...TRANSFORMER_ART, mirrorable: true,
    pins: [
      { id: 'p1', name: 'Primary 1 (dot)', x: 0, y: 1 }, { id: 'p2', name: 'Primary 2', x: 0, y: 4 },
      { id: 's1', name: 'Secondary 1 (dot)', x: 6, y: 1 }, { id: 's2', name: 'Secondary 2', x: 6, y: 4 },
    ],
    defaults: { value: TRANSFORMER_DEFAULT_SECONDARY, volts: TRANSFORMER_DEFAULT_PRIMARY },
    catalog: { file: 'transformers.json', label: 'transformer', keys: ['value', 'volts', 'transformerVa'] },
    value: { label: 'Secondary voltage', unit: 'V', min: TRANSFORMER_MIN_VOLTS, max: TRANSFORMER_MAX_VOLTS },
    fields: [
      { key: 'volts', label: 'Primary voltage', unit: 'V', min: TRANSFORMER_MIN_VOLTS, max: TRANSFORMER_MAX_VOLTS },
      { key: 'transformerVa', label: 'Rated apparent power', unit: 'VA', min: 0.01, max: 10000, defaultValue: () => TRANSFORMER_VA },
    ],
    readout: transformerReadout,
    warnWhen: (r, s) => warn(transformerStress(transformerModelOf(s), r)),
    burnWhen: (r, s) => burn(transformerStress(transformerModelOf(s), r)),
    variant: (s) => {
      const m = transformerModelOf(s);
      const key = `${m.primaryVolts}-${m.secondaryVolts}`;
      if (s.burned) return { key: `burned-${key}`, svg: transformerSvg(m.primaryVolts, m.secondaryVolts, true) };
      return m.primaryVolts === TRANSFORMER_DEFAULT_PRIMARY && m.secondaryVolts === TRANSFORMER_DEFAULT_SECONDARY ? null : { key, svg: transformerSvg(m.primaryVolts, m.secondaryVolts) };
    },
    sim: (s) => (s.burned ? { kind: 'open' } : transformerModelOf(s)),
  },
  {
    id: 'bulb', name: 'Light bulb (incandescent)', ...BULB_ART, mirrorable: true,
    pins: [{ id: 'a', name: '1', x: 1, y: 6 }, { id: 'b', name: '2', x: 3, y: 6 }],
    defaults: { value: BULB_DEFAULT_WATTS, volts: BULB_DEFAULT_VOLTS },
    catalog: { file: 'incandescent-bulbs.json', label: 'incandescent bulb', keys: ['value', 'volts'] },
    value: { label: 'Power', unit: 'W', min: 1, max: BULB_MAX_WATTS },
    fields: [RATED_VOLTS_FIELD],
    readout: bulbReadout,
    warnWhen: (r, s) => warn(bulbStress(bulbModelOf(s), r)),
    burnWhen: (r, s) => burn(bulbStress(bulbModelOf(s), r)),
    variant: (s) => (s.burned ? { key: 'burned', svg: bulbSvg(true) } : null),
    overlay: (ctx, s, r) => {
      if (!s.burned && r) drawBulbGlow(ctx, r.volts?.light ?? 0, r.volts?.['filament.temp'] ?? T_AMBIENT);
    },
    sim: (s) => (s.burned ? { kind: 'open' } : bulbModelOf(s)),
  },
  {
    id: 'ledbulb', name: 'Light bulb (LED)', ...LEDBULB_ART, mirrorable: true,
    pins: [{ id: 'a', name: '1', x: 1, y: 6 }, { id: 'b', name: '2', x: 3, y: 6 }],
    defaults: { value: LEDBULB_DEFAULT_WATTS, volts: BULB_DEFAULT_VOLTS },
    catalog: { file: 'led-bulbs.json', label: 'LED bulb', keys: ['value', 'volts'] },
    value: { label: 'Power', unit: 'W', min: 0.5, max: 100 },
    fields: [RATED_VOLTS_FIELD],
    readout: ledbulbReadout,
    warnWhen: (r, s) => warn(bulbStress(ledbulbModelOf(s), r)),
    burnWhen: (r, s) => burn(bulbStress(ledbulbModelOf(s), r)),
    variant: (s) => (s.burned ? { key: 'burned', svg: ledbulbSvg(true) } : null),
    overlay: (ctx, s, r) => {
      if (!s.burned && r) drawLedBulbGlow(ctx, r.volts?.light ?? 0);
    },
    sim: (s) => (s.burned ? { kind: 'open' } : ledbulbModelOf(s)),
  },
];

// A type-only use so the model union stays visible to readers of this file.
export type AcModel = Extract<ComponentModel, { kind: 'acsource' | 'bulb' | 'ledbulb' | 'transformer' }>;
