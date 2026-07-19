import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';

import { MulterExceptionFilter } from '../../src/modules/multer-exception.filter';

function fakeHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  return { host: host as unknown as ArgumentsHost, res };
}

describe('MulterExceptionFilter', () => {
  const filter = new MulterExceptionFilter();

  it('maps LIMIT_FILE_SIZE to a 413 payload', () => {
    const { host, res } = fakeHost();
    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'file exceeds 5MB',
      error: 'Payload Too Large',
    });
  });

  it('maps other multer errors to a 400 with the original message', () => {
    const { host, res } = fakeHost();
    const err = new MulterError('LIMIT_UNEXPECTED_FILE');
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: err.message,
      error: 'Bad Request',
    });
  });
});
