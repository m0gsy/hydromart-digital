import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { AuthConfigService } from '../../config/auth-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/**
 * Production storage: S3-compatible object storage via @aws-sdk/client-s3. Same
 * StoragePort as the local-disk dev adapter — the app never knows which is bound.
 * Primary target is BiznetGio NEO (Ceph RGW, endpoint https://nos.jkt-1.neo.id);
 * Cloudflare R2 and MinIO work through the same code. Path-style addressing keeps
 * it working against any of them without per-bucket DNS. The returned URL is the
 * object's public URL (`${STORAGE_PUBLIC_BASE_URL}/<key>`), so the bucket (or its
 * bound public domain) must serve `avatars/*` publicly.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
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
    );
    return { url: `${this.config.storagePublicBaseUrl}/${key}`, key };
  }
}
