const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { ProductConfigService } from '../../src/config/product-config.service';

function makeConfig() {
  return {
    storagePublicBaseUrl: 'https://pub-abc.r2.dev',
    s3: {
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'products',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as ProductConfigService;
}

describe('S3StorageAdapter (product images)', () => {
  beforeEach(() => send.mockClear());

  it('puts under products/<uuid>.<ext> and returns the public url', async () => {
    const adapter = new S3StorageAdapter(makeConfig());
    const body = Buffer.from('bytes');

    const { url, key } = await adapter.put({ body, contentType: 'image/webp', ext: 'webp' });

    expect(key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(url).toBe(`https://pub-abc.r2.dev/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'products',
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    });
  });
});
