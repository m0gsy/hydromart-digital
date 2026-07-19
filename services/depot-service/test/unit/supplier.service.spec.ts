import { SupplierService } from '../../src/application/services/supplier.service';
import {
  CreateSupplierData,
  SupplierRepository,
} from '../../src/application/ports/supplier.repository';
import { Supplier } from '../../src/domain/supplier';
import { OwnershipType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateSupplierCodeError,
  SupplierNotFoundError,
} from '../../src/domain/errors';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemorySupplierRepository implements SupplierRepository {
  private rows: Supplier[] = [];
  private seq = 0;

  async create(data: CreateSupplierData): Promise<Supplier> {
    const row: Supplier = { id: `sup${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
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
    expect(s).toMatchObject({ name: 'PT Air Baku', code: 'AB01', contactPhone: null, onTimeRate: null });
    expect(s.categories).toEqual([]);
  });

  it('rejects a supplier on an unknown depot', async () => {
    await expect(service.create({ depotId: UNKNOWN, name: 'x', code: 'X1' })).rejects.toBeInstanceOf(
      DepotNotFoundError,
    );
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
    await expect(service.create({ depotId: other, name: 'Other', code: 'DUP' })).resolves.toMatchObject({
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
