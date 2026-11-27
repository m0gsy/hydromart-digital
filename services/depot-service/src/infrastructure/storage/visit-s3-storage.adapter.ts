import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import { VisitS3Settings } from '../../config/depot-config.service';
import {
  VisitPhotoPutInput,
  VisitPhotoStoragePort,
} from '../../application/ports/visit-photo-storage.port';

/**
 * Finding photos in their own PRIVATE bucket (hydromart-visits, made by Deploy mode `visit-bucket`),
 * under the `visits/` prefix, with the delivery account's key unless a dedicated one is set (compose
 * fallback; owner, 27 Nov 2026). Nothing is readable without a signed link minted per read; the
 * QRIS adapter next door is for a PUBLIC bucket and is deliberately not reused.
 */
@Injectable()
export class VisitS3StorageAdapter implements VisitPhotoStoragePort {
  /** Bounded so an unreachable endpoint fails fast instead of hanging the request. */
  private static readonly TIMEOUT_MS = 10_000;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(s3: VisitS3Settings) {
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async put({ visitId, body, contentType, ext }: VisitPhotoPutInput): Promise<{ key: string }> {
    const key = `visits/${visitId}/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      { abortSignal: AbortSignal.timeout(VisitS3StorageAdapter.TIMEOUT_MS) },
    );
    return { key };
  }

  /** Pure local signing: the SDK never talks to the endpoint to build the link. */
  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  /** A HEAD: 404 means "not there", anything else (a timeout, a 403) is a real failure and is thrown. */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(VisitS3StorageAdapter.TIMEOUT_MS),
      });
      return true;
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  /** S3 DELETE is idempotent: a missing key is a success. */
  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(VisitS3StorageAdapter.TIMEOUT_MS),
    });
  }
}
