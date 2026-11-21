import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { folderNameProblem, previewPath } from './foldername';

const { checkFolderName } = createRequire(import.meta.url)('../../electron/folderipc.cjs');

describe('folderNameProblem', () => {
  it('accepts ordinary names', () => {
    for (const ok of ['demo1', 'My project', 'v1.2 final', '  padded  ']) expect(folderNameProblem(ok)).toBeNull();
  });
  it('refuses empty, reserved and unsafe names', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'nul', 'COM1', 'trail.', 'x'.repeat(101)]) {
      expect(folderNameProblem(bad), bad).not.toBeNull();
    }
  });
  it('agrees with the rule the Electron side enforces', () => {
    for (const name of ['demo1', 'My project', '', '..', 'a/b', 'nul', 'trail.', 'x'.repeat(101), 'ok name']) {
      expect(folderNameProblem(name) === null, name).toBe(checkFolderName(name) === null);
    }
  });
});

describe('previewPath', () => {
  it('joins with the separator of the parent', () => {
    expect(previewPath('C:\\Users\\me\\Documents', ' demo ')).toBe('C:\\Users\\me\\Documents\\demo');
    expect(previewPath('/home/me', 'demo')).toBe('/home/me/demo');
    expect(previewPath('C:\\', 'demo')).toBe('C:\\demo');
  });
});
