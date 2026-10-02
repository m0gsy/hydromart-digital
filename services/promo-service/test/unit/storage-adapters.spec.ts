const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { PromoConfigService } from '../../src/config/promo-config.service';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';

describe('LocalDiskStorageAdapter (promo banner)', () => {
  const root = join(tmpdir(), `hydromart-promo-storage-${process.pid}`);
  const config = {
    storageLocalDir: root,
    storagePublicBaseUrl: 'http://localhost:3010',
  } as unknown as PromoConfigService;

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes the blob under promotions/ and returns a matching public url and key', async () => {
    const body = Buffer.from('banner-bytes');
    const result = await new LocalDiskStorageAdapter(config).put({
      body,
      contentType: 'image/png',
      ext: 'png',
    });

    expect(result.key).toMatch(/^promotions\/[0-9a-f-]+\.png$/);
    expect(result.url).toBe(`http://localhost:3010/uploads/${result.key}`);
    expect(await readFile(join(root, result.key))).toEqual(body);
  });
});

describe('S3StorageAdapter (promo banner)', () => {
  const config = {
    storagePublicBaseUrl: 'https://nos.jkt-1.neo.id/hydromart-auth',
    s3: {
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart-auth',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as PromoConfigService;

  beforeEach(() => send.mockClear());

  it('puts under promotions/<uuid>.<ext> and returns the ABSOLUTE public url', async () => {
    const body = Buffer.from('bytes');
    const { url, key } = await new S3StorageAdapter(config).put({
      body,
      contentType: 'image/webp',
      ext: 'webp',
    });

    expect(key).toMatch(/^promotions\/[0-9a-f-]{36}\.webp$/);
    // Absolute on purpose: the customer Home page renders it with no base URL of this service.
    expect(url).toBe(`https://nos.jkt-1.neo.id/hydromart-auth/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'hydromart-auth',
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    });
  });
});
