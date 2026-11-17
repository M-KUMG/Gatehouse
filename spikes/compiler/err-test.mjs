import { PROFILES } from './tc.mjs';
import { buildSketch } from './sketch.mjs';
const r = await buildSketch(PROFILES.uno, {
  'main.ino': 'void setup() { helper(); }\nvoid loop() {}\n',
  'helpers.ino': 'void helper() {\n  int x = undefinedThing;\n}\n',
  'util.cpp': '#include <Arduino.h>\nvoid u() { return 5 }\n',
}, { mainName: 'main.ino' });
console.log(r.errors.join('\n'));
