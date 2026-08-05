import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { UploadController } from '../../src/modules/upload.controller';
import { StoragePort } from '../../src/application/ports/storage.port';

// H-20: the controller reads the BYTES now, so a fake file needs real magic numbers.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);

function fakeFile(over: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    mimetype: 'image/png',
    size: 1024,
    buffer: PNG,
    ...over,
  } as Express.Multer.File;
}

describe('UploadController', () => {
  const storage: StoragePort = {
    put: jest.fn().mockResolvedValue({ url: 'http://x/uploads/pod/abc.png', key: 'pod/abc.png' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new UploadController(storage);

  afterEach(() => jest.clearAllMocks());

  it('rejects a missing file with 400', async () => {
    await expect(controller.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image with 400', async () => {
    await expect(
      controller.upload(fakeFile({ buffer: Buffer.from('%PDF-1.7 not an image') })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The label said image/png; the bytes are a script. The bucket serves what it is given
  // straight back to a browser, so the bytes decide.
  it('rejects content that only claims to be a png', async () => {
    await expect(
      controller.upload(fakeFile({ buffer: Buffer.from('<script>alert(1)</script>  ') })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over 5MB with 413', async () => {
    await expect(controller.upload(fakeFile({ size: 5 * 1024 * 1024 + 1 }))).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('accepts a png and returns the storage url', async () => {
    const result = await controller.upload(fakeFile({ mimetype: 'image/png' }));
    expect(result).toEqual({ url: 'http://x/uploads/pod/abc.png' });
    expect(storage.put).toHaveBeenCalledWith({
      body: expect.any(Buffer),
      contentType: 'image/png',
      ext: 'png',
    });
  });

  it('answers 503, not a bare 500, when object storage is unreachable', async () => {
    (storage.put as jest.Mock).mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND dummy.local'),
    );
    await expect(controller.upload(fakeFile({ mimetype: 'image/png' }))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
