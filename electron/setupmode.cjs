'use strict';
// Decides whether this start of the exe is the app, the installer or the uninstaller.
//  - `--uninstall`, or an exe named "Uninstall ..." (the hard link the installer leaves next to the app): the uninstaller.
//  - `--setup`, or the single-file build's own marker (electron-builder's portable build sets
//    PORTABLE_EXECUTABLE_FILE when it starts the unpacked app): the installer.
//  - anything else: the app.

const PORTABLE_VARS = ['PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_APP_FILENAME'];

/** 'install' | 'uninstall' | null (the normal app). */
function detectMode(argv, env, execPath = '') {
  if (argv.includes('--uninstall') || /^uninstall/i.test(execPath.split(/[\\/]/).pop())) return 'uninstall';
  if (argv.includes('--setup') || env.PORTABLE_EXECUTABLE_FILE) return 'install';
  return null;
}

/** The environment for starting the installed app from the installer: without the markers that would make it an installer too. */
function appEnv(env) {
  const clean = { ...env };
  for (const name of PORTABLE_VARS) delete clean[name];
  return clean;
}

module.exports = { detectMode, appEnv, PORTABLE_VARS };
