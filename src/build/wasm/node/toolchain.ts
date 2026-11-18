/// <reference types="node" />
// NODE ONLY: where the toolchain is for tests and scripts. GATEHOUSE_TOOLCHAIN
// (an unpacked toolchain folder: tools/ + sysroot/) wins, else `toolchain/`
// at the repository root (fetched by the toolchain script). Tests that need
// the real tools are skipped when neither exists.

import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isToolchainDir, NodeToolRunner } from './noderunner';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

export interface ToolchainLocation {
  dir?: string;
  /** Why there is no toolchain (for a skip message). */
  reason: string;
}

export function findToolchain(): ToolchainLocation {
  const env = process.env.GATEHOUSE_TOOLCHAIN;
  if (env) {
    return isToolchainDir(env)
      ? { dir: env, reason: `GATEHOUSE_TOOLCHAIN=${env}` }
      : { reason: `GATEHOUSE_TOOLCHAIN=${env} is not a toolchain folder (tools/*.mjs, tools/*.wasm[.gz], sysroot/arduino/core.a)` };
  }
  const local = join(REPO_ROOT, 'toolchain');
  return isToolchainDir(local)
    ? { dir: local, reason: local }
    : { reason: `no toolchain: set GATEHOUSE_TOOLCHAIN to an unpacked toolchain folder or fetch one into ${local}` };
}

let shared: NodeToolRunner | undefined;

/** One runner per process (the WebAssembly modules are compiled once). */
export function sharedNodeRunner(dir: string): NodeToolRunner {
  shared ??= new NodeToolRunner(dir);
  return shared;
}
