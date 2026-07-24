import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { AuditInterceptor } from '../../src/infrastructure/http/audit.interceptor';
import { AuditService } from '../../src/application/services/audit.service';
import { AuditWrite } from '../../src/application/ports/audit.repository';

function ctx(method: string, path: string, body: unknown = null): { context: ExecutionContext; handler: CallHandler } {
  const request = {
    method,
    path,
    url: path,
    user: { sub: 'actor-1' },
    headers: { 'x-forwarded-for': '9.9.9.9' },
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const handler: CallHandler = { handle: () => of(body) };
  return { context, handler };
}

function build() {
  const recorded: AuditWrite[] = [];
  const audit = { record: async (e: AuditWrite) => void recorded.push(e) } as unknown as AuditService;
  return { interceptor: new AuditInterceptor(audit), recorded };
}

describe('AuditInterceptor', () => {
  it('records a mutating request with entity + entityId from the route', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx('POST', '/api/v1/employees/22222222-2222-2222-2222-222222222222/face/enroll');
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

  it('does not record read (GET) requests', async () => {
    const { interceptor, recorded } = build();
    const { context, handler } = ctx('GET', '/api/v1/employees');
    await firstValueFrom(interceptor.intercept(context, handler));
    expect(recorded).toHaveLength(0);
  });
});
