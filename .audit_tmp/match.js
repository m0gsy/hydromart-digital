const fs = require('fs');
const routes = JSON.parse(fs.readFileSync('.audit_tmp/routes.json', 'utf8'));
const paths = JSON.parse(fs.readFileSync('.audit_tmp/paths.json', 'utf8'));

const WILD = '';

function segToRe(s) {
  if (s.startsWith(':')) return '[^/]+';
  if (s === WILD) return '[^/]+';
  // split on WILD, escape literals
  return s
    .split(WILD)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c))
    .join('[^/]*');
}

function toRe(p) {
  return new RegExp('^' + p.split('/').map(segToRe).join('/') + '$');
}

// route pattern -> matches a concrete path
const rx = routes.map((r) => ({ ...r, re: toRe(r.route) }));

const bad = [];
const ok = [];
for (const p of paths) {
  let u = p.path.split('?')[0];
  const parts = u.split('/').filter(Boolean);
  parts.shift(); // gateway segment
  let rest = '/' + parts.join('/');
  if (!/^\/api\/v/.test(rest)) continue;
  const norm = rest.replace(/\$\{[^}]*\}/g, WILD);
  const clientRe = toRe(norm);
  // a match if either direction matches: client wildcard vs route param
  const hit = rx.find(
    (r) =>
      clientRe.test(r.route.replace(/:[^/]+/g, 'X')) ||
      r.re.test(norm.replace(new RegExp(WILD, 'g'), 'X')),
  );
  if (!hit) bad.push({ ...p, rest });
  else ok.push({ ...p, hit: hit.file + ':' + hit.line });
}
console.log('unmatched ' + bad.length + ' of ' + (bad.length + ok.length));
for (const b of bad) console.log(b.file + ':' + b.line + '  ' + b.path);
