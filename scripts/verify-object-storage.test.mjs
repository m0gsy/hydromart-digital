// Drives verify-object-storage.mjs against a fake S3 (in-process HTTP server): private mode
// deletes the policy and never puts one, passes on anonymous 403, FAILS on anonymous 200;
// public mode still puts a policy; the pod bucket in public mode is refused.
//   node scripts/verify-object-storage.test.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

async function run({ bucket, mode, anonGet, delStatus = 204 }) {
  const calls = [];
  const objects = new Map();
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const signed = Boolean(req.headers.authorization);
    calls.push(`${req.method} ${u.pathname}${u.search.split('&')[0]}`);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (u.search.startsWith('?policy') && req.method === 'DELETE') return res.writeHead(204).end();
      if (u.search.startsWith('?policy')) return res.writeHead(204).end();
      if (u.search.startsWith('?acl') || u.search.startsWith('?lifecycle')) {
        return req.method === 'GET' ? res.writeHead(404).end() : res.writeHead(200).end();
      }
      if (u.search.startsWith('?list-type')) return res.writeHead(403).end();
      if (req.method === 'PUT') {
        objects.set(u.pathname, Buffer.concat(chunks));
        return res.writeHead(200, { ETag: '"x"' }).end();
      }
      if (req.method === 'GET') {
        if (!signed) return res.writeHead(anonGet).end(anonGet === 200 ? objects.get(u.pathname) : undefined);
        return res.writeHead(200).end(objects.get(u.pathname));
      }
      if (req.method === 'DELETE') {
        objects.delete(u.pathname);
        return res.writeHead(delStatus).end();
      }
      res.writeHead(200).end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const env = {
    ...process.env,
    STORAGE_S3_ENDPOINT: base,
    STORAGE_S3_BUCKET: bucket,
    STORAGE_S3_ACCESS_KEY_ID: 'k',
    STORAGE_S3_SECRET_ACCESS_KEY: 's',
    STORAGE_PUBLIC_BASE_URL: `${base}/${bucket}`,
    STORAGE_PRIVATE: mode === 'private' ? '1' : '',
  };
  const child = spawn('node', ['scripts/verify-object-storage.mjs'], { env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  srv.close();
  return { code, out, calls };
}

const putPolicy = (c) => c.calls.some((x) => x.startsWith('PUT') && x.includes('?policy'));
const delPolicy = (c) => c.calls.some((x) => x.startsWith('DELETE') && x.includes('?policy'));

let r = await run({ bucket: 'hydromart-pod', mode: 'private', anonGet: 403 });
assert.equal(r.code, 0, r.out);
assert.ok(delPolicy(r) && !putPolicy(r), 'private: delete, never put');

r = await run({ bucket: 'hydromart-pod', mode: 'private', anonGet: 200 });
assert.equal(r.code, 1);
assert.match(r.out, /still publicly readable/);

r = await run({ bucket: 'hydromart-pod', mode: 'private', anonGet: 404 });
assert.equal(r.code, 1);
assert.match(r.out, /NOT proven/);

r = await run({ bucket: 'hydromart-pod', mode: 'public', anonGet: 200 });
assert.equal(r.code, 1);
assert.match(r.out, /is private/);
assert.ok(r.calls.length === 0, 'refused before any S3 call');

r = await run({ bucket: 'hydromart-products', mode: 'public', anonGet: 200 });
assert.equal(r.code, 0, r.out);
assert.ok(putPolicy(r) && !delPolicy(r), 'public: put, never delete');
// the probe is deleted after the proof; a refused delete only warns
assert.ok(r.calls.some((x) => x.startsWith('DELETE /hydromart-products/probe/')), 'probe deleted');
r = await run({ bucket: 'hydromart-pod', mode: 'private', anonGet: 403, delStatus: 403 });
assert.equal(r.code, 0, r.out);
assert.match(r.out, /could not delete probe object/);
// the face bucket: public mode refused before any S3 call, private mode accepted (probe still deleted)
r = await run({ bucket: 'hydromart-facer', mode: 'public', anonGet: 200 });
assert.equal(r.code, 1);
assert.match(r.out, /face-photo bucket|is private/);
assert.ok(r.calls.length === 0, 'refused before any S3 call');
r = await run({ bucket: 'hydromart-facer', mode: 'private', anonGet: 403 });
assert.equal(r.code, 0, r.out);
assert.ok(delPolicy(r) && !putPolicy(r), 'facer private: delete, never put');
assert.ok(r.calls.some((x) => x.startsWith('DELETE /hydromart-facer/probe/')), 'facer probe deleted');
console.log('verify-object-storage tests passed');
