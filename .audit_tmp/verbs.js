const fs = require('fs'),
  path = require('path');
const dir = 'apps/web/src/lib/endpoints';

// --- build endpoints.<a>.<b>[.<c>] -> path using a name stack ---
const map = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'index.ts')) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  const stack = [];
  let pend = null; // { name, buf, line, depth }
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '');
    const trimmed = code.trim();
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;

    const objOpen = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*\{$/);
    if (objOpen) {
      if (pend) {
        flush();
      }
      stack.push(objOpen[1]);
      depth += 1;
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z0-9_]+)\s*:/);
    if (kv && depth >= 1) {
      if (pend) flush();
      pend = { name: kv[1], buf: code, line: i + 1, d: depth };
      // if the value opens braces that close on the same line, fine
      const net = opens - closes;
      if (net === 0) {
        flush();
      } else {
        depth += net;
      }
      continue;
    }
    if (pend) {
      pend.buf += '\n' + code;
      depth += opens - closes;
      if (depth <= pend.d) flush();
      continue;
    }
    // plain structural line
    const net = opens - closes;
    if (net < 0) {
      for (let k = 0; k < -net; k++) {
        stack.pop();
        depth--;
      }
    } else depth += net;
  }
  function flush() {
    if (!pend) return;
    const pm = pend.buf.match(/[`'"](\/[A-Za-z0-9_\-\/$\{\}.?=&:%]*)[`'"]/);
    if (pm) map.set(stack.concat(pend.name).join('.'), { path: pm[1], file: f, line: pend.line });
    depth = pend.d;
    pend = null;
  }
}
console.log('endpoint keys resolved: ' + map.size);

const routes = JSON.parse(fs.readFileSync('.audit_tmp/routes.json', 'utf8'));
function toRe(p) {
  return new RegExp(
    '^' +
      p
        .split('/')
        .map((s) =>
          s.startsWith(':') || s === 'ZW'
            ? '[^/]+'
            : s
                .split('ZW')
                .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c))
                .join('[^/]*'),
        )
        .join('/') +
      '$',
  );
}
const rx = routes.map((r) => ({ ...r, re: toRe(r.route) }));

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const VERB = {
  get: 'GET',
  getCached: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  del: 'DELETE',
};
const problems = [];
let checked = 0;
const unresolved = [];
for (const f of walk('apps/web/src')) {
  if (f.includes('endpoints')) continue;
  const txt = fs.readFileSync(f, 'utf8');
  const re =
    /api\.(get|getCached|post|put|patch|del)\s*(?:<[^;()]*?>)?\s*\(\s*endpoints\.([A-Za-z0-9_.]+)/g;
  let m;
  while ((m = re.exec(txt))) {
    const line = txt.slice(0, m.index).split('\n').length;
    const key = m[2].replace(/\.$/, '');
    const ent = map.get(key);
    if (!ent) {
      unresolved.push(f.split(path.sep).join('/') + ':' + line + ' ' + key);
      continue;
    }
    checked++;
    const parts = ent.path.split('?')[0].split('/').filter(Boolean);
    parts.shift();
    const norm = ('/' + parts.join('/')).replace(/\$\{[^}]*\}/g, 'ZW');
    const cRe = toRe(norm);
    const want = VERB[m[1]];
    const hits = rx.filter(
      (r) => cRe.test(r.route.replace(/:[^/]+/g, 'X')) || r.re.test(norm.replace(/ZW/g, 'X')),
    );
    if (!hits.length) {
      problems.push({ kind: 'NO-ROUTE', f, line, key, path: ent.path, want });
      continue;
    }
    if (!hits.some((r) => r.method === want))
      problems.push({
        kind: 'VERB-MISMATCH',
        f,
        line,
        key,
        path: ent.path,
        want,
        have: [...new Set(hits.map((r) => r.method))].join('/'),
      });
  }
}
console.log(
  'callsites checked ' +
    checked +
    ', unresolved ' +
    unresolved.length +
    ', problems ' +
    problems.length,
);
for (const p of problems)
  console.log(
    p.kind +
      ' ' +
      p.f.split(path.sep).join('/') +
      ':' +
      p.line +
      ' ' +
      p.key +
      ' ' +
      p.path +
      ' want=' +
      p.want +
      ' have=' +
      (p.have || 'none'),
  );
fs.writeFileSync('.audit_tmp/unresolved.txt', unresolved.join('\n'));
