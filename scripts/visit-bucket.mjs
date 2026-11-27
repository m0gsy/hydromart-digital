// Create (once) the PRIVATE bucket for supervisor visit photos (HD-15B), then prove it private.
//
// Owner, 27 Nov 2026: NEO Object Storage keys belong to an ACCOUNT, not to one bucket, and the
// owner chose to reuse the delivery account's key instead of opening a new account. So the only
// thing between a stranger and a photo that can show staff faces is this bucket being private:
// no bucket policy, ACL private, and both an anonymous LIST and an anonymous GET of an object
// written a second earlier refused. Idempotent: pressing it again re-asserts and re-proves.
//
//   . ./scripts/load-env.sh && node scripts/visit-bucket.mjs     (Deploy mode `visit-bucket`)
//
// Exit 0 = private and writable, 1 = not proven private (or the create failed), 2 = refused (another
// service's bucket) or .env incomplete.
import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutBucketAclCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const env = (k) => process.env[k] || '';
const endpoint = env('STORAGE_S3_ENDPOINT').replace(/\/+$/, '');
const region = env('STORAGE_S3_REGION') || 'us-east-1';
const bucket = env('VISIT_STORAGE_S3_BUCKET') || 'hydromart-visits';
// A dedicated VISIT_* key wins if one is ever made; until then delivery's, as compose does.
const dedicated = Boolean(env('VISIT_STORAGE_S3_ACCESS_KEY_ID') && env('VISIT_STORAGE_S3_SECRET_ACCESS_KEY'));
const prefix = dedicated ? 'VISIT' : 'DELIVERY';
const accessKeyId = env(`${prefix}_STORAGE_S3_ACCESS_KEY_ID`);
const secretAccessKey = env(`${prefix}_STORAGE_S3_SECRET_ACCESS_KEY`);

// Before any S3 call: this script clears policies and sets ACLs, so pointed at a live bucket it would
// strip hydromart-pod's deliberate public-read policy (PoD links) or touch the face bucket. The names
// other services use (from the .env, plus the known ones) are refused outright.
const taken = new Set(['hydromart-pod', 'hydromart-products', 'hydromart-facer', 'hydromart-avatars']);
for (const [k, v] of Object.entries(process.env)) {
  if (v && k.endsWith('_STORAGE_S3_BUCKET') && k !== 'VISIT_STORAGE_S3_BUCKET') taken.add(v);
}
if (taken.has(bucket)) {
  console.error(`!! refusing: bucket "${bucket}" belongs to another service; visit photos need their own`);
  process.exit(2);
}

const missing = [
  !endpoint && 'STORAGE_S3_ENDPOINT',
  !accessKeyId && `${prefix}_STORAGE_S3_ACCESS_KEY_ID`,
  !secretAccessKey && `${prefix}_STORAGE_S3_SECRET_ACCESS_KEY`,
].filter(Boolean);
if (missing.length) {
  console.error(`!! missing from .env: ${missing.join(' ')}`);
  process.exit(2);
}
console.log(`bucket ${bucket} at ${endpoint}, key of ${prefix}`);

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

try {
  await s3.send(new CreateBucketCommand({ Bucket: bucket, ACL: 'private' }));
  console.log('✓ bucket created');
} catch (e) {
  // BucketAlreadyExists = the name belongs to ANOTHER account: never write photos there.
  if (e.name !== 'BucketAlreadyOwnedByYou') {
    console.error(`!! create failed: ${e.name}: ${e.message}`);
    process.exit(1);
  }
  console.log('✓ bucket already exists and is ours');
}

// Best effort: some S3 dialects refuse these calls. The anonymous probes below are the proof.
await s3
  .send(new DeleteBucketPolicyCommand({ Bucket: bucket }))
  .then(() => console.log('✓ no bucket policy'))
  .catch((e) => console.log(`! bucket policy not cleared (${e.name}); the probes decide`));
await s3
  .send(new PutBucketAclCommand({ Bucket: bucket, ACL: 'private' }))
  .then(() => console.log('✓ bucket ACL private'))
  .catch((e) => console.log(`! ACL not set (${e.name}); the probes decide`));

const key = `visits/.probe-${Date.now()}.txt`;
const body = `visit-bucket probe ${new Date().toISOString()}`;
let failed = 0;
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }));
try {
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if ((await got.Body.transformToString()) === body) {
    console.log('✓ the key writes and reads back');
  } else {
    failed++;
    console.error('!! read-back mismatch');
  }
  // Only an explicit refusal proves private: a 404 (wrong path), a 5xx or a network error proves nothing.
  for (const [what, url] of [
    ['object GET', `${endpoint}/${bucket}/${key}`],
    ['LIST', `${endpoint}/${bucket}?list-type=2&max-keys=1`],
  ]) {
    const status = await fetch(url).then(
      (r) => r.status,
      (e) => `network error (${e.cause?.code ?? e.name})`,
    );
    if (status === 401 || status === 403) {
      console.log(`✓ anonymous ${what} refused (${status})`);
    } else {
      failed++;
      console.error(`!! anonymous ${what} answered ${status}: not proven private`);
    }
  }
} finally {
  await s3
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    .catch((e) => console.error(`! probe ${key} not deleted (${e.name})`));
}

if (failed) process.exit(1);
console.log(
  `visit bucket ${bucket} is private and writable. Next: ENV_SET_BLOCK ` +
    `VISIT_STORAGE_S3_BUCKET=${bucket}, then Deploy env-set for depot.`,
);
