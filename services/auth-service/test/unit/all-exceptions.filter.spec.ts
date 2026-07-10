import { ArgumentsHost, BadRequestException } from '@nestjs/common';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PhoneAlreadyRegisteredError } from '../../src/domain/errors/auth.errors';

function mockHost(): { host: ArgumentsHost; captured: { status?: number; body?: unknown } } {
  const captured: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  };
  const request = { url: '/api/v1/auth/register', method: 'POST' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps a domain error to its status and machine-readable code', () => {
    const { host, captured } = mockHost();
    filter.catch(new PhoneAlreadyRegisteredError(), host);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      statusCode: 409,
      code: 'AUTH_PHONE_TAKEN',
      path: '/api/v1/auth/register',
    });
  });

  it('passes through a Nest HttpException with a mapped code', () => {
    const { host, captured } = mockHost();
    filter.catch(new BadRequestException(['phone must not be empty']), host);

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: ['phone must not be empty'],
    });
  });

  it('masks unexpected errors as a 500', () => {
    const { host, captured } = mockHost();
    filter.catch(new Error('boom'), host);

    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(captured.body)).not.toContain('boom');
  });
});
