const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { PaymentConfigService } from '../../src/config/payment-config.service';

function makeConfig() {
  return {
    storagePublicBaseUrl: 'https://nos.jkt-1.neo.id/hydromart',
    s3: {
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as PaymentConfigService;
}

describe('S3StorageAdapter', () => {
  beforeEach(() => send.mockClear());

  /*
   * The `payment-proof/` prefix is what lets this share one bucket with avatars, reseller
   * photos and PoD images without a collision — and it is why this release needs no new
   * secret to deploy. A change to it is a change to where every existing receipt is NOT.
   */
  it('puts under payment-proof/<uuid>.<ext> and returns the public url', async () => {
    const adapter = new S3StorageAdapter(makeConfig());
    const body = Buffer.from('bytes');

    const { url, key } = await adapter.put({ body, contentType: 'image/png', ext: 'png' });

    expect(key).toMatch(/^payment-proof\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`https://nos.jkt-1.neo.id/hydromart/${key}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'hydromart',
      Key: key,
      Body: body,
      ContentType: 'image/png',
    });
  });

  /*
   * CA-3-03. Deleting an account used to blank the column and stop there, leaving the
   * receipt in the bucket for anyone who still had its link. S3 DELETE is idempotent — a
   * missing key answers 204 — so erasure can be retried without a special case.
   */
  it('deletes the object by key', async () => {
    const adapter = new S3StorageAdapter(makeConfig());

    await adapter.remove('payment-proof/abc.png');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'hydromart',
      Key: 'payment-proof/abc.png',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
