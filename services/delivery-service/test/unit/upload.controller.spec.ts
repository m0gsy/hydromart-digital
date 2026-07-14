import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { UploadController } from '../../src/modules/upload.controller';
import { StoragePort } from '../../src/application/ports/storage.port';

function fakeFile(over: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('bytes'),
    ...over,
  } as Express.Multer.File;
}

describe('UploadController', () => {
  const storage: StoragePort = {
    put: jest.fn().mockResolvedValue({ url: 'http://x/uploads/pod/abc.png', key: 'pod/abc.png' }),
  };
  const controller = new UploadController(storage);

  afterEach(() => jest.clearAllMocks());

  it('rejects a missing file with 400', async () => {
    await expect(controller.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image mime with 400', async () => {
    await expect(controller.upload(fakeFile({ mimetype: 'application/pdf' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file over 5MB with 413', async () => {
    await expect(
      controller.upload(fakeFile({ size: 5 * 1024 * 1024 + 1 })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
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
});
