import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { PromoConfigService } from '../../config/promo-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/** Production storage: S3-compatible object storage, the same adapter the other
 *  services bind. The bucket must serve `promotions/*` publicly — the customer Home
 *  page renders the banner straight off the stored URL. */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private static readonly TIMEOUT_MS = 10_000;
  private readonly client: S3Client;

  constructor(private readonly config: PromoConfigService) {
    const s3 = config.s3;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ body, contentType, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `promotions/${randomUUID()}.${ext}`;
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
