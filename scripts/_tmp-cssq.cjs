const fs = require('fs');
const css = fs.readFileSync('design/v3/assets/running.css', 'utf8');
const want = process.argv[2].split(',');
for (const w of want) {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '[^\\n]*', 'g');
  const m = css.match(re);
  if (m) console.log(m.slice(0, 3).join('\n'));
  else console.log('MISSING: ' + w);
  console.log('---');
}
