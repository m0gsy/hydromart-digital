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
// It: sets a public-read bucket policy, sets a UU PDP lifecycle rule (expire pod/*
// after POD_RETENTION_DAYS, default 365), PutObjects a probe file, then GETs the
// returned public URL and checks the bytes round-trip. Exit 0 = storage is ready.

import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
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
  const key = `probe/${randomUUID()}.txt`;
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
  console.log('\nStorage READY. Set STORAGE_DRIVER=s3 with these values in the service env.');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
