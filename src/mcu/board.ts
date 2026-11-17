// What every emulated board offers the rest of the app. Everything that
// crosses this interface is plain data (strings, numbers, arrays), so an
// emulator can later move into a Web Worker with the same calls turned
// into messages: run(cycles) -> SliceResult, setInputs(BoardInputs).

/**
 * How one io pin is set up by the program, one letter per pin in the
 * board's `io` order: H output high, L output low, Z input (high
 * impedance), P input with the internal pull-up on.
 */
export type DriveCode = 'H' | 'L' | 'Z' | 'P';

export interface IoPinDef {
  /** Pin id of the board part (e.g. "d13"). */
  id: string;
  /** Has an ADC channel: its voltage is passed to analogRead. */
  analog: boolean;
}

/** The pins' drive codes changed at a CPU cycle. */
export interface PinEvent {
  cycle: number;
  drives: string;
}

/** What happened during one run() call. */
export interface SliceResult {
  /** CPU cycles (since reset) at the start and end of the slice. */
  start: number;
  end: number;
  /** Drive codes at the start of the slice. */
  drives: string;
  /** Changes within the slice, in order. */
  events: PinEvent[];
  /**
   * Bytes the program sent during the slice, by serial port id (see
   * BoardSpec.serialPorts). Only ports that sent something are present.
   */
  serial: SerialBytes;
}

/** Bytes per serial port id. */
export type SerialBytes = Record<string, number[]>;

/**
 * One serial port a kind of board offers (an AVR USART, an RP2040 UART, a
 * USB CDC port...). Data only: the serial console lists these, e.g. a Mega
 * would have four entries ("Serial", "Serial1".."Serial3"), a Pico three
 * ("UART0", "UART1", "USB serial").
 */
export interface SerialPortDef {
  /** Stable id, used as the key in SliceResult.serial and the serial store. */
  id: string;
  /** Shown to the person, e.g. "Serial (USART0)". */
  name: string;
}

/** What the circuit feeds back to the pins, per io pin (in `io` order). */
export interface BoardInputs {
  /** Logic level seen by each pin's input buffer. */
  digital: boolean[];
  /** Volts at each pin (used for pins with an ADC channel). */
  analog: number[];
}

/** Electrical numbers of a board's pins, used by the mixed-signal bridge. */
export interface BoardElectrical {
  /** Supply rails by pin id, in volts against gnd. */
  rails: Record<string, number>;
  /** Volts of an output that is high. */
  vcc: number;
  /** Output resistance of a pin driving high or low. */
  outputOhms: number;
  /** Internal pull-up resistor. */
  pullupOhms: number;
  /** Leakage resistance of a high-impedance input. */
  inputOhms: number;
  /** Input thresholds: above `highAbove` reads 1, below `lowBelow` reads 0, between keeps the last value. */
  highAbove: number;
  lowBelow: number;
}

/** A program stored with a board part (plain data, saved in project files). */
export interface BoardProgram {
  /** Shown to the person, e.g. the file name. */
  name: string;
  /** Intel HEX text of the compiled program. */
  hex: string;
}

/** Everything the app needs to know about one kind of board. */
export interface BoardSpec {
  flashBytes: number;
  io: readonly IoPinDef[];
  electrical: BoardElectrical;
  /** Serial ports, in the order the console lists them (first = default). */
  serialPorts: readonly SerialPortDef[];
  /** A new emulator, reset, with `flash` as its program memory. */
  create(flash: Uint8Array): BoardEmulator;
}

export interface BoardEmulator {
  readonly clockHz: number;
  readonly io: readonly IoPinDef[];
  readonly electrical: BoardElectrical;
  /** CPU cycles since reset. */
  readonly cycles: number;
  /** Current drive codes, one per io pin. */
  drives(): string;
  /** Execute at least `cycles` CPU cycles (whole instructions; the overshoot is made up next time). */
  run(cycles: number): SliceResult;
  setInputs(inputs: BoardInputs): void;
  /**
   * Baud rate the program set up on a serial port (from the chip's baud
   * registers), or null when the port is not enabled or the rate is unknown.
   */
  serialBaud(port: string): number | null;
}
