import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/**
 * Production storage: Cloudflare R2 (S3-compatible) via @aws-sdk/client-s3. Same
 * StoragePort as the local-disk dev adapter — the app never knows which is bound.
 * Path-style addressing keeps it working against any S3-compatible endpoint
 * (R2, BiznetGio NEO, MinIO) without per-bucket DNS. The returned URL is the
 * object's public URL (`${STORAGE_PUBLIC_BASE_URL}/<key>`), so the bucket (or its
 * bound public domain) must serve `pod/*` publicly.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: DeliveryConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `pod/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { url: `${this.config.storagePublicBaseUrl}/${key}`, key };
  }
}
