const fs = require('fs'),
  path = require('path');
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.controller.ts') && !e.name.includes('.spec.')) out.push(p);
  }
  return out;
}
const files = walk('services');
const routes = [];
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  // token scan: every @Controller and every method decorator, in order
  const tok =
    /@Controller\(\s*(?:\{([^}]*)\}|['"`]([^'"`]*)['"`])?\s*\)|@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
  let m,
    prefix = '',
    version = '1',
    seen = false;
  while ((m = tok.exec(txt))) {
    const line = txt.slice(0, m.index).split('\n').length;
    if (m[0].startsWith('@Controller')) {
      seen = true;
      prefix = '';
      version = '1';
      if (m[1]) {
        const pm = m[1].match(/path:\s*['"`]([^'"`]*)['"`]/);
        if (pm) prefix = pm[1];
        const vm = m[1].match(/version:\s*['"`]([^'"`]*)['"`]/);
        if (vm) version = vm[1];
        else version = null;
      } else if (m[2] !== undefined) {
        prefix = m[2];
        version = null;
      } else {
        prefix = '';
        version = null;
      }
      continue;
    }
    if (!seen) continue;
    const sub = m[4] || '';
    const base = version ? '/api/v' + version + '/' : '/api/';
    const full = (base + prefix + '/' + sub).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    routes.push({
      method: m[3].toUpperCase(),
      route: full,
      file: f.split(path.sep).join('/'),
      line,
    });
  }
}
fs.writeFileSync('.audit_tmp/routes.json', JSON.stringify(routes, null, 1));
console.log('controllers ' + files.length + ' routes ' + routes.length);
