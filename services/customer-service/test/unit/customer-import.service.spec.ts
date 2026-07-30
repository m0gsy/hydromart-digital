import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { CustomerImportService } from '../../src/application/services/customer-import.service';
import { IdentityPort, PreRegisterResult } from '../../src/application/ports/identity.port';
import { ResellerExistsError } from '../../src/domain/errors';

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const DEPOT_B = '22222222-2222-4222-8222-222222222222';

const hq: AuthenticatedUser = {
  sub: 'hq-1',
  role: Role.HEAD_OFFICE,
  phone: null,
  depotId: null,
};
const operator = (depotId: string): AuthenticatedUser => ({
  sub: 'op-1',
  role: Role.KEPALA_DEPOT,
  phone: '0800',
  depotId,
});

class FakeIdentity implements IdentityPort {
  readonly calls: { phone: string; fullName?: string }[] = [];
  private seq = 0;
  constructor(private readonly result: (phone: string) => PreRegisterResult | Error = () => ({
    customerId: '',
    status: 'created',
  })) {}

  async preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult> {
    this.calls.push({ phone, fullName });
    const out = this.result(phone);
    if (out instanceof Error) throw out;
    return { ...out, customerId: out.customerId || `cust-${++this.seq}` };
  }
}

function makeProfiles(exists = false) {
  return {
    exists: jest.fn().mockResolvedValue(exists),
    create: jest.fn().mockResolvedValue(undefined),
    updateFavoriteDepot: jest.fn().mockResolvedValue(undefined),
  };
}

const CUSTOMER = { fullName: 'Siti', phone: '081200001111' };
const RESELLER = {
  fullName: 'Toko Berkah',
  phone: '081200002222',
  discountPct: 5,
  monthlyTargetQty: 100,
  joinDate: '2026-01-01',
};

describe('CustomerImportService.importCustomers', () => {
  it('pre-registers each phone and points the profile at the importing depot', async () => {
    const identity = new FakeIdentity();
    const profiles = makeProfiles();
    const addresses = { create: jest.fn() };
    const svc = new CustomerImportService(
      identity,
      profiles as never,
      addresses as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [CUSTOMER]);

    expect(summary).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    expect(identity.calls).toEqual([{ phone: '081200001111', fullName: 'Siti' }]);
    expect(profiles.create).toHaveBeenCalledWith('cust-1');
    expect(profiles.updateFavoriteDepot).toHaveBeenCalledWith('cust-1', DEPOT_A);
    expect(addresses.create).not.toHaveBeenCalled();
  });

  it('writes the optional address with the landmark as the courier note', async () => {
    const addresses = { create: jest.fn() };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles(true) as never,
      addresses as never,
      {} as never,
    );

    await svc.importCustomers(hq, DEPOT_A, [
      {
        ...CUSTOMER,
        addressLine: 'Jl. Melati 3',
        city: 'Bekasi',
        province: 'Jawa Barat',
        landmark: 'pagar hijau',
      },
    ]);

    expect(addresses.create).toHaveBeenCalledWith('cust-1', {
      label: 'Rumah',
      recipientName: 'Siti',
      phone: '081200001111',
      addressLine: 'Jl. Melati 3',
      city: 'Bekasi',
      province: 'Jawa Barat',
      notes: 'pagar hijau',
    });
  });

  it('fails a row that gives an address without a city or province', async () => {
    const addresses = { create: jest.fn() };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      addresses as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [
      { ...CUSTOMER, addressLine: 'Jl. Melati 3' },
    ]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(summary.results[0]?.message).toContain('provinsi');
    expect(addresses.create).not.toHaveBeenCalled();
  });

  it("leaves an already-active account's home depot and address book alone", async () => {
    const profiles = makeProfiles(true);
    const addresses = { create: jest.fn() };
    const svc = new CustomerImportService(
      new FakeIdentity(() => ({ customerId: 'cust-existing', status: 'active' })),
      profiles as never,
      addresses as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [
      { ...CUSTOMER, addressLine: 'Jl. Melati 3', city: 'Bekasi', province: 'Jawa Barat' },
    ]);

    expect(summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(profiles.updateFavoriteDepot).not.toHaveBeenCalled();
    expect(addresses.create).not.toHaveBeenCalled();
  });

  it('fails the row when auth-service is unreachable, writing no CRM data', async () => {
    const profiles = makeProfiles();
    const svc = new CustomerImportService(
      new FakeIdentity(() => new ServiceUnavailableException('auth-service menolak nomor ini (503)')),
      profiles as never,
      { create: jest.fn() } as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [CUSTOMER]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(profiles.updateFavoriteDepot).not.toHaveBeenCalled();
  });

  it('refuses to import into a depot the operator is not assigned to', async () => {
    const identity = new FakeIdentity();
    const svc = new CustomerImportService(
      identity,
      makeProfiles() as never,
      { create: jest.fn() } as never,
      {} as never,
    );

    await expect(svc.importCustomers(operator(DEPOT_B), DEPOT_A, [CUSTOMER])).rejects.toThrow(
      ForbiddenException,
    );
    expect(identity.calls).toHaveLength(0);
  });
});

describe('CustomerImportService.importResellers', () => {
  it('resolves the phone to an identity, then registers the reseller at that depot', async () => {
    const identity = new FakeIdentity();
    const resellers = { register: jest.fn().mockResolvedValue({ customerId: 'cust-1' }) };
    const svc = new CustomerImportService(
      identity,
      makeProfiles() as never,
      {} as never,
      resellers as never,
    );

    const summary = await svc.importResellers(hq, DEPOT_A, [{ ...RESELLER, note: 'agen lama' }]);

    expect(summary).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    expect(identity.calls).toEqual([{ phone: '081200002222', fullName: 'Toko Berkah' }]);
    expect(resellers.register).toHaveBeenCalledWith(hq, {
      customerId: 'cust-1',
      homeDepotId: DEPOT_A,
      monthlyTargetQty: 100,
      discountPct: 5,
      joinDate: new Date('2026-01-01'),
      note: 'agen lama',
    });
  });

  it('skips a phone already on the reseller registry', async () => {
    const resellers = {
      register: jest.fn().mockRejectedValue(new ResellerExistsError()),
    };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      {} as never,
      resellers as never,
    );

    await expect(svc.importResellers(hq, DEPOT_A, [RESELLER])).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it('refuses a depot the caller cannot touch', async () => {
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      {} as never,
      { register: jest.fn() } as never,
    );

    await expect(svc.importResellers(operator(DEPOT_B), DEPOT_A, [RESELLER])).rejects.toThrow(
      ForbiddenException,
    );
  });
});
