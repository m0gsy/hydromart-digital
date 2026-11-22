import { ArgumentsHost, BadRequestException } from '@nestjs/common';

import { alertServerError } from '@hydromart/platform';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import {
  ExternalTokensOffError,
  PhoneAlreadyRegisteredError,
  PhoneHeldByUnusedCustomerError,
  TotpOffError,
} from '../../src/domain/errors/auth.errors';

jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));
const alert = alertServerError as jest.MockedFunction<typeof alertServerError>;

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

  beforeEach(() => alert.mockClear());

  it('maps a domain error to its status and machine-readable code', () => {
    const { host, captured } = mockHost();
    filter.catch(new PhoneAlreadyRegisteredError(), host);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      statusCode: 409,
      code: 'AUTH_PHONE_TAKEN',
      path: '/api/v1/auth/register',
    });
    expect(captured.body).not.toHaveProperty('details');
  });

  // hr-service names the account in the confirmation it shows HR; the facts travel here.
  it("sends a domain error's details beside its message", () => {
    const { host, captured } = mockHost();
    filter.catch(
      new PhoneHeldByUnusedCustomerError('Khoirul', new Date('2026-11-18T05:00:00.000Z')),
      host,
    );

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      code: 'AUTH_PHONE_UNUSED_CUSTOMER',
      details: { customerName: 'Khoirul', createdAt: '2026-11-18T05:00:00.000Z' },
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

  it('pages on a real 5xx', () => {
    filter.catch(new Error('boom'), mockHost().host);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  // 2026-11-22: probes of the switched-off token routes rang Discord four times overnight.
  it.each([new ExternalTokensOffError(), new TotpOffError()])(
    'answers a kill switch with 503 and its code, and pages nobody (%p)',
    (error) => {
      const { host, captured } = mockHost();
      filter.catch(error, host);

      expect(captured.status).toBe(503);
      expect(captured.body).toMatchObject({ statusCode: 503, code: error.code });
      expect(alert).not.toHaveBeenCalled();
    },
  );
});
