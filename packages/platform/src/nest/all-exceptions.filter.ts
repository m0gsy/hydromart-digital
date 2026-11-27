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
  [extra: string]: unknown;
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
/**
 * Postgres `22003` (integer out of range / numeric field overflow), however Prisma wraps it:
 * P2020 from a typed query, P2010 with `meta.code` from `$queryRaw`, P2033 past 64 bits, or the
 * bare driver error. Every int4 column behind a DTO without `@Max` could raise it — a price
 * typed with two extra zeros is enough — and each one was a masked 500 plus a Sentry page for
 * what is a bad input (POST /depots/:id/inventory, 2026-11-16). Duck-typed: this package does
 * not depend on any one service's generated Prisma client.
 */
function isNumberOutOfRange(exception: unknown): boolean {
  const e = exception as { name?: unknown; code?: unknown; meta?: { code?: unknown } } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === '22003') return true;
  return (
    e.name === 'PrismaClientKnownRequestError' &&
    (e.code === 'P2020' || e.code === 'P2033' || e.meta?.code === '22003')
  );
}

/**
 * A 5xx whose cause is already reported ONCE somewhere else, so paging on every request would only
 * repeat it: hr's face engine being down (NeoFaceProvider sends one message when it goes down, and
 * ServiceDegraded face-engine follows it until it answers again). 2026-11-27: 33 refused enrolments
 * in 40 minutes were 33 "Unhandled error" logs, the Discord messages and the Sentry events of one
 * outage. The caller still gets the status and the message; the log keeps one line, no stack.
 * Duck-typed: the marker lives on a service's own error class.
 */
function reportedElsewhere(exception: unknown): boolean {
  return (exception as { reportedElsewhere?: unknown } | null)?.reportedElsewhere === true;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const body = this.toErrorBody(exception, request.url);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR && reportedElsewhere(exception)) {
      this.logger.warn(
        `${request.method} ${request.url} answered ${body.statusCode}: ${String((exception as Error).message)}`,
      );
    } else if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
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
        ...exception.details,
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
    if (isNumberOutOfRange(exception)) {
      // Still logged: an overflow the server computed itself (a sum, a counter) is a bug, and
      // this keeps its stack in the logs even though the caller is no longer told 500.
      this.logger.warn(`Number out of range on ${path}: ${String((exception as Error)?.message)}`);
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'NUMBER_OUT_OF_RANGE',
        message: 'A number is larger than this field can hold. Check the amounts entered.',
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
