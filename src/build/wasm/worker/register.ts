// Registers the browser (Worker) compiler for every board type that has a
// board profile of the same id (uno, nano: a Nano part added later only
// needs the type id 'nano'). `available` follows getCompilerStatus(): not
// 'unavailable' (a needed download happens during the build, with progress).
// Where the packs are not served (a host without them, Electron without
// toolchain/packs/) the status is 'unavailable' and boards fall back to their .hex file.

import type { Compiler } from '../../compiler';
import { BOARD_PROFILES, getBoardProfile } from '../profiles';
import { WasmAvrCompiler } from '../wasmcompiler';
import { WasmCompilerClient, type WasmCompilerClientOptions } from './client';

export interface BrowserCompilers {
  client: WasmCompilerClient;
  /** Board type ids registered. */
  boardTypes: string[];
  /** Undo every registration and stop the Worker. */
  dispose(): void;
}

let active: BrowserCompilers | null = null;

/** The registered browser compilers (for the loading screen: client.getCompilerStatus / prefetch), or null. */
export function browserCompilers(): BrowserCompilers | null {
  return active;
}

export function registerBrowserCompilers(
  register: (boardTypeId: string, compiler: Compiler) => () => void,
  options: WasmCompilerClientOptions = {},
): BrowserCompilers {
  active?.dispose();
  const client = new WasmCompilerClient(options);
  const boardTypes = Object.keys(BOARD_PROFILES);
  const undo = boardTypes.map((type) =>
    register(
      type,
      new WasmAvrCompiler({
        compileWith: client.compileWith,
        profileFor: getBoardProfile,
        available: async () => (await client.getCompilerStatus(type)).status !== 'unavailable',
      }),
    ),
  );
  const registered: BrowserCompilers = {
    client,
    boardTypes,
    dispose: () => {
      for (const u of undo) u();
      client.terminate();
      if (active === registered) active = null;
    },
  };
  active = registered;
  return registered;
}
