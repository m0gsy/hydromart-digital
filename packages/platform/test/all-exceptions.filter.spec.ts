import { ArgumentsHost } from '@nestjs/common';

import { AllExceptionsFilter } from '../src/nest/all-exceptions.filter';
import * as alerter from '../src/nest/error-alerter';

function host() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };
  const request = { url: '/api/v1/attendance/check-in', method: 'POST' };
  return {
    captured,
    host: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost,
  };
}

/*
 * An HTTP 500 alert on POST /attendance/check-in: `BadRequestError: request aborted` from raw-body.
 * The CLIENT hung up mid-upload (a phone on a bad network sending a face image). body-parser raises an
 * http-errors error (status 400, expose true), which is not a Nest HttpException, so the filter masked it as
 * a 500 and paged the team for a user's dropped connection.
 */
describe('AllExceptionsFilter · errors raised by the body parser', () => {
  const filter = new AllExceptionsFilter();
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(alerter, 'alertServerError').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const httpError = (status: number, message: string, type: string) =>
    Object.assign(new Error(message), { status, statusCode: status, expose: true, type });

  it('answers an aborted upload with the 4xx it already is, and does not page anyone', () => {
    const { host: h, captured } = host();
    filter.catch(httpError(400, 'request aborted', 'request.aborted'), h);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ statusCode: 400, code: 'REQUEST_ABORTED' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('does the same for an oversized body and any other exposed client error', () => {
    const big = host();
    filter.catch(httpError(413, 'request entity too large', 'entity.too.large'), big.host);
    expect(big.captured.status).toBe(413);
    expect(big.captured.body).toMatchObject({ code: 'REQUEST_REJECTED' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('still masks a genuine failure as a 500 and alerts, and an unexposed 5xx stays masked', () => {
    const a = host();
    filter.catch(new Error('boom'), a.host);
    expect(a.captured.status).toBe(500);
    expect(alert).toHaveBeenCalledTimes(1);
    const b = host();
    filter.catch(Object.assign(new Error('db'), { status: 500, expose: false }), b.host);
    expect(b.captured.status).toBe(500);
    expect(alert).toHaveBeenCalledTimes(2);
    // An error that merely HAS a 4xx status but is not marked exposed is not trusted as a client error.
    const c = host();
    filter.catch(Object.assign(new Error('internal'), { status: 404 }), c.host);
    expect(c.captured.status).toBe(500);
  });
});
