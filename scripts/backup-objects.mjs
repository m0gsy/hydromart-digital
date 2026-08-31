#!/usr/bin/env node
/*
 * Copy the object buckets offsite. Nothing did this before — not cron, not deploy, not a gate.
 *
 * `backup-db.sh` + `backup-offsite.sh` carry the DATABASES offsite every night and read them
 * back. But seven services write FILES, and not one byte of those buckets was copied anywhere:
 *
 *   pod/            proof-of-delivery photos and signatures  (the receipt for a delivery)
 *   payment-proof/  transfer slips                            (the receipt for money)
 *   avatars/        profile photos
 *   products/       catalogue images
 *   qris/           depot payment QR codes
 *   resellers/      reseller documents
 *   uploads/        everything else
 *
 * Restoring every database onto a fresh box gives you orders that reference photographs that
 * no longer exist. For `pod/` and `payment-proof/` that is not cosmetic: those two prefixes are
 * the evidence behind a delivery and behind a payment. A dispute six months from now is settled
 * by a file, and the file was on one bucket, on one provider, with no copy.
 *
 * THERE IS NOT ONE BUCKET, AND THERE IS NOT ONE KEY PAIR. `docker-compose.prod.yml` gives auth,
 * product, delivery and hr a bucket AND credentials of their own; customer and payment fall
 * back to auth's. Reading a single `S3_BUCKET` with a single key would have copied a quarter of
 * the evidence and printed a success line — so the set below is derived from the same variables
 * compose reads, with the same fallbacks, and the ones compose marks required (`:?`) are
 * required here too.
 *
 *   STORAGE_S3_ENDPOINT [/ STORAGE_S3_REGION]
 *   {AUTH,PRODUCT,DELIVERY}_STORAGE_S3_{BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY}   required
 *   {CUSTOMER,PAYMENT}_STORAGE_S3_*                            optional, default to AUTH's
 *   HR_STORAGE_S3_*                                            optional
 *   BACKUP_OFFSITE_DEST=s3://<backup bucket>[/prefix]
 *   BACKUP_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY [/ _ENDPOINT / _REGION]
 *
 *   node scripts/backup-objects.mjs [--dry-run] [--self-test]
 *   node scripts/backup-objects.mjs --restore [--dry-run]     # the other direction
 *
 * THE REFUSAL THAT MATTERS: this never deletes anything at the destination. A "sync" that
 * mirrors deletions faithfully reproduces the accident you are backing up against — somebody
 * deletes a prefix, the next run deletes the copy, and the backup is a second casualty rather
 * than the recovery. Objects that vanish upstream stay here. The bucket therefore grows
 * monotonically; that is the intended trade, and the destination has a lifecycle rule.
 *
 * Incremental by (key, size). Two objects with the same key and the same byte count are taken
 * to be the same object — these are write-once uploads under a uuid-shaped key, not files that
 * get edited in place. That is a deliberate ceiling: it will not notice a same-length rewrite.
 * A checksum per object would cost a HEAD round trip each, every night, forever.
 */
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
} from '@aws-sdk/client-s3';

/*
 * Pure, so it can be tested without a bucket. Returns the objects that still have to move.
 * `dest` maps key -> size for what is ALREADY at the destination.
 */
export function plan(found, dest) {
  return found.filter((o) => {
    const have = dest.get(o.Key);
    return have === undefined || have !== o.Size;
  });
}

/*
 * Which buckets exist and which key opens each, from the same variables compose reads. Pure,
 * because getting this wrong is silent: it does not fail, it backs up less than you think and
 * says nothing.
 */
export function sources(env) {
  const at = (p) => ({
    bucket: env[`${p}_STORAGE_S3_BUCKET`],
    accessKeyId: env[`${p}_STORAGE_S3_ACCESS_KEY_ID`],
    secretAccessKey: env[`${p}_STORAGE_S3_SECRET_ACCESS_KEY`],
  });
  const complete = (s) => Boolean(s.bucket && s.accessKeyId && s.secretAccessKey);
  const or = (a, b) => ({
    bucket: a.bucket || b.bucket,
    accessKeyId: a.accessKeyId || b.accessKeyId,
    secretAccessKey: a.secretAccessKey || b.secretAccessKey,
  });

  const auth = at('AUTH');
  const required = { AUTH: auth, PRODUCT: at('PRODUCT'), DELIVERY: at('DELIVERY') };
  const missing = Object.entries(required)
    .filter(([, s]) => !complete(s))
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `incomplete ${missing.join(', ')} storage settings — compose marks these required, so a ` +
        'missing one means a bucket full of evidence would go unbacked in silence',
    );
  }

  const hr = at('HR');
  if (hr.bucket && !complete(hr)) {
    // Compose lets HR's key be empty. A bucket named with no key to read it cannot be copied,
    // and skipping it quietly is the exact failure this function exists to prevent.
    throw new Error(
      'HR_STORAGE_S3_BUCKET is set but its key pair is not — that bucket cannot be copied, and ' +
        'leaving it out without saying so is how evidence goes missing',
    );
  }

  const all = [
    auth,
    or(at('CUSTOMER'), auth),
    required.PRODUCT,
    or(at('PAYMENT'), auth),
    required.DELIVERY,
    ...(complete(hr) ? [hr] : []),
  ];
  // Customer and payment usually resolve to auth's bucket. Copying it three times would be
  // harmless and slow; deduping keeps the log honest about how many buckets there are.
  const seen = new Set();
  return all.filter((s) => !seen.has(s.bucket) && seen.add(s.bucket));
}

if (process.argv.includes('--self-test')) {
  const { strict: assert } = await import('node:assert');
  const objs = [
    { Key: 'pod/a.jpg', Size: 100 },
    { Key: 'pod/b.jpg', Size: 200 },
    { Key: 'payment-proof/c.png', Size: 300 },
  ];
  assert.deepEqual(
    plan(objs, new Map()).map((o) => o.Key),
    ['pod/a.jpg', 'pod/b.jpg', 'payment-proof/c.png'],
  );
  // A second run over an unchanged bucket must move nothing, or the nightly job re-uploads the
  // whole bucket every night and the bill grows while the safety does not.
  assert.deepEqual(plan(objs, new Map(objs.map((o) => [o.Key, o.Size]))), []);
  // Same key, different byte count = something was replaced upstream. Copy it again; the
  // destination is versioned, so the old bytes survive underneath.
  assert.deepEqual(
    plan(objs, new Map([['pod/a.jpg', 99]]))
      .map((o) => o.Key)
      .sort(),
    ['payment-proof/c.png', 'pod/a.jpg', 'pod/b.jpg'],
  );
  // An object that exists ONLY at the destination is absent from the plan, and no other code
  // path can remove it. This is the refusal, asserted.
  assert.deepEqual(plan([], new Map([['pod/gone.jpg', 1]])), []);

  // The bug review caught: one `S3_BUCKET` and one key would have copied a quarter of the
  // evidence and reported success.
  const env = (o) => {
    const e = {};
    for (const [p, b] of Object.entries(o)) {
      e[`${p}_STORAGE_S3_BUCKET`] = b;
      e[`${p}_STORAGE_S3_ACCESS_KEY_ID`] = `${b}-key`;
      e[`${p}_STORAGE_S3_SECRET_ACCESS_KEY`] = `${b}-secret`;
    }
    return e;
  };
  const four = env({ AUTH: 'a', PRODUCT: 'p', DELIVERY: 'd', HR: 'h' });
  assert.deepEqual(
    sources(four).map((s) => s.bucket),
    ['a', 'p', 'd', 'h'],
  );
  assert.equal(sources(four)[1].accessKeyId, 'p-key', 'each bucket must use its OWN key');
  // customer and payment share auth's bucket in compose: it appears once, not three times.
  assert.deepEqual(
    sources(env({ AUTH: 'a', PRODUCT: 'p', DELIVERY: 'd' })).map((s) => s.bucket),
    ['a', 'p', 'd'],
  );
  // A customer bucket of its own, opened by auth's key — the exact shape compose's `:-` writes.
  const cust = {
    ...env({ AUTH: 'a', PRODUCT: 'p', DELIVERY: 'd' }),
    CUSTOMER_STORAGE_S3_BUCKET: 'c',
  };
  assert.deepEqual(
    sources(cust).map((s) => s.bucket),
    ['a', 'c', 'p', 'd'],
  );
  assert.equal(sources(cust)[1].accessKeyId, 'a-key');
  // A required bucket missing must THROW. Quietly returning the other two is the failure mode.
  assert.throws(() => sources(env({ AUTH: 'a', PRODUCT: 'p' })), /DELIVERY/);
  // A key present but its secret missing is just as unbacked as no bucket at all.
  assert.throws(() => sources({ ...four, DELIVERY_STORAGE_S3_SECRET_ACCESS_KEY: '' }), /DELIVERY/);
  // Named but unopenable is louder than skipped.
  assert.throws(
    () =>
      sources({ ...env({ AUTH: 'a', PRODUCT: 'p', DELIVERY: 'd' }), HR_STORAGE_S3_BUCKET: 'h' }),
    /HR_STORAGE_S3_BUCKET is set but its key pair is not/,
  );
  console.log('self-test ok');
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
const restore = process.argv.includes('--restore');
const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`!! missing env ${k} — refusing to report a backup that did not happen`);
    process.exit(2);
  }
  return v;
};

const DEST = need('BACKUP_OFFSITE_DEST');
if (!DEST.startsWith('s3://')) {
  console.error(`!! BACKUP_OFFSITE_DEST=${DEST} is not an s3:// URL; object backup needs a bucket`);
  process.exit(2);
}
const [destBucket, ...destRest] = DEST.slice('s3://'.length).split('/');
// The DB dumps live under `db/`. Objects get their own prefix, so a prune aimed at one can
// never walk into the other.
const destPrefix = `${[...destRest.filter(Boolean).slice(0, -1), 'objects'].join('/')}/`.replace(
  /^\/+/,
  '',
);

let SRC;
try {
  SRC = sources(process.env);
} catch (e) {
  console.error(`!! ${e.message}`);
  process.exit(2);
}

const ENDPOINT = need('STORAGE_S3_ENDPOINT');
const REGION = process.env.STORAGE_S3_REGION || 'jkt-1';
const clientFor = ({ accessKeyId, secretAccessKey }) =>
  new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

const dst = new S3Client({
  endpoint: process.env.BACKUP_S3_ENDPOINT || ENDPOINT,
  region: process.env.BACKUP_S3_REGION || REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: need('BACKUP_S3_ACCESS_KEY_ID'),
    secretAccessKey: need('BACKUP_S3_SECRET_ACCESS_KEY'),
  },
});

const listAll = async (client, Bucket, Prefix) => {
  const out = [];
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of page.Contents || []) out.push({ Key: o.Key, Size: o.Size });
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
};

/*
 * Versioning on the SOURCE, because most object loss is not the bucket dying — it is one bad
 * DELETE or one overwrite, hours before anybody notices. With versioning on, the nightly copy
 * becomes the second line of defence rather than the only one.
 */
const enableVersioning = async (client, bucket) => {
  try {
    const cur = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (cur.Status === 'Enabled') return 'already on';
    if (dryRun) return 'would enable (dry run)';
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    return 'enabled';
  } catch (e) {
    // Not fatal. The copy below is the point of this script; versioning is the bonus, and some
    // S3 implementations refuse the call outright.
    return `unavailable (${e.name || e.message})`;
  }
};

let totalDone = 0;
let totalTodo = 0;
const failures = [];

/*
 * The other direction, because a copy you have never moved back is a hope, not a backup — and
 * docs/DISASTER_RECOVERY.md has to be able to name a command for "get the photographs back".
 *
 * ONE RULE, AND IT IS THE OPPOSITE OF THE BACKUP'S: restore only writes keys that are MISSING.
 * A restore is run in a panic, usually onto a bucket that is partly alive; overwriting whatever
 * is already there with an older copy would turn a partial loss into a total one.
 */
if (restore) {
  for (const s of SRC) {
    const live = clientFor(s);
    const prefix = `${destPrefix}${s.bucket}/`;
    const have = new Set((await listAll(live, s.bucket)).map((o) => o.Key));
    const backed = await listAll(dst, destBucket, prefix);
    const todo = backed.filter((o) => !have.has(o.Key.slice(prefix.length)));
    totalTodo += todo.length;
    console.log(
      `[restore] ${s.bucket}: ${backed.length} in backup, ${have.size} already live, ` +
        `${todo.length} to put back`,
    );
    if (dryRun) {
      for (const o of todo.slice(0, 10))
        console.log(`  would restore ${o.Key.slice(prefix.length)}`);
      continue;
    }
    const queue = [...todo];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let o = queue.shift(); o; o = queue.shift()) {
          try {
            const got = await dst.send(new GetObjectCommand({ Bucket: destBucket, Key: o.Key }));
            await live.send(
              new PutObjectCommand({
                Bucket: s.bucket,
                Key: o.Key.slice(prefix.length),
                Body: got.Body,
                ContentLength: o.Size,
                ContentType: got.ContentType,
              }),
            );
            totalDone += 1;
          } catch (e) {
            failures.push(`${s.bucket}/${o.Key}: ${e.name || e.message}`);
          }
        }
      }),
    );
  }
  console.log(`[restore] put back ${totalDone}/${totalTodo} across ${SRC.length} bucket(s)`);
  if (failures.length) {
    console.error(`!! ${failures.length} object(s) failed to restore:`);
    for (const f of failures.slice(0, 10)) console.error(`   ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

for (const s of SRC) {
  const src = clientFor(s);
  console.log(`[objects] ${s.bucket}: versioning ${await enableVersioning(src, s.bucket)}`);

  // One prefix per bucket. Two buckets can hold the same key and they are different files;
  // flattening them would let one silently overwrite the other in the backup.
  const prefix = `${destPrefix}${s.bucket}/`;
  const found = await listAll(src, s.bucket);
  const dest = new Map(
    (await listAll(dst, destBucket, prefix)).map((o) => [o.Key.slice(prefix.length), o.Size]),
  );
  const todo = plan(found, dest);
  totalTodo += todo.length;

  const bytes = todo.reduce((n, o) => n + (o.Size || 0), 0);
  console.log(
    `[objects] ${s.bucket}: ${found.length} object(s), ${dest.size} already at ` +
      `${destBucket}/${prefix}, ${todo.length} to copy (${(bytes / 1e6).toFixed(1)} MB)`,
  );

  if (dryRun) {
    for (const o of todo.slice(0, 10))
      console.log(`  would copy ${s.bucket}/${o.Key} (${o.Size}B)`);
    if (todo.length > 10) console.log(`  ...and ${todo.length - 10} more`);
    continue;
  }

  const copyOne = async (o) => {
    const got = await src.send(new GetObjectCommand({ Bucket: s.bucket, Key: o.Key }));
    await dst.send(
      new PutObjectCommand({
        Bucket: destBucket,
        Key: prefix + o.Key,
        Body: got.Body,
        // The stream carries no length of its own, and the SDK will not guess one.
        ContentLength: o.Size,
        ContentType: got.ContentType,
      }),
    );
    totalDone += 1;
  };

  // ponytail: four at a time. Sequential made a first run of a few thousand photos take half an
  // hour; four hides the round trips without pretending the box has bandwidth it does not.
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let o = queue.shift(); o; o = queue.shift()) {
        try {
          await copyOne(o);
        } catch (e) {
          // One unreadable object must not abandon the other nine thousand.
          failures.push(`${s.bucket}/${o.Key}: ${e.name || e.message}`);
        }
      }
    }),
  );
}

if (dryRun) process.exit(0);

console.log(`[objects] copied ${totalDone}/${totalTodo} across ${SRC.length} bucket(s)`);
if (failures.length) {
  console.error(`!! ${failures.length} object(s) failed to copy:`);
  for (const f of failures.slice(0, 10)) console.error(`   ${f}`);
  process.exit(1);
}
