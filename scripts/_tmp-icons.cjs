const fs = require('fs');
const icons = new Set();
for (const f of ['running.js', 'icons-extra.js']) {
  const js = fs.readFileSync('design/v3/assets/' + f, 'utf8');
  for (const m of js.matchAll(/^\s+"?([a-z0-9-]+)"?:\s*'/gm)) icons.add(m[1]);
  for (const m of js.matchAll(/^\s+"([a-z0-9-]+)":\s*"/gm)) icons.add(m[1]);
}
console.log('TOTAL', icons.size);
const want = process.argv[2].split(',');
console.log('MISSING:', want.filter(w => !icons.has(w)).join(', ') || '(none)');
