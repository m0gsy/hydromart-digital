const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';

function makeConfig() {
  return {
    storagePublicBaseUrl: 'https://pub-abc.r2.dev',
    s3: {
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'pods',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as DeliveryConfigService;
}

describe('S3StorageAdapter', () => {
  beforeEach(() => send.mockClear());

  it('puts under pod/<uuid>.<ext> and returns the public url', async () => {
    const adapter = new S3StorageAdapter(makeConfig());
    const body = Buffer.from('bytes');

    const { url, key } = await adapter.put({ body, contentType: 'image/jpeg', ext: 'jpg' });

    expect(key).toMatch(/^pod\/[0-9a-f-]{36}\.jpg$/);
    expect(url).toBe(`https://pub-abc.r2.dev/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'pods',
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
    });
  });
});
