// Upload one file to an S3-compatible bucket (BiznetGio NEO). Reuses the
// @aws-sdk/client-s3 already in the repo — run with the host's node_modules
// present (the same `npm ci` that migrations use).
//
//   S3_ENDPOINT=https://nos.jkt-1.neo.id S3_REGION=jkt-1 \
//   S3_BUCKET=hydromart-backups S3_ACCESS_KEY_ID=xxx S3_SECRET_ACCESS_KEY=xxx \
//   node scripts/upload-to-s3.mjs <local-file> <object-key>
//
// ponytail: readFileSync loads the whole file into memory — fine for gzipped
// pg_dumpall of these small DBs (tens of MB). If backups ever grow past a few
// hundred MB, switch Body to a fs.createReadStream + @aws-sdk/lib-storage Upload
// (multipart). Named the ceiling so the upgrade path is obvious.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error('usage: node scripts/upload-to-s3.mjs <local-file> <object-key>');
  process.exit(2);
}

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`missing env ${k}`);
    process.exit(2);
  }
  return v;
};

const client = new S3Client({
  endpoint: need('S3_ENDPOINT'),
  region: process.env.S3_REGION || 'jkt-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
  },
});

await client.send(
  new PutObjectCommand({
    Bucket: need('S3_BUCKET'),
    Key: key,
    Body: readFileSync(file),
    ContentType: 'application/gzip',
  }),
);
console.log(`uploaded ${basename(file)} -> ${process.env.S3_BUCKET}/${key}`);
