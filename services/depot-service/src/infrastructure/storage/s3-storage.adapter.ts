import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  StoragePort,
  StoragePutInput,
  StoragePutResult,
} from '../../application/ports/storage.port';

/**
 * Production storage: S3-compatible object storage via @aws-sdk/client-s3. Same
 * StoragePort as the local-disk dev adapter — the app never knows which is bound.
 * Primary target is BiznetGio NEO (Ceph RGW); path-style addressing keeps it working
 * against MinIO/R2 too. The returned URL is the object's public URL
 * (`${STORAGE_PUBLIC_BASE_URL}/<key>`), so the bucket must serve `qris/*` publicly —
 * a customer paying an order loads this image with no credentials at all.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  /** Bounded so an unreachable endpoint fails fast instead of hanging the request. */
  private static readonly TIMEOUT_MS = 10_000;

  private readonly client: S3Client;

  constructor(private readonly config: DepotConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `qris/${randomUUID()}.${ext}`;
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
}
