import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { AuditInterceptor } from '../../src/infrastructure/http/audit.interceptor';
import { AuditService } from '../../src/application/services/audit.service';
import { AuditWrite } from '../../src/application/ports/audit.repository';

function ctx(
  method: string,
  path: string,
  body: unknown = null,
  reqBody: unknown = undefined,
): { context: ExecutionContext; handler: CallHandler } {
  const request = {
    method,
    path,
    url: path,
    body: reqBody,
    user: { sub: 'actor-1' },
    headers: { 'x-forwarded-for': '9.9.9.9' },
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const handler: CallHandler = { handle: () => of(body) };
  return { context, handler };
}

function build() {
  const recorded: AuditWrite[] = [];
  const audit = {
    record: async (e: AuditWrite) => void recorded.push(e),
  } as unknown as AuditService;
  return { interceptor: new AuditInterceptor(audit), recorded };
}

describe('AuditInterceptor', () => {
  it('records a mutating request with entity + entityId from the route', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx(
      'POST',
      '/api/v1/employees/22222222-2222-2222-2222-222222222222/face/enroll',
    );
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: 'actor-1',
      action: 'POST',
      entity: 'employees',
      entityId: '22222222-2222-2222-2222-222222222222',
      ip: '9.9.9.9',
    });
  });

  it('falls back to the response body id when the route has no uuid', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx('POST', '/api/v1/bonuses', { id: 'b-99' });
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded[0].entity).toBe('bonuses');
    expect(recorded[0].entityId).toBe('b-99');
  });

  it('captures the submitted body as `after`, omitting heavy/sensitive keys', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx('PATCH', '/api/v1/attendance/a1/adjust', null, {
      status: 'LEAVE',
      reason: 'cuti',
      image: 'BIGBASE64',
    });
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded[0].after).toMatchObject({
      status: 'LEAVE',
      reason: 'cuti',
      image: '[omitted]',
    });
  });

  it('does not record read (GET) requests', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx('GET', '/api/v1/employees');
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded).toHaveLength(0);
  });

  it('truncates long strings and stringifies non-string values in the body', async () => {
    const { interceptor, recorded } = build();
    const long = 'x'.repeat(600);
    const { context, handler } = ctx('POST', '/api/v1/notes', null, { long, count: 5 });
    await firstValueFrom(interceptor.intercept(context, handler));
    const after = recorded[0].after as Record<string, unknown>;
    expect(after.long).toBe(`${'x'.repeat(500)}…`);
    expect(after.count).toBe(5);
  });

  it('records actorId null when the request has no authenticated user, and null after for an empty body', async () => {
    const { interceptor, recorded } = build();
    const request = {
      method: 'POST',
      path: '/api/v1/ping',
      url: '/api/v1/ping',
      body: {},
      user: undefined,
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded[0].actorId).toBeNull();
    expect(recorded[0].after).toBeNull();
  });
});
