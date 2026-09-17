import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  StoragePort,
  StoragePutInput,
  StoragePutResult,
} from '../../application/ports/storage.port';

/**
 * Production storage: S3-compatible object storage, the same adapter depot/auth-service
 * bind. Primary target is BiznetGio NEO (Ceph RGW); path-style addressing keeps it working
 * against MinIO/R2 too. The bucket must serve `resellers/*` publicly — the ops console
 * renders the photo straight off the stored URL.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  /** Bounded so an unreachable endpoint fails fast instead of hanging the request. */
  private static readonly TIMEOUT_MS = 10_000;

  private readonly client: S3Client;

  constructor(private readonly config: CustomerConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `resellers/${randomUUID()}.${ext}`;
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
