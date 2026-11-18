// Messages between the UI thread (client.ts) and the compile Worker
// (compiler.worker.ts / engine.ts). Plain structured-clone data.

import type { DownloadProgress } from '../../compiler';
import type { CompileProgress, CompileResult } from '../pipeline';
import type { SketchInput } from '../sketch';

export type WorkerRequest =
  | { id: number; type: 'compile'; baseUrl: string; sketch: SketchInput; profileId: string }
  /** Load (download if needed) the base packs of a profile. */
  | { id: number; type: 'prefetch'; baseUrl: string; profileId: string };

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: CompileProgress }
  | { id: number; type: 'download'; download: DownloadProgress }
  /** `fatal`: the Worker should be replaced (out of memory, crash). */
  | { id: number; type: 'result'; result: CompileResult; fatal?: boolean }
  | { id: number; type: 'prefetched'; ok: boolean; error?: string; fatal?: boolean };
