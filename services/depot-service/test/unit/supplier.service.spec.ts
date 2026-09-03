import { SupplierService } from '../../src/application/services/supplier.service';
import {
  CreateSupplierData,
  SupplierRepository,
  UpdateSupplierData,
} from '../../src/application/ports/supplier.repository';
import { Supplier } from '../../src/domain/supplier';
import { OwnershipType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateSupplierCodeError,
  SupplierInUseError,
  SupplierNotFoundError,
} from '../../src/domain/errors';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemorySupplierRepository implements SupplierRepository {
  rows: Supplier[] = [];
  private seq = 0;

  async create(data: CreateSupplierData): Promise<Supplier> {
    const row: Supplier = { id: `sup${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: UpdateSupplierData): Promise<Supplier> {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, data);
    return { ...r };
  }
  async remove(id: string): Promise<void> {
    this.rows = this.rows.filter((x) => x.id !== id);
  }
  /** Set by the test that needs it; a directory with no orders is the ordinary case. */
  purchaseOrderCount = 0;
  async countPurchaseOrders(): Promise<number> {
    return this.purchaseOrderCount;
  }
  async listForDepot(depotId: string): Promise<Supplier[]> {
    return this.rows.filter((r) => r.depotId === depotId).reverse();
  }
  async findById(id: string): Promise<Supplier | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByCode(depotId: string, code: string): Promise<Supplier | null> {
    return this.rows.find((r) => r.depotId === depotId && r.code === code) ?? null;
  }
}

const DEPOT = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: OwnershipType.HKP,
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.19,
  lng: 106.84,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
};

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('SupplierService', () => {
  let depots: InMemoryDepotRepository;
  let suppliers: InMemorySupplierRepository;
  let service: SupplierService;
  let depotId: string;

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    suppliers = new InMemorySupplierRepository();
    service = new SupplierService(suppliers, depots);
    depotId = (await depots.create(DEPOT)).id;
  });

  it('creates a supplier defaulting the optional fields', async () => {
    const s = await service.create({ depotId, name: 'PT Air Baku', code: 'AB01' });
    expect(s).toMatchObject({
      name: 'PT Air Baku',
      code: 'AB01',
      contactPhone: null,
      onTimeRate: null,
    });
    expect(s.categories).toEqual([]);
  });

  it('rejects a supplier on an unknown depot', async () => {
    await expect(
      service.create({ depotId: UNKNOWN, name: 'x', code: 'X1' }),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects a duplicate code within the same depot', async () => {
    await service.create({ depotId, name: 'First', code: 'DUP' });
    await expect(service.create({ depotId, name: 'Second', code: 'DUP' })).rejects.toBeInstanceOf(
      DuplicateSupplierCodeError,
    );
  });

  it('allows the same code in a different depot', async () => {
    const other = (await depots.create({ ...DEPOT, code: 'JKT-02' })).id;
    await service.create({ depotId, name: 'First', code: 'DUP' });
    await expect(
      service.create({ depotId: other, name: 'Other', code: 'DUP' }),
    ).resolves.toMatchObject({
      code: 'DUP',
    });
  });

  it('lists a depot suppliers newest first', async () => {
    await service.create({ depotId, name: 'A', code: 'A1' });
    await service.create({ depotId, name: 'B', code: 'B1' });
    expect((await service.list(depotId)).map((s) => s.code)).toEqual(['B1', 'A1']);
  });

  it('get throws for a missing supplier', async () => {
    await expect(service.get('nope')).rejects.toBeInstanceOf(SupplierNotFoundError);
  });

  it('get returns a created supplier', async () => {
    const created = await service.create({ depotId, name: 'A', code: 'A1' });
    expect(await service.get(created.id)).toMatchObject({ id: created.id, code: 'A1' });
  });
});

/*
 * CA-2-64: the directory was create-and-forget.
 *
 * Create, list, get — that was the whole of it. A phone number typed wrong, a name spelled
 * wrong, a vendor that changed hands: all permanent, and the only workaround was a second
 * row for the same supplier, which then split its purchase history in two.
 */
describe('SupplierService correcting and removing (CA-2-64)', () => {
  async function make() {
    const depots = new InMemoryDepotRepository();
    const repo = new InMemorySupplierRepository();
    return {
      repo,
      service: new SupplierService(repo, depots),
      depotId: (await depots.create(DEPOT)).id,
    };
  }

  it('corrects the fields a depot got wrong, and leaves the rest alone', async () => {
    const { service, repo, depotId } = await make();
    const created = await service.create({ depotId, name: 'Tirta Makmur', code: 'SUP-01' });

    const updated = await service.update(created.id, {
      name: 'Tirta Makmur Sejahtera',
      contactPhone: '081234567890',
    });

    expect(updated.name).toBe('Tirta Makmur Sejahtera');
    expect(updated.contactPhone).toBe('081234567890');
    expect(updated.code).toBe('SUP-01');
    expect(repo.rows[0].depotId).toBe(depotId);
  });

  it('refuses a code another supplier at the depot already holds', async () => {
    const { service, depotId } = await make();
    await service.create({ depotId, name: 'A', code: 'SUP-01' });
    const b = await service.create({ depotId, name: 'B', code: 'SUP-02' });

    await expect(service.update(b.id, { code: 'SUP-01' })).rejects.toBeInstanceOf(
      DuplicateSupplierCodeError,
    );
    // Its own code is not a clash with itself.
    await expect(service.update(b.id, { code: 'SUP-02' })).resolves.toMatchObject({
      code: 'SUP-02',
    });
  });

  it('deletes a supplier no purchase order names', async () => {
    const { service, repo, depotId } = await make();
    const created = await service.create({ depotId, name: 'A', code: 'SUP-01' });

    await service.remove(created.id);

    expect(repo.rows).toHaveLength(0);
  });

  /*
   * A PO snapshots `supplierName`, so its own history reads fine either way — but its
   * `supplierId` would dangle, and creating a PO refuses a missing supplier. A vendor with
   * orders against it is corrected, never deleted.
   */
  it('refuses to delete one a purchase order still names', async () => {
    const { service, repo, depotId } = await make();
    const created = await service.create({ depotId, name: 'A', code: 'SUP-01' });
    repo.purchaseOrderCount = 3;

    await expect(service.remove(created.id)).rejects.toBeInstanceOf(SupplierInUseError);
    expect(repo.rows).toHaveLength(1);
  });

  it('refuses to correct or delete one that does not exist', async () => {
    const { service } = await make();
    await expect(service.update('nope', { name: 'x' })).rejects.toBeInstanceOf(
      SupplierNotFoundError,
    );
    await expect(service.remove('nope')).rejects.toBeInstanceOf(SupplierNotFoundError);
  });
});
