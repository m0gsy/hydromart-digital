import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/**
 * Production storage: S3-compatible object storage via @aws-sdk/client-s3 (mirrors the
 * auth-service avatar adapter). Path-style addressing works against BiznetGio NEO / R2 /
 * MinIO. Returned url is `${STORAGE_PUBLIC_BASE_URL}/<key>`; the bucket must serve `hr/*`.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: HrConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext, keyPrefix }: StoragePutInput): Promise<StoragePutResult> {
    const key = `${keyPrefix}/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.s3.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { url: `${this.config.storagePublicBaseUrl}/${key}`, key };
  }
}
