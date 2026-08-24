import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';

import { MulterExceptionFilter } from '../../src/modules/multer-exception.filter';

function mockHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { res, host };
}

describe('MulterExceptionFilter', () => {
  it('maps LIMIT_FILE_SIZE to 413', () => {
    const { res, host } = mockHost();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
  });

  it('maps other multer errors to 400', () => {
    const { res, host } = mockHost();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_UNEXPECTED_FILE'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});
