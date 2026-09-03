import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';

import {
  AuditMutationsInterceptor,
  describeRoute,
  redactBody,
} from './audit-mutations.interceptor';
import { AuditEvent } from './audit-trail';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const handler = (value: unknown = 'ok'): CallHandler => ({ handle: () => of(value) });

describe('describeRoute (CA-2-67)', () => {
  it('names the operator verb when it follows an id', () => {
    expect(
      describeRoute('POST', '/api/v1/api-keys/3f2504e0-4f89-11d3-9a0c-0305e82c3301/rotate'),
    ).toEqual({
      action: 'api-keys.rotate',
      target: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
  });

  it('falls back to the method when there is no such verb', () => {
    expect(describeRoute('POST', '/api/v1/api-keys')).toEqual({
      action: 'api-keys.created',
      target: undefined,
    });
    expect(describeRoute('PATCH', '/api/v1/feature-flags/express-fee')).toEqual({
      action: 'feature-flags.express-fee.changed',
      target: undefined,
    });
    expect(describeRoute('DELETE', '/api/v1/webhooks/42')).toEqual({
      action: 'webhooks.deleted',
      target: '42',
    });
    expect(describeRoute('PUT', '/api/v1/security-policy')).toEqual({
      action: 'security-policy.changed',
      target: undefined,
    });
  });

  it('recognises a cuid as an id, and keeps an unknown method verbatim', () => {
    expect(describeRoute('PURGE', '/api/v1/webhooks/clh3k9x2p0000qwertyuiop12')).toEqual({
      action: 'webhooks.purge',
      target: 'clh3k9x2p0000qwertyuiop12',
    });
  });

  it('ignores the query string and the version prefix', () => {
    expect(describeRoute('PUT', '/api/v2/settings?depotId=d1').action).toBe('settings.changed');
  });
});

describe('redactBody (CA-2-67)', () => {
  it('replaces secret-looking values and flattens the rest', () => {
    expect(
      redactBody({
        name: 'partner',
        secret: 'sk_live_abcdef',
        apiKey: 'x',
        scopes: ['a', 'b'],
        limits: { rpm: 10 },
        rollout: 25,
      }),
    ).toEqual({
      name: 'partner',
      secret: '[redacted]',
      apiKey: '[redacted]',
      scopes: '[2 item]',
      limits: '[object]',
      rollout: 25,
    });
  });

  it('returns undefined for anything that is not a plain object', () => {
    expect(redactBody(undefined)).toBeUndefined();
    expect(redactBody(null)).toBeUndefined();
    expect(redactBody('x')).toBeUndefined();
    expect(redactBody([1, 2])).toBeUndefined();
  });
});

describe('AuditMutationsInterceptor (CA-2-67)', () => {
  let recorded: AuditEvent[];
  let sink: { record: jest.Mock };

  beforeEach(() => {
    recorded = [];
    sink = jest.fn() as never;
    sink = {
      record: jest.fn(async (e: AuditEvent) => {
        recorded.push(e);
      }),
    };
  });

  it('records the actor, target and redacted body of a write', async () => {
    const interceptor = new AuditMutationsInterceptor(sink);
    await firstValueFrom(
      interceptor.intercept(
        ctx({
          method: 'POST',
          originalUrl: '/api/v1/api-keys',
          user: { sub: 'u-1' },
          body: { name: 'partner', secret: 'sk_live' },
          params: {},
        }),
        handler(),
      ),
    );
    // The sink is called without being awaited by the request, so let the microtask run.
    await Promise.resolve();
    expect(recorded).toEqual([
      {
        action: 'api-keys.created',
        actorId: 'u-1',
        target: undefined,
        success: true,
        metadata: { name: 'partner', secret: '[redacted]' },
      },
    ]);
  });

  /*
   * The revert-proof pair. Reads are the bulk of console traffic; if this interceptor ever
   * starts recording them the trail becomes unreadable, which is the same as not having one.
   */
  it.each(['GET', 'HEAD', 'OPTIONS'])('records nothing for %s', async (method) => {
    const interceptor = new AuditMutationsInterceptor(sink);
    await firstValueFrom(
      interceptor.intercept(ctx({ method, originalUrl: '/api/v1/api-keys' }), handler()),
    );
    await Promise.resolve();
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('records a refused change as a failure, and still rethrows it', async () => {
    const interceptor = new AuditMutationsInterceptor(sink);
    const boom = new Error('capability not granted');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          ctx({
            method: 'PUT',
            url: '/api/v1/access/matrix/settingsGlobal',
            user: { sub: 'u-2' },
            params: { capability: 'settingsGlobal' },
          }),
          { handle: () => throwError(() => boom) },
        ),
      ),
    ).rejects.toThrow('capability not granted');
    await Promise.resolve();
    expect(recorded[0]).toMatchObject({
      action: 'access.matrix.settingsGlobal.changed',
      actorId: 'u-2',
      success: false,
      metadata: { params: { capability: 'settingsGlobal' }, error: 'capability not granted' },
    });
  });

  it('passes the request through untouched when no sink is provided', async () => {
    const interceptor = new AuditMutationsInterceptor();
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx({ method: 'POST', originalUrl: '/x' }), handler('body')),
      ),
    ).resolves.toBe('body');
  });

  /*
   * Fail-open, and loudly. An API key that has already rotated cannot be un-rotated because
   * its record did not post, so the sink's failure must not reach the caller — but a gap in
   * an audit trail that nobody is told about is worse than the gap.
   */
  it('never lets a sink failure reach the caller, and logs the dropped entry', async () => {
    const interceptor = new AuditMutationsInterceptor({
      record: () => Promise.reject(new Error('auth-service down')),
    });
    const logged: string[] = [];
    jest
      .spyOn((interceptor as never as { logger: { error(m: string): void } }).logger, 'error')
      .mockImplementation((m: string) => {
        logged.push(m);
      });

    await expect(
      firstValueFrom(
        interceptor.intercept(
          ctx({ method: 'DELETE', originalUrl: '/api/v1/webhooks/9', user: null }),
          handler('gone'),
        ),
      ),
    ).resolves.toBe('gone');
    await Promise.resolve();
    await Promise.resolve();
    expect(logged).toEqual(['audit entry dropped for webhooks.deleted: auth-service down']);
  });

  it('treats a missing user as a system actor rather than throwing', async () => {
    const interceptor = new AuditMutationsInterceptor(sink);
    await firstValueFrom(
      interceptor.intercept(ctx({ method: 'PUT', originalUrl: '/api/v1/sla-policy' }), handler()),
    );
    await Promise.resolve();
    expect(recorded[0].actorId).toBeNull();
  });
  /*
   * Both defaults on the request object, which exist because an interceptor runs against
   * whatever the framework hands it. A missing method must not be guessed as a write.
   */
  it('treats a request with no method as a read, and survives one with no url', async () => {
    const interceptor = new AuditMutationsInterceptor(sink);
    await firstValueFrom(interceptor.intercept(ctx({}), handler()));
    await Promise.resolve();
    expect(sink.record).not.toHaveBeenCalled();

    await firstValueFrom(interceptor.intercept(ctx({ method: 'POST' }), handler()));
    await Promise.resolve();
    expect(recorded[0].action).toBe('created');
  });
});
