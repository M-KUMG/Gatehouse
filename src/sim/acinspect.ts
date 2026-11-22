// Part inspector entries of the AC and mains parts: the AC source (model 'acsource', acsource.ts), the
// incandescent bulb ('bulb') and the LED bulb ('ledbulb', both bulb.ts) and the transformer ('transformer',
// transformer.ts). Everything comes from the part's PartResult and model.

import { bulbHotOhms, bulbOhms, bulbStress, T_AMBIENT, type BulbModel, type LedBulbModel } from './bulb';
import type { Quantity } from './inspect';
import { bridgeStress, type BridgeModel, type ChangeoverModel } from './mainsparts';
import { transformerParams, transformerStress, TRANSFORMER_VA, type TransformerModel } from './transformer';
import type { PartResult } from './types';
import type { AcSourceModel } from './acsource';

const num = (id: string, label: string, kind: Quantity['kind'], unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

export function acsourceQuantities(model: AcSourceModel, r: PartResult): Quantity[] {
  return [
    num('v', 'V', 'voltage', 'V', r.voltage),
    num('i', 'I', 'current', 'A', r.current),
    num('p', 'P', 'power', 'W', r.power),
    num('vrms', 'Voltage (RMS)', 'voltage', 'V', model.vrms),
    num('vpeak', 'Peak voltage', 'voltage', 'V', model.vrms * Math.SQRT2),
    num('f', 'f', 'ratio', 'Hz', model.freq),
    num('limit', 'Current limit (RMS)', 'current', 'A', model.limit),
    text('mode', 'Mode', (r.volts?.cc ?? 0) >= 0.5 ? 'at the current limit (a breaker would trip)' : 'normal'),
  ];
}

export function bulbQuantities(model: BulbModel, r: PartResult): Quantity[] {
  const temp = r.volts?.['filament.temp'] ?? T_AMBIENT;
  const stress = bulbStress(model, r);
  return [
    num('v', 'V', 'voltage', 'V', r.voltage),
    num('i', 'I', 'current', 'A', r.current),
    num('p', 'P', 'power', 'W', r.power),
    num('temp', 'Filament', 'ratio', '°C', temp - 273.15),
    num('light', 'Brightness', 'ratio', '%', 100 * (r.volts?.light ?? 0)),
    num('r', 'R now', 'resistance', 'Ω', bulbOhms(model, temp)),
    num('rhot', 'R at full brightness', 'resistance', 'Ω', bulbHotOhms(model)),
    num('rated', 'Rating', 'power', 'W', model.watts),
    num('ratedv', 'Rated voltage (RMS)', 'voltage', 'V', model.volts),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}

export function ledbulbQuantities(model: LedBulbModel, r: PartResult): Quantity[] {
  const stress = bulbStress(model, r);
  return [
    num('v', 'V', 'voltage', 'V', r.voltage),
    num('i', 'I', 'current', 'A', r.current),
    num('p', 'P', 'power', 'W', r.power),
    num('pavg', 'P (average)', 'power', 'W', r.volts?.['power.avg'] ?? 0),
    num('light', 'Brightness', 'ratio', '%', 100 * (r.volts?.light ?? 0)),
    num('rated', 'Rating', 'power', 'W', model.watts),
    num('ratedv', 'Rated voltage (RMS)', 'voltage', 'V', model.volts),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}

export function transformerQuantities(model: TransformerModel, r: PartResult): Quantity[] {
  const p = transformerParams(model);
  const v1 = r.voltage;
  const v2 = r.volts?.sec ?? 0;
  const stress = transformerStress(model, r);
  return [
    num('vp', 'V primary', 'voltage', 'V', v1),
    num('ip', 'I primary', 'current', 'A', r.pins.p1 ?? 0),
    num('vs', 'V secondary', 'voltage', 'V', v2),
    num('is', 'I secondary', 'current', 'A', r.pins.s1 ?? 0),
    num('p', 'P lost', 'power', 'W', r.power),
    num('n', 'Turns ratio', 'ratio', ':1', p.n),
    num('ratedp', 'Primary rating', 'voltage', 'V', model.primaryVolts),
    num('rateds', 'Secondary rating', 'voltage', 'V', model.secondaryVolts),
    num('va', 'Rating', 'power', 'VA', TRANSFORMER_VA),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}

export function bridgeQuantities(model: BridgeModel, r: PartResult): Quantity[] {
  const stress = bridgeStress(model, r);
  return [
    num('v', 'V out', 'voltage', 'V', r.voltage),
    num('i', 'I out', 'current', 'A', r.current),
    num('p', 'P lost', 'power', 'W', r.power),
    num('vac', 'V in (AC)', 'voltage', 'V', r.volts?.ac ?? 0),
    num('iavg', 'I out (average)', 'current', 'A', r.volts?.['i.avg'] ?? 0),
    num('ipk', 'Largest diode current', 'current', 'A', r.volts?.['i.peak'] ?? 0),
    num('vr', 'Largest reverse voltage', 'voltage', 'V', r.volts?.vr ?? 0),
    num('ratedv', 'Rated voltage', 'voltage', 'V', model.volts),
    num('rateda', 'Rated current (average)', 'current', 'A', model.amps),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}

export function changeoverQuantities(model: ChangeoverModel, r: PartResult): Quantity[] {
  return [
    num('i', 'I', 'current', 'A', r.current),
    num('v', 'V across the contact', 'voltage', 'V', r.voltage),
    num('p', 'P', 'power', 'W', r.power),
    text('state', 'Position', model.no ? 'common joined to NO' : 'common joined to NC'),
  ];
}
