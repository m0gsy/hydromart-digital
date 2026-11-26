import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { MachineReadAuditInterceptor } from '../../src/modules/machine-read-audit.interceptor';

/* AI-31: a machine account's read is written to the trail first, and refused when it cannot be. */
describe('MachineReadAuditInterceptor', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = { authServiceUrl: 'http://auth:3001', internalServiceKey: 'internal-key' } as DashboardConfigService;
  const ctx = (req: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const machine = { user: { sub: 'machine-1', via: 'machine' }, query: { metric: 'U-02', period: 'week', split: 'depot', junk: 'x', date: 7 } };

  it('lets a person through without a row', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const run = jest.fn(() => of('answer'));
    for (const user of [{ sub: 'p', via: 'ai' }, undefined]) {
      await expect(firstValueFrom(new MachineReadAuditInterceptor(config).intercept(ctx({ user }), { handle: run }))).resolves.toBe('answer');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes who asked what BEFORE the answer, with the machine id as actor and only plain asked values', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    global.fetch = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 201 } as never;
    }) as never;
    const run = jest.fn(() => {
      expect(calls).toHaveLength(1); // the row was stored before the handler ran
      return of('answer');
    });
    await expect(firstValueFrom(new MachineReadAuditInterceptor(config).intercept(ctx(machine), { handle: run }))).resolves.toBe('answer');
    expect(calls[0].url).toBe('http://auth:3001/api/v1/auth/audit/internal');
    expect(calls[0].body).toMatchObject({
      action: 'dashboard.ai-read.money.requested',
      actorId: 'machine-1',
      target: 'U-02',
      metadata: { via: 'machine', metric: 'U-02', period: 'week', split: 'depot' },
    });
    expect(calls[0].body.metadata).not.toHaveProperty('junk');
    expect(calls[0].body.metadata).not.toHaveProperty('date');
  });

  it('answers 503 and reads nothing when the row cannot be stored', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }) as never) as never;
    const run = jest.fn(() => of('answer'));
    await expect(firstValueFrom(new MachineReadAuditInterceptor(config).intercept(ctx(machine), { handle: run }))).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(run).not.toHaveBeenCalled();
  });

  it('copes with a request without a query or an account id', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 201 }) as never) as never;
    await expect(
      firstValueFrom(new MachineReadAuditInterceptor(config).intercept(ctx({ user: { via: 'machine' } }), { handle: () => of(1) })),
    ).resolves.toBe(1);
  });
});
