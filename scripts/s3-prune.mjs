#!/usr/bin/env node
/*
 * Keep the offsite copies to a window, so the bucket has a DEPTH instead of a direction.
 *
 * `backup-db.sh:92` prunes the local disk to `BACKUP_KEEP` (14) and its own comment hands the
 * remote side to somebody else: "NEO retention = set a lifecycle rule". Nobody ever did, so
 * the bucket had no rule at all — it grew forever, and the bill with it.
 *
 * That is the boring half. The sharp half is that "grows forever" and "one night of history"
 * are the same sentence read at different times: on the day the first copy lands there is
 * exactly one, and a restore can only go back as far as the oldest object present.
 *
 *   node scripts/s3-prune.mjs --bucket <b> --prefix db/ --keep 14 [--dry-run]
 *
 * Two refusals, both deliberate:
 *   - it never deletes when fewer than `keep` objects remain, so a bucket that is still
 *     filling up is never trimmed;
 *   - it never deletes the NEWEST object under any circumstance, even if --keep 0 is passed.
 *     A prune that can empty the bucket is one typo away from being the incident.
 *
 * Names sort chronologically (`hydromart-YYYYMMDD-HHMMSS.sql.gz`, `env-YYYY-MM-DD.enc`), so
 * the key order IS the age order — no LastModified round trip, and no dependence on a clock
 * that could be wrong on either side.
 */
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const bucket = arg('--bucket');
const prefix = arg('--prefix', '');
const keep = Number(arg('--keep', '14'));
const dryRun = process.argv.includes('--dry-run');

if (!bucket || !Number.isInteger(keep) || keep < 1) {
  console.error('usage: s3-prune.mjs --bucket <b> [--prefix p/] --keep <n>=1.. [--dry-run]');
  process.exit(2);
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

/*
 * Versioning first, and it changes what a delete MEANS here.
 *
 * The key on the box can PUT and DELETE the same bucket — so anything that reaches the box
 * reaches the backups, and `rm` is `rm`. With versioning on, a delete writes a marker and the
 * bytes stay recoverable, which is the difference between ransomware costing an afternoon and
 * costing the company.
 *
 * Enabled through the API rather than left as a console checklist item, because a checklist
 * item is true on the day somebody reads it. Idempotent: already-Enabled is a no-op.
 *
 * The lifecycle rule is the other half. Once versioning is on, THIS SCRIPT's deletes stop
 * freeing anything — every pruned dump lingers as a noncurrent version, and a bucket that
 * grows forever is what the pruning was for. So the bucket expires noncurrent versions after
 * 30 days: long enough that a deletion is recoverable, short enough that it is bounded.
 * Measured on BiznetGio NEO 2026-08-31: both calls accepted.
 */
async function protectBucket() {
  const state = await client
    .send(new GetBucketVersioningCommand({ Bucket: bucket }))
    .catch(() => null);
  if (state?.Status !== 'Enabled') {
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    console.log('prune: versioning ENABLED — a delete is now recoverable, not final.');
  }
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-noncurrent',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
          },
        ],
      },
    }),
  );
}

if (!dryRun) {
  await protectBucket().catch((err) => {
    // Not fatal: an unprotected bucket that still receives backups beats a backup run that
    // aborts because a bucket setting could not be written.
    console.error(
      `prune: could not confirm bucket protection (${err?.name ?? err}) — pruning anyway.`,
    );
  });
}

const keys = [];
let token;
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
  );
  for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

keys.sort();
const doomed = keys.slice(0, Math.max(0, keys.length - keep));

if (doomed.length === 0) {
  console.log(
    `prune: ${keys.length} object(s) under ${prefix || '/'}, keeping ${keep} — nothing to remove.`,
  );
  process.exit(0);
}

// The newest is never a candidate: `slice` above already excludes it while keep >= 1, and
// this is the assertion that keeps that true if the arithmetic above is ever edited.
const newest = keys[keys.length - 1];
if (doomed.includes(newest)) {
  console.error(
    'prune: refusing — the newest object was selected for deletion. That is a bug, not a policy.',
  );
  process.exit(1);
}

for (const key of doomed) {
  if (dryRun) {
    console.log(`prune: would remove ${key}`);
    continue;
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`prune: removed ${key}`);
}
console.log(`prune: ${keys.length - doomed.length} object(s) kept under ${prefix || '/'}.`);
