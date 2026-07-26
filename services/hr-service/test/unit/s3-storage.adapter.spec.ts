// @aws-sdk/client-s3 is not installed in dev/CI — virtual mock captures the client construction
// and the PutObjectCommand so we can assert bucket/key/body without touching the network.

const sendMock = jest.fn();
const clientCtorArgs: unknown[] = [];
const putCmdArgs: unknown[] = [];

jest.mock(
  '@aws-sdk/client-s3',
  () => ({
    S3Client: class {
      constructor(cfg: unknown) {
        clientCtorArgs.push(cfg);
      }
      send = sendMock;
    },
    PutObjectCommand: class {
      constructor(public input: unknown) {
        putCmdArgs.push(input);
      }
    },
  }),
  { virtual: true },
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { S3StorageAdapter } = require('../../src/infrastructure/storage/s3-storage.adapter');
import type { HrConfigService } from '../../src/config/hr-config.service';

function makeConfig(): HrConfigService {
  return {
    s3: {
      region: 'auto',
      endpoint: 'https://s3.example',
      bucket: 'hr-bucket',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    },
    storagePublicBaseUrl: 'https://cdn.example',
  } as unknown as HrConfigService;
}

beforeEach(() => {
  sendMock.mockReset();
  clientCtorArgs.length = 0;
  putCmdArgs.length = 0;
});

describe('S3StorageAdapter', () => {
  it('constructs the S3 client with path-style config + credentials', () => {
    new S3StorageAdapter(makeConfig());
    expect(clientCtorArgs).toHaveLength(1);
    expect(clientCtorArgs[0]).toMatchObject({
      region: 'auto',
      endpoint: 'https://s3.example',
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
    });
  });

  it('put() sends a PutObjectCommand and returns the public url + key', async () => {
    sendMock.mockResolvedValue({});
    const adapter = new S3StorageAdapter(makeConfig());
    const result = await adapter.put({
      body: Buffer.from('frame-bytes'),
      contentType: 'image/jpeg',
      ext: 'jpg',
      keyPrefix: 'hr/attendance',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.key).toMatch(/^hr\/attendance\/[0-9a-f-]{36}\.jpg$/);
    expect(result.url).toBe(`https://cdn.example/${result.key}`);

    const cmd = putCmdArgs[0] as { Bucket: string; Key: string; Body: Buffer; ContentType: string };
    expect(cmd.Bucket).toBe('hr-bucket');
    expect(cmd.Key).toBe(result.key);
    expect(cmd.ContentType).toBe('image/jpeg');
    expect(cmd.Body).toEqual(Buffer.from('frame-bytes'));
  });
});
