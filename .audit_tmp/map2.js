const fs = require('fs'),
  path = require('path');
const dir = 'apps/web/src/lib/endpoints';
const map = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'index.ts')) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  const stack = []; // {indent, name}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const indent = line.match(/^\s*/)[0].length;
    const kv = line.match(/^\s*([A-Za-z0-9_]+)\s*:/);
    if (!kv) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const full = stack
      .map((s) => s.name)
      .concat(kv[1])
      .join('.');
    // is this an object opener?
    if (/:\s*\{\s*$/.test(line.replace(/\/\/.*$/, ''))) {
      stack.push({ indent, name: kv[1] });
      continue;
    }
    // value: look at this line and following lines until indent returns to <= indent
    let buf = line;
    for (let j = i + 1; j < lines.length; j++) {
      const l2 = lines[j];
      if (!l2.trim()) {
        buf += '\n';
        continue;
      }
      const ind2 = l2.match(/^\s*/)[0].length;
      if (ind2 <= indent) break;
      buf += '\n' + l2;
    }
    const pm = buf.replace(/^\s*\/\/.*$/gm, '').match(/[`'"](\/[A-Za-z0-9_\-\/$\{\}.?=&:%]*)[`'"]/);
    if (pm) map.set(full, { path: pm[1], file: f, line: i + 1 });
  }
}
module.exports = map;
if (require.main === module) {
  console.log('keys ' + map.size);
  for (const k of ['loyalty.me', 'cart.item', 'depots.browse', 'orders.deliveryOptions'])
    console.log(k, JSON.stringify(map.get(k)));
}
