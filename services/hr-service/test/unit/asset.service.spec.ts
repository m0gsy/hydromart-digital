import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { AssetMovement, AssetStatus, EmployeeAsset, Prisma } from '../../prisma/generated/client';
import {
  AssetListFilter,
  AssetMovementWrite,
  AssetRepository,
  AssetWrite,
} from '../../src/application/ports/asset.repository';
import { AssetService } from '../../src/application/services/asset.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

class FakeRepo implements AssetRepository {
  rows: EmployeeAsset[] = [];
  movements: AssetMovement[] = [];
  lastFilter?: AssetListFilter;
  private seq = 0;

  async create(data: AssetWrite): Promise<EmployeeAsset> {
    if (this.rows.some((r) => r.code === data.code)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    const row = {
      id: `as-${++this.seq}`,
      status: 'AVAILABLE' as AssetStatus,
      holderId: null,
      ...data,
    } as unknown as EmployeeAsset;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<AssetWrite>): Promise<EmployeeAsset> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string): Promise<EmployeeAsset | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(filter: AssetListFilter): Promise<{ rows: EmployeeAsset[]; total: number }> {
    this.lastFilter = filter;
    return { rows: this.rows, total: this.rows.length };
  }
  async move(
    movement: AssetMovementWrite,
    next: { status: AssetStatus; holderId: string | null },
  ): Promise<EmployeeAsset> {
    this.movements.push({ id: `mv-${this.movements.length + 1}`, ...movement } as AssetMovement);
    const row = this.rows.find((r) => r.id === movement.assetId)!;
    row.status = next.status;
    row.holderId = next.holderId;
    return row;
  }
  async listMovements(assetId: string): Promise<AssetMovement[]> {
    return this.movements.filter((m) => m.assetId === assetId);
  }
}

/** EmployeeService stand-in: getById is the 404 + depot gate every recipient goes through. */
function fakeEmployees(depotId = 'd1'): EmployeeService {
  return {
    getById: jest.fn(async (_u: AuthenticatedUser, id: string) => {
      if (id === 'ghost') throw new NotFoundException('Karyawan tidak ditemukan');
      return { id, depotId };
    }),
  } as unknown as EmployeeService;
}

function make(employeeDepot = 'd1') {
  const repo = new FakeRepo();
  const employees = fakeEmployees(employeeDepot);
  return { repo, employees, svc: new AssetService(repo, employees) };
}

const NEW_ASSET = {
  code: 'mtr-0001',
  type: 'MOTORCYCLE' as const,
  name: 'Honda Beat',
  depotId: 'd1',
};

describe('AssetService (B3)', () => {
  it('registers an asset upper-cased, available and held by nobody', async () => {
    const { svc, repo } = make();
    const asset = await svc.create(hr, { ...NEW_ASSET, value: 15_000_000, brand: 'Honda' });
    expect(asset.code).toBe('MTR-0001');
    expect(asset.status).toBe('AVAILABLE');
    expect(asset.holderId).toBeNull();
    expect(Number(repo.rows[0].value)).toBe(15_000_000);
    expect(repo.rows[0].serialNo).toBeNull();
  });

  it('reports a duplicate asset tag as a conflict, not a 500', async () => {
    const { svc } = make();
    await svc.create(hr, NEW_ASSET);
    await expect(svc.create(hr, NEW_ASSET)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets any other create error through untouched', async () => {
    const { svc, repo } = make();
    repo.create = async () => {
      throw new Error('db down');
    };
    await expect(svc.create(hr, NEW_ASSET)).rejects.toThrow('db down');
  });

  it('walks assign -> transfer -> return and keeps the whole history', async () => {
    const { svc, repo } = make();
    const asset = await svc.create(hr, NEW_ASSET);

    let moved = await svc.move(hr, asset.id, { kind: 'ASSIGN', toEmployeeId: 'e1' });
    expect(moved.status).toBe('ASSIGNED');
    expect(moved.holderId).toBe('e1');

    moved = await svc.move(hr, asset.id, { kind: 'TRANSFER', toEmployeeId: 'e2' });
    expect(moved.holderId).toBe('e2');

    moved = await svc.move(hr, asset.id, { kind: 'RETURN', condition: 'lecet di spakbor' });
    expect(moved.status).toBe('RETURNED');
    expect(moved.holderId).toBeNull();

    const history = await repo.listMovements(asset.id);
    expect(history.map((m) => m.kind)).toEqual(['ASSIGN', 'TRANSFER', 'RETURN']);
    // The hand-over log remembers who it left, not just who received it.
    expect(history[1]).toMatchObject({ fromEmployeeId: 'e1', toEmployeeId: 'e2' });
    expect(history[2]).toMatchObject({ fromEmployeeId: 'e2', condition: 'lecet di spakbor' });
    expect(history[0].createdBy).toBe('hr-1');
  });

  it('refuses an illegal transition and appends nothing', async () => {
    const { svc, repo } = make();
    const asset = await svc.create(hr, NEW_ASSET);
    await svc.move(hr, asset.id, { kind: 'ASSIGN', toEmployeeId: 'e1' });
    await expect(
      svc.move(hr, asset.id, { kind: 'ASSIGN', toEmployeeId: 'e2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.movements).toHaveLength(1);
    expect(repo.rows[0].holderId).toBe('e1');
  });

  it('will not hand a depot’s asset to another depot’s staff', async () => {
    const { svc, repo } = make('d2');
    const asset = await svc.create(hr, NEW_ASSET);
    await expect(
      svc.move(hr, asset.id, { kind: 'ASSIGN', toEmployeeId: 'e1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.movements).toHaveLength(0);
  });

  it('404s on an unknown asset for read, edit and move alike', async () => {
    const { svc } = make();
    await expect(svc.getById(hr, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(hr, 'nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.move(hr, 'nope', { kind: 'RETURN' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('edits description without touching status or holder', async () => {
    const { svc, repo } = make();
    const asset = await svc.create(hr, NEW_ASSET);
    await svc.move(hr, asset.id, { kind: 'ASSIGN', toEmployeeId: 'e1' });
    const edited = await svc.update(hr, asset.id, {
      name: 'Honda Beat 2024',
      brand: 'Honda',
      serialNo: 'SN-9',
      value: 12_000_000,
      note: 'plat B',
    });
    expect(edited).toMatchObject({ name: 'Honda Beat 2024', status: 'ASSIGNED', holderId: 'e1' });
    expect(Number(edited.value)).toBe(12_000_000);
    // An empty patch is a no-op, not a wipe.
    expect(await svc.update(hr, asset.id, {})).toMatchObject({ name: 'Honda Beat 2024' });
    expect(repo.movements).toHaveLength(1);
  });

  it('returns an asset together with its movements', async () => {
    const { svc } = make();
    const asset = await svc.create(hr, NEW_ASSET);
    await svc.move(hr, asset.id, { kind: 'MAINTENANCE', note: 'servis rutin' });
    const detail = await svc.getById(hr, asset.id);
    expect(detail.status).toBe('MAINTENANCE');
    expect(detail.movements).toHaveLength(1);
    expect(detail.movements[0].note).toBe('servis rutin');
  });

  it('pages the list and passes every filter through', async () => {
    const { svc, repo } = make();
    await svc.list(hr, {
      depotId: 'd1',
      status: 'ASSIGNED',
      type: 'LAPTOP',
      holderId: 'e1',
      page: 3,
      pageSize: 5,
    });
    expect(repo.lastFilter).toEqual({
      depotId: 'd1',
      status: 'ASSIGNED',
      type: 'LAPTOP',
      holderId: 'e1',
      skip: 10,
      take: 5,
    });
    await svc.list(hr);
    expect(repo.lastFilter).toMatchObject({ skip: 0, take: 20, depotId: undefined });
  });
});
