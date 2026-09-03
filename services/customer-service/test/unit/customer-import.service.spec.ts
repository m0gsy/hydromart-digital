import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { CustomerImportService } from '../../src/application/services/customer-import.service';
import {
  CustomerIdentity,
  IdentityPort,
  PreRegisterResult,
} from '../../src/application/ports/identity.port';
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
  constructor(
    private readonly result: (phone: string) => PreRegisterResult | Error = () => ({
      customerId: '',
      status: 'created',
    }),
  ) {}

  async preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult> {
    this.calls.push({ phone, fullName });
    const out = this.result(phone);
    if (out instanceof Error) throw out;
    return { ...out, customerId: out.customerId || `cust-${++this.seq}` };
  }

  // Import never reads names back; present only to satisfy the port.
  async getCustomerNames(): Promise<Map<string, CustomerIdentity>> {
    return new Map();
  }
}

function makeProfiles(exists = false) {
  return {
    exists: jest.fn().mockResolvedValue(exists),
    create: jest.fn().mockResolvedValue(undefined),
    updateFavoriteDepot: jest.fn().mockResolvedValue(undefined),
    // Audit S-16: create-or-point in one statement, replacing exists + create + update.
    upsertFavoriteDepot: jest.fn().mockResolvedValue(undefined),
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

// §I: the counter buyer, resolved server-side. This used to live in the POS page's
// browser, so any other client posting /orders/walk-in created nobody.
describe('CustomerImportService.resolveByPhone', () => {
  const build = (status: 'created' | 'pending' | 'active') => {
    const identity = new FakeIdentity(() => ({ customerId: 'cust-9', status }));
    const profiles = makeProfiles();
    return {
      identity,
      profiles,
      svc: new CustomerImportService(identity, profiles as never, {} as never, {} as never),
    };
  };

  it('pre-registers the phone and points the new account at the selling depot', async () => {
    const { identity, profiles, svc } = build('created');

    await expect(svc.resolveByPhone('0811', 'Budi', DEPOT_A)).resolves.toEqual({
      customerId: 'cust-9',
      status: 'created',
    });
    expect(identity.calls).toEqual([{ phone: '0811', fullName: 'Budi' }]);
    expect(profiles.upsertFavoriteDepot).toHaveBeenCalledWith('cust-9', DEPOT_A);
  });

  // An account somebody already claimed belongs to that person: the depot that happens to
  // sell them water today must not repoint their home depot.
  it('leaves an already-active account depot alone', async () => {
    const { profiles, svc } = build('active');

    await expect(svc.resolveByPhone('0811', 'Budi', DEPOT_A)).resolves.toMatchObject({
      status: 'active',
    });
    expect(profiles.upsertFavoriteDepot).not.toHaveBeenCalled();
  });

  it('resolves an identity without claiming a depot when none is given', async () => {
    const { profiles, svc } = build('pending');

    await expect(svc.resolveByPhone('0811', 'Budi')).resolves.toMatchObject({
      customerId: 'cust-9',
    });
    expect(profiles.upsertFavoriteDepot).not.toHaveBeenCalled();
  });
});

describe('CustomerImportService.importCustomers', () => {
  it('pre-registers each phone and points the profile at the importing depot', async () => {
    const identity = new FakeIdentity();
    const profiles = makeProfiles();
    const addresses = { create: jest.fn(), list: jest.fn().mockResolvedValue([]) };
    const svc = new CustomerImportService(
      identity,
      profiles as never,
      addresses as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [CUSTOMER]);

    expect(summary).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    expect(identity.calls).toEqual([{ phone: '081200001111', fullName: 'Siti' }]);
    // Audit S-16 and its Q-17 baseline row: rows are imported one at a time so each can
    // report its own error, which makes every round-trip per row a round-trip per row of
    // the file. This one used to be three.
    expect(profiles.upsertFavoriteDepot).toHaveBeenCalledWith('cust-1', DEPOT_A);
    expect(profiles.exists).not.toHaveBeenCalled();
    expect(profiles.create).not.toHaveBeenCalled();
    expect(addresses.create).not.toHaveBeenCalled();
  });

  it('writes the optional address with the landmark as the courier note', async () => {
    const addresses = { create: jest.fn(), list: jest.fn().mockResolvedValue([]) };
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

  /*
   * CA-2-65: re-running an import added the address again, every time.
   *
   * Imports ARE re-run — a corrected column, a failed row somebody fixed, a file sent
   * twice — and the customer row itself is already guarded ("Nomor sudah punya akun
   * aktif"). The address was not, so the second run left the customer with two identical
   * "Rumah" entries and the checkout picker asking them to choose between them. By the
   * fourth run there were four.
   */
  it('does not add the address again when the customer already has it', async () => {
    const addresses = {
      create: jest.fn(),
      list: jest.fn().mockResolvedValue([
        // Same address, typed differently: extra spaces and a different case are how a
        // second export of the same data actually differs from the first.
        { addressLine: '  Jl.  Melati 3 ', city: 'BEKASI' },
      ]),
    };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles(true) as never,
      addresses as never,
      {} as never,
    );

    await svc.importCustomers(hq, DEPOT_A, [
      { ...CUSTOMER, addressLine: 'Jl. Melati 3', city: 'Bekasi' },
    ]);

    expect(addresses.create).not.toHaveBeenCalled();
  });

  it('still adds a genuinely different address for the same customer', async () => {
    const addresses = {
      create: jest.fn(),
      list: jest.fn().mockResolvedValue([{ addressLine: 'Jl. Melati 3', city: 'Bekasi' }]),
    };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles(true) as never,
      addresses as never,
      {} as never,
    );

    await svc.importCustomers(hq, DEPOT_A, [
      { ...CUSTOMER, addressLine: 'Jl. Anggrek 9', city: 'Bekasi' },
    ]);

    expect(addresses.create).toHaveBeenCalledTimes(1);
  });

  it('fails a row that gives an address without a city', async () => {
    const addresses = { create: jest.fn(), list: jest.fn().mockResolvedValue([]) };
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
    expect(summary.results[0]?.message).toContain('kota');
    expect(addresses.create).not.toHaveBeenCalled();
  });

  /*
   * Province stopped being required when the delivery-address form stopped asking for it.
   * An importer that still demanded one refused spreadsheets the app itself would never have
   * produced — the rule enforced in one place and abandoned in the other.
   */
  it('imports an address with a city and no province', async () => {
    const addresses = { create: jest.fn(), list: jest.fn().mockResolvedValue([]) };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      addresses as never,
      {} as never,
    );

    const summary = await svc.importCustomers(hq, DEPOT_A, [
      { ...CUSTOMER, addressLine: 'Jl. Melati 3', city: 'Bekasi' },
    ]);

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(addresses.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ city: 'Bekasi', province: undefined }),
    );
  });

  it("leaves an already-active account's home depot and address book alone", async () => {
    const profiles = makeProfiles(true);
    const addresses = { create: jest.fn(), list: jest.fn().mockResolvedValue([]) };
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
      new FakeIdentity(
        () => new ServiceUnavailableException('auth-service menolak nomor ini (503)'),
      ),
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

  /*
   * J11 · a correction re-import used to do nothing at all.
   *
   * An existing reseller made `register` throw ResellerExistsError, and that error was the
   * skip predicate — so the row was counted "skipped" and the sheet's numbers were thrown
   * away. Bulk import is how a depot onboards its agen; the second file anybody sends is a
   * correction, and this is a money path: `discountPct` and `flatGallonPriceIdr` are what
   * the agen is charged at the till.
   *
   * Existing rows are UPDATED now, and reported as `updated` — a status the summary has
   * always carried and this importer never produced.
   */
  it('updates an agen already on the registry instead of throwing the sheet away', async () => {
    const resellers = {
      register: jest.fn().mockRejectedValue(new ResellerExistsError()),
      update: jest.fn().mockResolvedValue({ customerId: 'cust-1' }),
    };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      {} as never,
      resellers as never,
    );

    const summary = await svc.importResellers(hq, DEPOT_A, [
      { ...RESELLER, discountPct: 9, monthlyTargetQty: 250, flatGallonPriceIdr: 17000 },
    ]);

    expect(summary).toMatchObject({ created: 0, updated: 1, skipped: 0, failed: 0 });
    expect(resellers.update).toHaveBeenCalledWith(hq, 'cust-1', {
      homeDepotId: DEPOT_A,
      monthlyTargetQty: 250,
      discountPct: 9,
      flatGallonPriceIdr: 17000,
      note: undefined,
    });
  });

  /*
   * The SOP flat price is the whole reason an agen sheet exists, and it was the one field
   * the importer could not set — a depot could bulk-load a hundred agen and then have to
   * open a hundred forms to price them.
   */
  it('sets the SOP flat gallon price on a new agen', async () => {
    const resellers = { register: jest.fn().mockResolvedValue({ customerId: 'cust-1' }) };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      {} as never,
      resellers as never,
    );

    await svc.importResellers(hq, DEPOT_A, [{ ...RESELLER, flatGallonPriceIdr: 16500 }]);

    expect(resellers.register).toHaveBeenCalledWith(
      hq,
      expect.objectContaining({ flatGallonPriceIdr: 16500 }),
    );
  });

  it('still fails the row when the update itself fails', async () => {
    const resellers = {
      register: jest.fn().mockRejectedValue(new ResellerExistsError()),
      update: jest.fn().mockRejectedValue(new Error('depot pindah ditolak')),
    };
    const svc = new CustomerImportService(
      new FakeIdentity(),
      makeProfiles() as never,
      {} as never,
      resellers as never,
    );

    // Not "skipped": the sheet asked for a change and the change did not happen.
    await expect(svc.importResellers(hq, DEPOT_A, [RESELLER])).resolves.toMatchObject({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
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
