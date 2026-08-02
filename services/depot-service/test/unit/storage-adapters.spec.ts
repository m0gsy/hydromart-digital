const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { DepotConfigService } from '../../src/config/depot-config.service';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';

describe('LocalDiskStorageAdapter (QRIS)', () => {
  const root = join(tmpdir(), `hydromart-depot-storage-${process.pid}`);
  const config = {
    storageLocalDir: root,
    storagePublicBaseUrl: 'http://localhost:3007',
  } as unknown as DepotConfigService;

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes the blob under qris/ and returns a matching public url and key', async () => {
    const body = Buffer.from('qris-bytes');
    const result = await new LocalDiskStorageAdapter(config).put({
      body,
      contentType: 'image/png',
      ext: 'png',
    });

    expect(result.key).toMatch(/^qris\/[0-9a-f-]+\.png$/);
    expect(result.url).toBe(`http://localhost:3007/uploads/${result.key}`);
    expect(await readFile(join(root, result.key))).toEqual(body);
  });
});

describe('S3StorageAdapter (QRIS)', () => {
  const config = {
    storagePublicBaseUrl: 'https://nos.jkt-1.neo.id/hydromart-depots',
    s3: {
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart-depots',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as DepotConfigService;

  beforeEach(() => send.mockClear());

  it('puts under qris/<uuid>.<ext> and returns the ABSOLUTE public url', async () => {
    const body = Buffer.from('bytes');
    const { url, key } = await new S3StorageAdapter(config).put({
      body,
      contentType: 'image/webp',
      ext: 'webp',
    });

    expect(key).toMatch(/^qris\/[0-9a-f-]{36}\.webp$/);
    // Absolute on purpose: the customer's payment screen has no base URL to prepend.
    expect(url).toBe(`https://nos.jkt-1.neo.id/hydromart-depots/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'hydromart-depots',
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    });
  });
});
