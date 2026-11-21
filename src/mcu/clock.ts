// The emulated clock of a board: how fast the chip runs, in hertz. It is board
// data (PartState.clockHz, saved in the project) and is read when the board is
// built and started (Run from stopped, Reset), so a change reaches the chip at
// the next start. Only the emulated chip changes: the firmware is still built
// for 16 MHz (the compiler pack's Arduino core is precompiled for it), so
// delay(), millis() and the baud rate count in 16 MHz time: the same program
// as on a real chip that is clocked slower than its firmware expects.

/** The clock every board has until it is changed. */
export const DEFAULT_CLOCK_HZ = 16_000_000;

/** What the clock chooser offers, in hertz. */
export const CLOCK_CHOICES: readonly number[] = [1_000_000, 8_000_000, 16_000_000, 20_000_000];

/** "16 MHz", "1 MHz", "8 MHz". */
export function formatClock(hz: number): string {
  const mhz = hz / 1_000_000;
  return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(1)} MHz`;
}

/** A board part's clock (its saved choice, else the default). */
export function boardClockHz(part: { state?: { clockHz?: number } }): number {
  const hz = part.state?.clockHz;
  return typeof hz === 'number' && CLOCK_CHOICES.includes(hz) ? hz : DEFAULT_CLOCK_HZ;
}
