import { plainToInstance } from 'class-transformer';

import { CustomerImportService } from '../../src/application/services/customer-import.service';
import { DepotCrmController } from '../../src/modules/depot-crm.controller';
import { ImportAddressRowDto, ImportAddressesDto } from '../../src/modules/dto/customer-import.dto';

const DEPOT = '11111111-1111-1111-1111-111111111111';
const user = { sub: 'staff-1', role: 'KEPALA_DEPOT', depotIds: [DEPOT] } as never;

function build(opts: { status?: 'active' | 'pending'; existing?: { addressLine: string; city: string }[]; failCreate?: Error } = {}) {
  const create = jest.fn(async (_c: string, a: Record<string, unknown>) => {
    if (opts.failCreate) throw opts.failCreate;
    return { id: 'addr-1', ...a };
  });
  const addresses = { list: jest.fn(async () => opts.existing ?? []), create };
  const identity = {
    preRegisterCustomer: jest.fn(async () => ({ customerId: 'c-1', status: opts.status ?? 'pending' })),
  };
  const svc = new CustomerImportService(identity as never, {} as never, addresses as never, {} as never);
  return { svc, create, identity };
}
const row = { phone: '0811', recipientName: 'Siti', addressLine: 'Jl. Melati 3', city: 'Bekasi' };

describe('CustomerImportService.importAddresses', () => {
  it('adds the address with the label, defaulting to Rumah', async () => {
    const { svc, create } = build();
    const r = await svc.importAddresses(user, DEPOT, [
      { ...row, label: 'Kios', landmark: 'pagar hijau' },
      { ...row, addressLine: 'Jl. Mawar 9' },
    ]);
    expect(r).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    expect(create.mock.calls[0][1]).toMatchObject({ label: 'Kios', notes: 'pagar hijau', recipientName: 'Siti' });
    expect(create.mock.calls[1][1]).toMatchObject({ label: 'Rumah' });
  });

  it('leaves an active account alone', async () => {
    const { svc, create } = build({ status: 'active' });
    const r = await svc.importAddresses(user, DEPOT, [row]);
    expect(r.results[0]).toMatchObject({ status: 'skipped', id: 'c-1' });
    expect(create).not.toHaveBeenCalled();
  });

  it('skips an address already in the book, whatever the casing and spacing', async () => {
    const { svc, create } = build({ existing: [{ addressLine: '  jl.  MELATI 3 ', city: 'bekasi' }] });
    const r = await svc.importAddresses(user, DEPOT, [row]);
    expect(r.results[0]).toMatchObject({ status: 'skipped', message: 'Alamat ini sudah ada' });
    expect(create).not.toHaveBeenCalled();
  });

  it('a refused row (address cap) fails alone', async () => {
    const { svc } = build({ failCreate: new Error('Batas alamat tercapai') });
    const r = await svc.importAddresses(user, DEPOT, [row]);
    expect(r.results[0]).toMatchObject({ status: 'failed', message: 'Batas alamat tercapai' });
  });

  it('refuses a depot the importer may not touch', async () => {
    const { svc } = build();
    await expect(
      svc.importAddresses(user, '22222222-2222-2222-2222-222222222222', [row]),
    ).rejects.toBeDefined();
  });
});

describe('route and DTO', () => {
  it('hands depot and rows to the service', async () => {
    const importAddresses = jest.fn().mockResolvedValue('ok');
    const c = new DepotCrmController({} as never, { importAddresses } as never);
    const rows = [row] as never;
    await c.importAddresses({ depotId: DEPOT, rows }, user);
    expect(importAddresses).toHaveBeenCalledWith(user, DEPOT, rows);
  });

  it('types the rows', () => {
    const dto = plainToInstance(ImportAddressesDto, { depotId: DEPOT, rows: [row] });
    expect(dto.rows[0]).toBeInstanceOf(ImportAddressRowDto);
  });
});
