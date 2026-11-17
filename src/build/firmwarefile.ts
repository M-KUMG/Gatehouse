// The only compiler for now: it compiles nothing and runs the firmware file
// found in the board folder (see pickFirmware).

import type { BuildInput, BuildResult, Compiler } from './compiler';
import { FIRMWARE_FILE, pickFirmware } from './firmware';

const SOURCE = /\.(ino|c|cpp)$/i;

export const NOT_COMPILED_NOTE = `Sketch files are not compiled yet: running ${FIRMWARE_FILE}`;

export class FirmwareFileCompiler implements Compiler {
  readonly id = 'firmware-file';

  available(): boolean {
    return true;
  }

  build(input: BuildInput): Promise<BuildResult> {
    const pick = pickFirmware(input);
    if (!pick.ok) return Promise.resolve({ ok: false, errors: [pick.error] });
    const hasSketch = Object.keys(input.files).some((p) => SOURCE.test(p));
    return Promise.resolve({
      ok: true, hex: pick.hex, source: 'firmware-file', name: pick.path, messages: hasSketch ? [NOT_COMPILED_NOTE] : [],
    });
  }
}
