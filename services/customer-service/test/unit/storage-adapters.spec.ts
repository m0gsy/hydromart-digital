const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { CustomerConfigService } from '../../src/config/customer-config.service';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';

describe('LocalDiskStorageAdapter (agen photo)', () => {
  const root = join(tmpdir(), `hydromart-customer-storage-${process.pid}`);
  const config = {
    storageLocalDir: root,
    storagePublicBaseUrl: 'http://localhost:3003',
  } as unknown as CustomerConfigService;

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes the blob under resellers/ and returns a matching public url and key', async () => {
    const body = Buffer.from('photo-bytes');
    const result = await new LocalDiskStorageAdapter(config).put({
      body,
      contentType: 'image/png',
      ext: 'png',
    });

    expect(result.key).toMatch(/^resellers\/[0-9a-f-]+\.png$/);
    expect(result.url).toBe(`http://localhost:3003/uploads/${result.key}`);
    expect(await readFile(join(root, result.key))).toEqual(body);
  });
});

describe('S3StorageAdapter (agen photo)', () => {
  const config = {
    storagePublicBaseUrl: 'https://nos.jkt-1.neo.id/hydromart-customers',
    s3: {
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart-customers',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as CustomerConfigService;

  beforeEach(() => send.mockClear());

  it('puts under resellers/<uuid>.<ext> and returns the ABSOLUTE public url', async () => {
    const body = Buffer.from('bytes');
    const { url, key } = await new S3StorageAdapter(config).put({
      body,
      contentType: 'image/webp',
      ext: 'webp',
    });

    expect(key).toMatch(/^resellers\/[0-9a-f-]{36}\.webp$/);
    // Absolute on purpose: the console renders it with no base URL of this service.
    expect(url).toBe(`https://nos.jkt-1.neo.id/hydromart-customers/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'hydromart-customers',
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    });
  });
});
