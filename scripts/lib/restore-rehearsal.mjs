/*
 * Rehearse the object restore without touching a live object.
 *
 * `backup-objects.mjs --restore` exists, and had never been run against production volume: a copy
 * you have never moved back is a hope, not a backup. But the real restore writes into the LIVE
 * buckets, and its whole safety rule is "only keys that are missing" — so rehearsing it for real
 * means having something missing, which is precisely what nobody wants to arrange on purpose.
 *
 * So this does the same journey to a SCRATCH prefix inside each live bucket, for a few objects:
 *
 *   backup copy --read--> memory --PutObject--> live bucket, `_restore-rehearsal/<run>/<key>`
 *                                --read back--> compared, byte for byte, with what was written
 *                                --compared--> with the live original, when it still exists
 *   then the scratch object is deleted (by version id, so a versioned bucket keeps no trace).
 *
 * It exercises exactly what a real restore depends on and a listing cannot prove: that the backup
 * is readable with the backup key, that the live bucket accepts the write (this endpoint refused
 * aws-chunked bodies once, and the failure hid in the restore path), that the bytes survive the
 * trip, and that cleanup works. It never writes to, overwrites or deletes an original key.
 */
import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isMissing = (e) =>
  e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;

export const SCRATCH_PREFIX = '_restore-rehearsal/';

async function listAll(client, Bucket, Prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of page.Contents || []) out.push({ Key: o.Key, Size: o.Size });
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

/**
 * @returns {Promise<{checked:number, roundTripOk:number, sameAsLive:number, noLiveOriginal:number,
 *   differsFromLive:string[], failed:string[], cleaned:number, leftBehind:string[]}>}
 */
export async function rehearseRestore({
  live,
  backup,
  liveBucket,
  backupBucket,
  prefix,
  runId,
  limit = 5,
}) {
  const scratch = `${SCRATCH_PREFIX}${runId}/`;
  const report = {
    checked: 0,
    roundTripOk: 0,
    sameAsLive: 0,
    noLiveOriginal: 0,
    differsFromLive: [],
    failed: [],
    cleaned: 0,
    leftBehind: [],
  };

  const objects = (await listAll(backup, backupBucket, prefix)).slice(0, limit);
  for (const o of objects) {
    const key = o.Key.slice(prefix.length);
    const scratchKey = scratch + key;
    let wrote = false;
    let versionId;
    try {
      const got = await backup.send(new GetObjectCommand({ Bucket: backupBucket, Key: o.Key }));
      const bytes = await got.Body.transformToByteArray();
      const wanted = sha256(bytes);

      // Buffered, not streamed: the same reason the backup and restore directions buffer.
      const put = await live.send(
        new PutObjectCommand({
          Bucket: liveBucket,
          Key: scratchKey,
          Body: bytes,
          ContentType: got.ContentType,
        }),
      );
      wrote = true;
      versionId = put?.VersionId;
      report.checked += 1;

      const back = await live.send(new GetObjectCommand({ Bucket: liveBucket, Key: scratchKey }));
      if (sha256(await back.Body.transformToByteArray()) === wanted) report.roundTripOk += 1;
      else report.failed.push(`${key}: what was read back is not what was written`);

      try {
        const original = await live.send(new GetObjectCommand({ Bucket: liveBucket, Key: key }));
        if (sha256(await original.Body.transformToByteArray()) === wanted) report.sameAsLive += 1;
        else report.differsFromLive.push(key);
      } catch (e) {
        if (isMissing(e)) report.noLiveOriginal += 1;
        else throw e;
      }
    } catch (e) {
      report.failed.push(`${key}: ${e?.name || e?.message || 'unknown error'}`);
    } finally {
      if (wrote) {
        try {
          await live.send(
            new DeleteObjectCommand({
              Bucket: liveBucket,
              Key: scratchKey,
              ...(versionId ? { VersionId: versionId } : {}),
            }),
          );
          report.cleaned += 1;
        } catch {
          report.leftBehind.push(scratchKey);
        }
      }
    }
  }
  return report;
}
