import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { DepotAssignmentApplier } from '../../src/application/services/depot-assignment-applier.service';
import { DepotAssignmentService } from '../../src/application/services/depot-assignment.service';
import { DepotDirectoryHttpAdapter } from '../../src/infrastructure/http/depot-directory.http.adapter';

const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe('DepotDirectoryHttpAdapter', () => {
  const cfg = (url = 'http://depot:3007/', internalKey = 'k') =>
    ({ depotService: { url, internalKey } }) as never;
  afterEach(() => jest.restoreAllMocks());

  it('asks depot-service with the internal key and reports the answer', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({})));
    const a = new DepotDirectoryHttpAdapter(cfg());
    await expect(a.isActive(P)).resolves.toBe(true);
    await expect(a.isActive(P)).resolves.toBe(false);
    await expect(a.isActive(P)).resolves.toBe(false); // no answer in the body is not "open"
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://depot:3007/api/v1/depots/internal/${P}/active`);
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('a depot that does not exist is a 404; any other failure is a 503, never a yes or a no', async () => {
    const a = new DepotDirectoryHttpAdapter(cfg());
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(a.isActive(P)).rejects.toBeInstanceOf(NotFoundException);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(a.isActive(P)).rejects.toBeInstanceOf(ServiceUnavailableException);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(a.isActive(P)).rejects.toThrow(/tidak terjangkau/);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce('plain');
    await expect(a.isActive(P)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses to guess when it is not configured', async () => {
    await expect(new DepotDirectoryHttpAdapter(cfg('', 'k')).isActive(P)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(new DepotDirectoryHttpAdapter(cfg('http://x', '')).isActive(P)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('planning towards a closed or unknown depot', () => {
  function plan(directory: { isActive: jest.Mock }) {
    const repo = {
      createChecked: jest.fn(async (data: Record<string, unknown>, check: (o: unknown[]) => void) => {
        check([]);
        return { id: 'as-1', ...data };
      }),
    };
    const employees = {
      getById: async () => ({
        id: 'emp-1',
        role: 'STAFF_DEPOT',
        authSubjectId: 'a',
        status: 'ACTIVE',
        depotId: G,
        homeDepotId: G,
        joinDate: day('2026-01-01'),
        exitDate: null,
      }),
    };
    const svc = new DepotAssignmentService(
      repo as never,
      employees as never,
      { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
      {} as never,
      directory as never,
    );
    return { svc, repo };
  }
  const input = { employeeId: 'emp-1', kind: 'PERMANENT' as const, depotId: P, startDate: '2026-10-20' };
  const hr = { sub: 'x', role: 'HR' } as never;

  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('an open depot plans normally', async () => {
    const { svc } = plan({ isActive: jest.fn().mockResolvedValue(true) });
    await expect(svc.plan(hr, input)).resolves.toBeDefined();
  });

  it('a closed depot is refused, naming the reason', async () => {
    const { svc } = plan({ isActive: jest.fn().mockResolvedValue(false) });
    const err = await svc.plan(hr, input).catch((e) => e);
    expect((err.getResponse() as { message: string[] }).message.join(' ')).toMatch(/tidak aktif/);
  });

  it('an unreachable depot-service stops the plan (503) instead of letting it through', async () => {
    const { svc, repo } = plan({ isActive: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')) });
    await expect(svc.plan(hr, input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.createChecked).not.toHaveBeenCalled();
  });
});

describe('the sweep and a depot that has closed', () => {
  function sweepWith(isActive: jest.Mock, status: 'PLANNED' | 'ACTIVE') {
    const row = {
      id: 'as-1',
      employeeId: 'emp-1',
      kind: 'LOAN',
      depotId: P,
      startDate: day('2026-10-16'),
      endDate: day('2026-10-25'),
      status,
      attempts: 0,
      createdByRole: 'HR',
    };
    const failures: unknown[][] = [];
    const update = jest.fn(async () => ({}));
    const employee = {
      id: 'emp-1',
      role: 'STAFF_DEPOT',
      status: 'ACTIVE',
      authSubjectId: 'a',
      depotId: status === 'ACTIVE' ? P : G,
      homeDepotId: G,
    };
    const svc = new DepotAssignmentApplier(
      {
        findDue: async () => [row],
        findById: async () => row,
        recordFailure: async (...a: unknown[]) => void failures.push(a),
      } as never,
      { findById: async () => employee, update } as never,
      { assignRole: jest.fn(async () => undefined) } as never,
      { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
      { record: async () => undefined } as never,
      undefined,
      { isActive } as never,
    );
    return { svc, failures, update };
  }
  const NOW = new Date('2026-10-26T03:00:00.000Z');

  it('does not move anyone to a depot that has closed, and gives up with the reason', async () => {
    const { svc, failures, update } = sweepWith(jest.fn().mockResolvedValue(false), 'PLANNED');
    const r = await svc.applyDue(NOW);
    expect(r.applied).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(failures[0]).toEqual(['as-1', 'Depot tujuan tidak aktif lagi', 1]);
  });

  it('retries when depot-service cannot say', async () => {
    const { svc, failures } = sweepWith(jest.fn().mockRejectedValue(new Error('down')), 'PLANNED');
    await svc.applyDue(NOW);
    expect(failures[0]).toEqual(['as-1', 'down', DepotAssignmentApplier.MAX_ATTEMPTS]);
  });

  it('never blocks the way HOME: a depot that closed under somebody still lets them leave', async () => {
    const isActive = jest.fn().mockResolvedValue(false);
    const { svc, update } = sweepWith(isActive, 'ACTIVE');
    const r = await svc.applyDue(NOW);
    expect(r.applied).toBe(1);
    expect(update).toHaveBeenCalled();
    expect(isActive).not.toHaveBeenCalled();
  });
});
