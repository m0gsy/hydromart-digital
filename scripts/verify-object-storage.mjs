// Verify (and make public) an S3-compatible bucket for Hydromart uploads.
// Primary target: BiznetGio NEO (Ceph RGW). Also works for Cloudflare R2 / MinIO.
//
// Usage (fill your real access key + secret — do NOT commit them):
//   STORAGE_S3_ENDPOINT=https://nos.jkt-1.neo.id \
//   STORAGE_S3_REGION=jkt-1 \
//   STORAGE_S3_BUCKET=hydromart-pod \
//   STORAGE_S3_ACCESS_KEY_ID=xxxx \
//   STORAGE_S3_SECRET_ACCESS_KEY=xxxx \
//   STORAGE_PUBLIC_BASE_URL=https://nos.jkt-1.neo.id/hydromart-pod \
//   node scripts/verify-object-storage.mjs
//
// STORAGE_PROBE_PREFIX (default `probe`) picks the prefix to prove, e.g. `resellers` for
// the agen registration photos customer-service writes.
//
// It: sets a public-read bucket policy, forces the bucket ACL back to `private`, sets a
// UU PDP lifecycle rule (expire pod/* after POD_RETENTION_DAYS, default 365), PutObjects a
// probe file, GETs the returned public URL and checks the bytes round-trip, and finally
// PROVES that an anonymous client cannot LIST the bucket. Exit 0 = storage is ready.
//
// Why the ACL and the listing proof: measured 2026-08-17 against production, unauthenticated,
//
//   GET https://nos.jkt-1.neo.id/hydromart-pod?list-type=2      -> 200   (every PoD photo)
//   GET https://nos.jkt-1.neo.id/hydromart-products?list-type=2 -> 200   (every avatar)
//   GET https://nos.jkt-1.neo.id/hydromart-facer?list-type=2    -> 403   (correct)
//
// The policy below was never the problem — it grants `s3:GetObject` and nothing else. What
// enables listing on Ceph RGW is a bucket ACL granting READ to AllUsers, which a canned
// `public-read` sets and which no policy edit removes. Serving an object to whoever holds
// its URL is the intent; handing over the index of every proof-of-delivery photo is not.

import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  PutBucketAclCommand,
  PutBucketPolicyCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const env = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`missing env ${k}`);
    process.exit(2);
  }
  return v;
};

const endpoint = env('STORAGE_S3_ENDPOINT');
const region = process.env.STORAGE_S3_REGION || 'us-east-1';
const bucket = env('STORAGE_S3_BUCKET');
const publicBase = env('STORAGE_PUBLIC_BASE_URL').replace(/\/+$/, '');
// UU PDP retention: expire pod/* files on the same window the DB purge uses.
const retentionDays = Number(process.env.POD_RETENTION_DAYS || 365);

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env('STORAGE_S3_ACCESS_KEY_ID'),
    secretAccessKey: env('STORAGE_S3_SECRET_ACCESS_KEY'),
  },
});

const publicReadPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${bucket}/*`],
    },
  ],
};

async function main() {
  // 1) Make the bucket serve objects publicly (R2: skip — set public via dashboard).
  try {
    await client.send(
      new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(publicReadPolicy) }),
    );
    console.log('✓ public-read bucket policy set');
  } catch (e) {
    console.warn(`! could not set bucket policy (${e.name}); set public access in the console instead`);
  }

  // 1b) …and take the LISTING back. The policy above grants `s3:GetObject` only; a bucket
  // ACL granting READ to AllUsers is a separate grant that no policy edit touches, and it
  // is what makes the whole index anonymously readable.
  try {
    await client.send(new PutBucketAclCommand({ Bucket: bucket, ACL: 'private' }));
    console.log('✓ bucket ACL forced to private (objects stay readable via the policy)');
  } catch (e) {
    console.warn(`! could not set bucket ACL (${e.name}); set it to private in the console`);
  }

  // 1b) UU PDP retention: bucket lifecycle rule expiring pod/* after the window.
  //     Only applies to the pod bucket (prefix-filtered, so harmless elsewhere).
  try {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-pod-uu-pdp',
              Status: 'Enabled',
              Filter: { Prefix: 'pod/' },
              Expiration: { Days: retentionDays },
            },
          ],
        },
      }),
    );
    console.log(`✓ lifecycle rule set: expire pod/* after ${retentionDays}d`);
  } catch (e) {
    console.warn(`! could not set lifecycle rule (${e.name}); set pod/* expiry ${retentionDays}d in the console`);
  }

  // 2) Upload a probe object (mirrors the adapter's key shape / content-type).
  //
  // The prefix is settable because "the bucket is public" and "the prefix my adapter
  // writes to is public" are not the same claim once a bucket is shared: agen photos go
  // under resellers/, avatars under avatars/, proofs under pod/. Probing the prefix the
  // adapter will actually use is what makes this a check rather than an assumption.
  const prefix = (process.env.STORAGE_PROBE_PREFIX || 'probe').replace(/^\/+|\/+$/g, '');
  const key = `${prefix}/${randomUUID()}.txt`;
  const body = Buffer.from(`hydromart-storage-probe ${key}`);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
  );
  console.log(`✓ PutObject ${bucket}/${key}`);

  // 3) Fetch it through the public URL exactly as clients will.
  const url = `${publicBase}/${key}`;
  const res = await fetch(url);
  const got = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) {
    console.error(`✗ public GET ${url} -> ${res.status} (bucket not public, or STORAGE_PUBLIC_BASE_URL wrong)`);
    process.exit(1);
  }
  if (!got.equals(body)) {
    console.error(`✗ public GET ${url} -> 200 but bytes differ`);
    process.exit(1);
  }
  console.log(`✓ public GET ${url} -> 200, bytes match`);
  /*
   * 4) The half that "public bucket" quietly costs you: anyone holding an object's URL may
   *    read THAT OBJECT — nobody may read the INDEX. Proved, not assumed, and exactly as a
   *    stranger would: no credentials on this request at all.
   *
   *    Exits 1. A bucket that hands out the list of every proof-of-delivery photo is not a
   *    warning to scroll past; it is the finding, and a green run must not be able to
   *    contain it.
   */
  const listRes = await fetch(`${publicBase}?list-type=2&max-keys=1`);
  if (listRes.status === 200) {
    console.error(
      `✗ anonymous LIST ${publicBase} -> 200 — the bucket index is public.\n` +
        '  The GetObject policy is not the cause; a bucket ACL granting READ to AllUsers is.\n' +
        '  This run tried to set that ACL back to private and the bucket still lists, so set\n' +
        '  it to private in the provider console and re-run.',
    );
    process.exit(1);
  }
  console.log(`✓ anonymous LIST ${publicBase} -> ${listRes.status}, the index stays private`);
  console.log('\nStorage READY. Set STORAGE_DRIVER=s3 with these values in the service env.');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
