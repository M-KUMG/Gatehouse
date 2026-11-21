// Integrated circuits other than the logic gates (gateparts.ts) and the
// half-bridge driver (inline in parts.ts): the 555 timer and the dual op-amp.
// Both are 8-pin DIPs (art/dip8.ts) drawn and numbered like the real packages,
// behavioural models in sim/timer555.ts and sim/opamp.ts.
//
// Not mirrorable: a mirrored DIP is the chip upside down (turns cover every
// real placement), like the driver.

import { dip8Art, dip8Pins } from './art/dip8';
import { opampReadout, timerReadout } from './devicereadouts';
import type { PartType } from './parts';
import { opampStress } from './sim/opamp';
import { timerStress } from './sim/timer555';

const TIMER = dip8Art({
  title: 'NE555',
  subtitle: 'TIMER',
  bottom: ['GND', 'TRIG', 'OUT', 'RESET'],
  top: ['VCC', 'DISCH', 'THR', 'CTRL'], // left to right: pins 8, 7, 6, 5
});

const OPAMP = dip8Art({
  title: 'LM358',
  subtitle: 'DUAL OP-AMP',
  bottom: ['OUT1', 'IN1−', 'IN1+', 'GND'],
  top: ['V+', 'OUT2', 'IN2−', 'IN2+'],
});

export const TIMER_PIN_POINTS = dip8Pins([
  ['gnd', 'GND (1, ground)'],
  ['trig', 'TRIG (2, trigger: below 1/3 of the supply sets the output)'],
  ['out', 'OUT (3, output)'],
  ['reset', 'RESET (4, low = reset; tie to VCC)'],
  ['ctrl', 'CTRL (5, control voltage; the upper threshold)'],
  ['thr', 'THR (6, threshold: above 2/3 of the supply clears the output)'],
  ['disch', 'DISCH (7, discharge)'],
  ['vcc', 'VCC (8, supply)'],
]);

export const OPAMP_PIN_POINTS = dip8Pins([
  ['o1', 'OUT1 (1)'],
  ['n1', 'IN1− (2, inverting input)'],
  ['p1', 'IN1+ (3, non-inverting input)'],
  ['gnd', 'GND / V− (4, negative supply)'],
  ['p2', 'IN2+ (5, non-inverting input)'],
  ['n2', 'IN2− (6, inverting input)'],
  ['o2', 'OUT2 (7)'],
  ['vcc', 'V+ (8, positive supply)'],
]);

export const IC_PARTS: readonly PartType[] = [
  {
    id: 'timer555', name: '555 timer (NE555)', ...TIMER.art,
    pins: TIMER_PIN_POINTS,
    readout: timerReadout,
    warnWhen: (r) => {
      const st = timerStress(r.volts?.vcc ?? r.voltage, r.pins.out ?? 0);
      return st.level === 'ok' ? null : st.reason;
    },
    burnWhen: (r) => {
      const st = timerStress(r.volts?.vcc ?? r.voltage, r.pins.out ?? 0);
      return st.level === 'burn' ? st.reason : null;
    },
    variant: (s) => (s.burned ? { key: 'burned', svg: TIMER.burned } : null),
    sim: (s) => (s.burned ? { kind: 'open' } : { kind: 'timer555' }),
  },
  {
    id: 'opamp', name: 'Dual op-amp (LM358)', ...OPAMP.art,
    pins: OPAMP_PIN_POINTS,
    readout: opampReadout,
    warnWhen: (r) => {
      const st = opampStress(r.voltage, [r.pins.o1 ?? 0, r.pins.o2 ?? 0]);
      return st.level === 'ok' ? null : st.reason;
    },
    burnWhen: (r) => {
      const st = opampStress(r.voltage, [r.pins.o1 ?? 0, r.pins.o2 ?? 0]);
      return st.level === 'burn' ? st.reason : null;
    },
    variant: (s) => (s.burned ? { key: 'burned', svg: OPAMP.burned } : null),
    sim: (s) => (s.burned ? { kind: 'open' } : { kind: 'opamp' }),
  },
];
