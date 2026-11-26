import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

/** Maps multer's file-size abort to a clean 413 (else it would surface as 500). */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
    res.status(status).json({
      statusCode: status,
      message: tooLarge ? 'file exceeds 5MB' : error.message,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
    });
  }
}
