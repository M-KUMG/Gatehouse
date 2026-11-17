import { run, sysfile } from './tc.mjs';
import { readFileSync } from 'node:fs';
const L5 = '/sysroot/avr/lib/avr5', LG = '/sysroot/lib/gcc/avr/7.3.0/avr5';
const files = { [`${L5}/crtatmega328p.o`]: sysfile('sysroot/avr/lib/avr5/crtatmega328p.o'), [`${L5}/libc.a`]: sysfile('sysroot/avr/lib/avr5/libc.a'), [`${L5}/libm.a`]: sysfile('sysroot/avr/lib/avr5/libm.a'), [`${LG}/libgcc.a`]: sysfile('sysroot/lib/gcc/avr/7.3.0/avr5/libgcc.a'), '/arduino/core.a': sysfile('arduino/core.a'), '/b/s.o': readFileSync('outs/a_blink.s.o') };
for (const withScript of [false, true]) {
  const f = { ...files }; if (withScript) f['/sysroot/avr/lib/ldscripts/avr5.xn'] = sysfile('sysroot/avr/lib/ldscripts/avr5.xn');
  const r = await run('ld', ['-m', 'avr5', '-Tdata=0x800100', '--gc-sections', '-o', '/b/fw.elf', `${L5}/crtatmega328p.o`, '/b/s.o', '/arduino/core.a', `-L${L5}`, `-L${LG}`, "-L/sysroot/avr/lib", '-lm', '-lc', '-lgcc'], f);
  console.log('script at /sysroot/avr/lib/ldscripts:', withScript, 'exit', r.code, r.stderr.join(' | '));
}
