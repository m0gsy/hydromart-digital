import { DataClass } from '../../src/domain/retention';
import { PurgeService } from '../../src/application/services/purge.service';
import { RemotePurgeExecutor } from '../../src/infrastructure/http/remote-purge.executor';

const NOW = new Date('2026-07-29T00:00:00.000Z');

function plan(entries: Array<Partial<{ dataset: string; dataClass: DataClass; purgeExempt: boolean; cutoff: Date | null }>>) {
  return {
    purgeCutoffs: jest.fn(async () =>
      entries.map((e) => ({
        dataset: e.dataset ?? 'ds',
        dataClass: e.dataClass ?? DataClass.OPERATIONAL,
        purgeExempt: e.purgeExempt ?? false,
        cutoff: e.cutoff === undefined ? new Date('2026-01-01T00:00:00.000Z') : e.cutoff,
      })),
    ),
  };
}

describe('PurgeService', () => {
  it('never touches a FINANCIAL dataset, even with an executor registered', async () => {
    const executor = { dataset: 'orders_transactions', mode: 'DELETE' as const, purge: jest.fn() };
    const service = new PurgeService(
      plan([{ dataset: 'orders_transactions', dataClass: DataClass.FINANCIAL, purgeExempt: true, cutoff: null }]) as never,
      [executor],
    );

    const result = await service.run({ now: NOW });

    expect(result.entries[0]).toMatchObject({ outcome: 'EXEMPT', deleted: 0 });
    expect(executor.purge).not.toHaveBeenCalled();
  });

  it('treats a null cutoff as keep-everything, never as delete-everything', async () => {
    const executor = { dataset: 'ds', mode: 'DELETE' as const, purge: jest.fn() };
    const service = new PurgeService(plan([{ cutoff: null }]) as never, [executor]);

    const result = await service.run({ now: NOW });

    expect(result.entries[0]?.outcome).toBe('NOT_DUE');
    expect(executor.purge).not.toHaveBeenCalled();
  });

  it('deletes through the executor and reports the count', async () => {
    const executor = { dataset: 'audit_logs', mode: 'DELETE' as const, purge: jest.fn(async () => 12) };
    const service = new PurgeService(plan([{ dataset: 'audit_logs' }]) as never, [executor]);

    const result = await service.run({ now: NOW });

    expect(executor.purge).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
    expect(result.entries[0]).toMatchObject({ outcome: 'PURGED', deleted: 12 });
    expect(result.totalDeleted).toBe(12);
  });

  it('names a dataset with no executor as UNENFORCED instead of skipping it silently', async () => {
    const service = new PurgeService(plan([{ dataset: 'pesanan' }]) as never, []);

    const result = await service.run({ now: NOW });

    expect(result.entries[0]?.outcome).toBe('UNENFORCED');
    expect(result.unenforced).toEqual(['pesanan']);
  });

  it('a dry run deletes nothing but still reports the unenforced gap', async () => {
    const executor = { dataset: 'audit_logs', mode: 'DELETE' as const, purge: jest.fn() };
    const service = new PurgeService(
      plan([{ dataset: 'audit_logs' }, { dataset: 'pesanan' }]) as never,
      [executor],
    );

    const result = await service.run({ dryRun: true, now: NOW });

    expect(executor.purge).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.totalDeleted).toBe(0);
    expect(result.unenforced).toEqual(['pesanan']);
  });

  it('one failing dataset does not abort the others', async () => {
    const boom = { dataset: 'audit_logs', mode: 'DELETE' as const, purge: jest.fn(async () => { throw new Error('owner down'); }) };
    const ok = { dataset: 'notifications_messages', mode: 'DELETE' as const, purge: jest.fn(async () => 3) };
    const service = new PurgeService(
      plan([{ dataset: 'audit_logs' }, { dataset: 'notifications_messages' }]) as never,
      [boom, ok],
    );

    const result = await service.run({ now: NOW });

    expect(result.entries[0]).toMatchObject({ outcome: 'FAILED', error: 'owner down', deleted: 0 });
    expect(result.entries[1]).toMatchObject({ outcome: 'PURGED', deleted: 3 });
    expect(result.totalDeleted).toBe(3);
  });
});

describe('RemotePurgeExecutor', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('is unconfigured without a URL or key, so the registry can drop it', () => {
    expect(new RemotePurgeExecutor('ds', '', '/p', 'k').configured).toBe(false);
    expect(new RemotePurgeExecutor('ds', 'http://x', '/p', '').configured).toBe(false);
    expect(new RemotePurgeExecutor('ds', 'http://x', '/p', 'k').configured).toBe(true);
  });

  it('posts the cutoff with the internal key and returns the count', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deleted: 7 }) });
    const executor = new RemotePurgeExecutor('audit_logs', 'http://auth', '/purge', 'k');

    expect(await executor.purge(NOW)).toBe(7);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://auth/purge');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
    expect(init.body).toBe(JSON.stringify({ cutoff: NOW.toISOString() }));
  });

  it('reads `eligible` in REPORT mode and `deleted` in DELETE mode', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ eligible: 5, deleted: 99 }) });
    const report = new RemotePurgeExecutor('hr', 'http://hr', '/r', 'k', 'REPORT');
    expect(await report.purge(NOW)).toBe(5);

    const del = new RemotePurgeExecutor('audit', 'http://auth', '/p', 'k');
    expect(await del.purge(NOW)).toBe(99);
  });

  it('treats a missing count as zero rather than NaN', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await new RemotePurgeExecutor('ds', 'http://x', '/p', 'k').purge(NOW)).toBe(0);
  });

  it('raises on a non-2xx instead of reporting a silent zero', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(new RemotePurgeExecutor('ds', 'http://x', '/p', 'k').purge(NOW)).rejects.toThrow('503');
  });

  it('raises when the owner is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new RemotePurgeExecutor('ds', 'http://x', '/p', 'k').purge(NOW)).rejects.toThrow(
      'unreachable',
    );
  });
});

describe('PurgeService REPORT executors', () => {
  const NOW2 = new Date('2026-07-29T00:00:00.000Z');
  const reportPlan = {
    purgeCutoffs: jest.fn(async () => [
      {
        dataset: 'hr_employee_records',
        dataClass: DataClass.HR,
        purgeExempt: false,
        cutoff: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]),
  };

  it('counts without deleting, and never inflates totalDeleted', async () => {
    const executor = { dataset: 'hr_employee_records', mode: 'REPORT' as const, purge: jest.fn(async () => 9) };
    const service = new PurgeService(reportPlan as never, [executor]);

    const result = await service.run({ now: NOW2 });

    expect(result.entries[0]).toMatchObject({ outcome: 'REPORT_ONLY', eligible: 9, deleted: 0 });
    expect(result.totalDeleted).toBe(0);
    expect(result.awaitingReview).toEqual(['hr_employee_records']);
  });

  it('a report of zero is not something waiting on a human', async () => {
    const executor = { dataset: 'hr_employee_records', mode: 'REPORT' as const, purge: jest.fn(async () => 0) };
    const service = new PurgeService(reportPlan as never, [executor]);

    const result = await service.run({ now: NOW2 });

    expect(result.entries[0]).toMatchObject({ outcome: 'REPORT_ONLY', eligible: 0 });
    expect(result.awaitingReview).toEqual([]);
  });
});
