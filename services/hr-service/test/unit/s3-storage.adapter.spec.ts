// @aws-sdk/client-s3 is not installed in dev/CI — virtual mock captures the client construction
// and the PutObjectCommand so we can assert bucket/key/body without touching the network.

const sendMock = jest.fn();
const clientCtorArgs: unknown[] = [];
const putCmdArgs: unknown[] = [];
const deleteCmdArgs: unknown[] = [];
const getCmdArgs: unknown[] = [];

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
    DeleteObjectCommand: class {
      constructor(public input: unknown) {
        deleteCmdArgs.push(input);
      }
    },
    GetObjectCommand: class {
      constructor(public input: unknown) {
        getCmdArgs.push(input);
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
  deleteCmdArgs.length = 0;
  getCmdArgs.length = 0;
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

  // Retention erasure has to reach the object, not just the row pointing at it.
  it('remove() sends a DeleteObjectCommand for that exact key', async () => {
    sendMock.mockResolvedValue({});
    const adapter = new S3StorageAdapter(makeConfig());
    await adapter.remove('hr/documents/abc.pdf');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(deleteCmdArgs[0]).toEqual({ Bucket: 'hr-bucket', Key: 'hr/documents/abc.pdf' });
  });

  /*
   * SEC-01 — reading a document back through the service.
   *
   * HR documents used to be served straight from object storage by a permanent unsigned URL,
   * so opening a KTP scan involved no session at all. The bytes now leave through hr-service,
   * behind the capability and the depot check, which means this adapter has to be able to
   * fetch them.
   */
  it('getObject() sends a GetObjectCommand and returns the bytes with their type', async () => {
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      ContentType: 'application/pdf',
    });
    const adapter = new S3StorageAdapter(makeConfig());

    await expect(adapter.getObject('hr/documents/abc.pdf')).resolves.toEqual({
      body: Buffer.from([1, 2, 3]),
      contentType: 'application/pdf',
    });
    expect(getCmdArgs[0]).toEqual({ Bucket: 'hr-bucket', Key: 'hr/documents/abc.pdf' });
  });

  it('getObject() answers null for a type the bucket did not record', async () => {
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([9]) },
    });
    await expect(new S3StorageAdapter(makeConfig()).getObject('k')).resolves.toMatchObject({
      contentType: null,
    });
  });

  // An object that is gone must not come back as an empty document — a blank KTP scan is
  // worse than an error, because it looks like a filed one.
  it('getObject() throws when the object has no body at all', async () => {
    sendMock.mockResolvedValue({});
    await expect(new S3StorageAdapter(makeConfig()).getObject('missing')).rejects.toThrow(
      /no body/i,
    );
  });
});
