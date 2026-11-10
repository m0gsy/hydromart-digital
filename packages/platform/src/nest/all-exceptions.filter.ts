import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { DomainError } from '../domain/domain-error';
import { alertServerError } from './error-alerter';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

/**
 * Translates every thrown error into a consistent JSON envelope and standard HTTP
 * status (PRD §21). Domain errors carry their own status + machine-readable code;
 * validation/HTTP errors pass through; anything else is a masked 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const body = this.toErrorBody(exception, request.url);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${String(
          (exception as Error)?.stack ?? exception,
        )}`,
      );
      alertServerError({
        method: request.method,
        path: request.url,
        status: body.statusCode,
        exception,
      });
    }
    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof DomainError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        timestamp,
        path,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);
      return { statusCode: status, code: this.httpErrorCode(status), message, timestamp, path };
    }
    // Errors the body parser raises (raw-body / body-parser, via http-errors) are not Nest HttpExceptions
    // but ARE client errors, and say so: `expose: true` with a 4xx status. A phone that drops the
    // connection mid-upload used to surface as a masked 500 and a page to the team. Trust only that
    // explicit marker: a stray `status` on some internal error must not turn into a 4xx.
    const client = exception as { status?: unknown; expose?: unknown; type?: unknown; message?: unknown };
    if (
      client?.expose === true &&
      typeof client.status === 'number' &&
      client.status >= 400 &&
      client.status < 500
    ) {
      return {
        statusCode: client.status,
        code: client.type === 'request.aborted' ? 'REQUEST_ABORTED' : 'REQUEST_REJECTED',
        message: String(client.message ?? 'Request could not be read.'),
        timestamp,
        path,
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      timestamp,
      path,
    };
  }

  private httpErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      // FTR-008: these three used to fall through to HTTP_ERROR. The status never changes.
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'SERVICE_UNAVAILABLE';
      default:
        return 'HTTP_ERROR';
    }
  }
}
