import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import { AuthConfigService } from '../../config/auth-config.service';
import {
  StoragePort,
  StoragePutInput,
  StoragePutResult,
} from '../../application/ports/storage.port';

/**
 * Production storage: S3-compatible object storage via @aws-sdk/client-s3. Same
 * StoragePort as the local-disk dev adapter — the app never knows which is bound.
 * Primary target is BiznetGio NEO (Ceph RGW, endpoint https://nos.jkt-1.neo.id);
 * Cloudflare R2 and MinIO work through the same code. Path-style addressing keeps
 * it working against any of them without per-bucket DNS.
 *
 * AUTH-1: the bucket must NOT serve `avatars/*` publicly. `put` returns the stored
 * identifier; reading goes through `signedUrl`.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  /**
   * M1-10: a wrong or unreachable endpoint used to hang the request for the SDK's
   * default retry window before failing. Bound it so the caller gets its 503 quickly
   * instead of the browser timing out with nothing to show.
   */
  private static readonly TIMEOUT_MS = 10_000;

  private readonly client: S3Client;

  constructor(private readonly config: AuthConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `avatars/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
      { abortSignal: AbortSignal.timeout(S3StorageAdapter.TIMEOUT_MS) },
    );
    return { url: `${this.config.storagePublicBaseUrl}/${key}`, key };
  }

  /** Pure local signing: the SDK builds the URL without calling the endpoint. */
  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /** S3 DELETE is already idempotent — deleting a missing key returns 204. */
  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(S3StorageAdapter.TIMEOUT_MS),
    });
  }
}
