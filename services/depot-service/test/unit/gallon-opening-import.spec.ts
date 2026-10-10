import { plainToInstance } from 'class-transformer';

import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { GallonIssueController } from '../../src/modules/gallon-issue.controller';
import { ImportGallonBalanceRowDto, ImportGallonBalancesDto } from '../../src/modules/dto/gallon-issue.dto';
import { CustomerContactHttpAdapter } from '../../src/infrastructure/http/customer-contact.http.adapter';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';

const DEPOT = '11111111-1111-1111-1111-111111111111';

function build(
  opts: { known?: Record<string, string>; openedFor?: string[]; noResolver?: boolean; noGuard?: boolean; fresh?: boolean } = {},
) {
  const created: Record<string, unknown>[] = [];
  const issues: Record<string, unknown> = {
    create: jest.fn(async (d: Record<string, unknown>) => {
      created.push(d);
      return { id: `i-${created.length}`, ...d };
    }),
    hasOpeningBalance: jest.fn(async (_d: string, c: string) => (opts.openedFor ?? []).includes(c)),
  };
  if (opts.noGuard) delete issues.hasOpeningBalance;
  const contacts: Record<string, unknown> = {
    resolveByPhone: jest.fn(async (phone: string) => {
      const id = (opts.known ?? {})[phone];
      return id ? { customerId: id, status: opts.fresh ? 'created' : 'pending' } : null;
    }),
  };
  if (opts.noResolver) delete contacts.resolveByPhone;
  const inventory = { moveRawLine: jest.fn() };
  const svc = new GallonIssueService(
    issues as never,
    { exists: async () => true } as never,
    {} as never,
    inventory as never,
    {} as never,
    contacts as never,
  );
  return { svc, created, inventory, issues, contacts };
}

describe('GallonIssueService.importOpening', () => {
  it('books one ledger row per customer WITHOUT moving physical stock', async () => {
    const { svc, created, inventory } = build({ known: { '0811': 'c-1' } });
    const r = await svc.importOpening(DEPOT, [{ customerPhone: '0811', quantity: 3, depositHeld: 60000 }], 'actor-1');
    expect(r).toMatchObject({ created: 1, failed: 0 });
    expect(created[0]).toMatchObject({
      depotId: DEPOT,
      customerId: 'c-1',
      quantity: 3,
      depositHeld: 60000,
      note: 'Saldo awal (impor)',
      actorId: 'actor-1',
    });
    expect(inventory.moveRawLine).not.toHaveBeenCalled();
  });

  it('says so when the number was new and an account had to be opened', async () => {
    const { svc } = build({ known: { '0811': 'c-1' }, fresh: true });
    const r = await svc.importOpening(DEPOT, [{ customerPhone: '0811', quantity: 1 }], 'a');
    expect(r.results[0].message).toMatch(/akun PENDING dibuat/);
    const known = await build({ known: { '0811': 'c-1' } }).svc.importOpening(DEPOT, [{ customerPhone: '0811', quantity: 1 }], 'a');
    expect(known.results[0].message).toBeUndefined();
  });

  it('a customer with an opening row is skipped, so a re-upload cannot double the balance', async () => {
    const { svc, created } = build({ known: { '0811': 'c-1' }, openedFor: ['c-1'] });
    const r = await svc.importOpening(DEPOT, [{ customerPhone: '0811', quantity: 3 }], 'a');
    expect(r.results[0]).toMatchObject({ status: 'skipped', id: 'c-1' });
    expect(created).toHaveLength(0);
  });

  it('a phone that cannot be resolved fails that row only; deposit defaults to 0', async () => {
    const { svc, created } = build({ known: { '0822': 'c-2' } });
    const r = await svc.importOpening(
      DEPOT,
      [
        { customerPhone: '0899', quantity: 1 },
        { customerPhone: '0822', quantity: 2 },
      ],
      'a',
    );
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'created']);
    expect(created[0]).toMatchObject({ depositHeld: 0 });
  });

  it('refuses to run without the resolver or the double-booking guard', async () => {
    await expect(build({ noResolver: true }).svc.importOpening(DEPOT, [], 'a')).rejects.toThrow(/belum bisa/);
    await expect(build({ noGuard: true }).svc.importOpening(DEPOT, [], 'a')).rejects.toThrow(/belum bisa/);
  });
});

describe('route and DTO', () => {
  it('the route hands rows, depot and actor to the service', async () => {
    const importOpening = jest.fn().mockResolvedValue('ok');
    const c = new GallonIssueController({ importOpening } as never, {} as never);
    const rows = [{ customerPhone: '1', quantity: 1 }] as never;
    await c.importOpening(DEPOT, { rows }, { sub: 'u1' } as never);
    expect(importOpening).toHaveBeenCalledWith(DEPOT, rows, 'u1');
  });

  it('rows are typed and numbers coerced', () => {
    const dto = plainToInstance(ImportGallonBalancesDto, { rows: [{ customerPhone: '1', quantity: '4' }] });
    expect(dto.rows[0]).toBeInstanceOf(ImportGallonBalanceRowDto);
    expect(dto.rows[0].quantity).toBe(4);
  });
});

describe('customer-service adapter and repository', () => {
  afterEach(() => jest.restoreAllMocks());
  const cfg = (url = 'http://c', key = 'k') => ({ customerServiceUrl: url, internalServiceKey: key }) as never;

  it('resolveByPhone posts the phone with the internal key and returns the id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ customerId: 'c-9', status: 'pending' })));
    const a = new CustomerContactHttpAdapter(cfg());
    await expect(a.resolveByPhone('0811', 'Budi', DEPOT)).resolves.toEqual({ customerId: 'c-9', status: 'pending' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://c/api/v1/customers/internal/resolve-by-phone');
    expect(JSON.parse(String(init.body))).toEqual({ phone: '0811', fullName: 'Budi', depotId: DEPOT });
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('answers null when unconfigured, on a bad status, or when nothing comes back', async () => {
    await expect(new CustomerContactHttpAdapter(cfg('', 'k')).resolveByPhone('1')).resolves.toBeNull();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(new CustomerContactHttpAdapter(cfg()).resolveByPhone('1')).resolves.toBeNull();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('null'));
    await expect(new CustomerContactHttpAdapter(cfg()).resolveByPhone('1')).resolves.toBeNull();
  });

  it('hasOpeningBalance looks for the marker note on that customer and depot', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'x' }).mockResolvedValueOnce(null);
    const repo = new GallonIssuePrismaRepository({ gallonIssue: { findFirst } } as never);
    await expect(repo.hasOpeningBalance(DEPOT, 'c-1')).resolves.toBe(true);
    await expect(repo.hasOpeningBalance(DEPOT, 'c-1')).resolves.toBe(false);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      depotId: DEPOT,
      customerId: 'c-1',
      note: 'Saldo awal (impor)',
    });
  });
});
