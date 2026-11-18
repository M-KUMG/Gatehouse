// Progress output for downloads: one line per file. On a terminal the percentage updates in place; otherwise
// (CI, pipes, log files) a line is printed at every 25 % for files over 1 MiB.

import { formatBytes } from './download.mjs';

export function progressPrinter(prefix, out = process.stdout) {
  const tty = Boolean(out.isTTY);
  let lastStep = -1;
  return {
    update(received, total) {
      const pct = Math.floor((received / total) * 100);
      if (tty) {
        out.write(`\r${prefix} ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)   `);
      } else if (total > 1024 * 1024) {
        const step = Math.floor(pct / 25);
        if (step !== lastStep && pct < 100) {
          lastStep = step;
          out.write(`${prefix} ${pct}%\n`);
        }
      }
    },
    done(message) {
      out.write(`${tty ? '\r' : ''}${prefix} ${message}${tty ? '                    ' : ''}\n`);
    },
  };
}
