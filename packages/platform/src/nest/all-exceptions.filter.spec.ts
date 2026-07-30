import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

import { DomainError, HTTP_STATUS } from '../domain/domain-error';
import { AllExceptionsFilter } from './all-exceptions.filter';

class OutOfStockError extends DomainError {
  readonly code = 'OUT_OF_STOCK';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Stok galon habis.');
  }
}

function hostFor(url = '/api/v1/orders', method = 'POST') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, method }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, body: () => json.mock.calls[0][0] as Record<string, unknown> };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes a domain error through with its own status and code', () => {
    const { host, status, body } = hostFor();
    filter.catch(new OutOfStockError(), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(body()).toMatchObject({
      statusCode: 409,
      code: 'OUT_OF_STOCK',
      message: 'Stok galon habis.',
      path: '/api/v1/orders',
    });
  });

  it('keeps the validation message array from a Nest HttpException', () => {
    const { host, body } = hostFor();
    filter.catch(new BadRequestException(['phone must be a string']), host);
    expect(body()).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: ['phone must be a string'],
    });
  });

  it('handles an HttpException whose response is a bare string', () => {
    const { host, body } = hostFor();
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);
    expect(body()).toMatchObject({ statusCode: 418, code: 'HTTP_ERROR', message: 'teapot' });
  });

  it.each([
    [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
    [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
    [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
    [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED'],
    [HttpStatus.BAD_GATEWAY, 'HTTP_ERROR'],
  ])('maps HTTP %i to code %s', (httpStatus, code) => {
    const { host, body } = hostFor();
    filter.catch(new HttpException('x', httpStatus), host);
    expect(body()).toMatchObject({ code });
  });

  // The masking is the point: an unexpected error must not leak a stack, a driver
  // message, or a query to the caller. It goes to the log, never to the response.
  it('masks an unknown error as a generic 500 and logs it', () => {
    const { host, status, body } = hostFor('/api/v1/boom', 'GET');
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body())).not.toContain('ECONNREFUSED');
    expect(filter['logger'].error).toHaveBeenCalled();
  });

  it('masks a thrown non-Error too', () => {
    const { host, body } = hostFor();
    filter.catch('just a string', host);
    expect(body()).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
  });
});
