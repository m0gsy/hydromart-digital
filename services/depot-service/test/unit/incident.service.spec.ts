import { IncidentService } from '../../src/application/services/incident.service';
import {
  CreateIncidentData,
  IncidentRepository,
  UpdateIncidentData,
} from '../../src/application/ports/incident.repository';
import {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '../../src/domain/incident';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError, IncidentNotFoundError } from '../../src/domain/errors';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemoryIncidentRepository implements IncidentRepository {
  private rows: Incident[] = [];
  private seq = 0;

  async create(data: CreateIncidentData): Promise<Incident> {
    const now = new Date();
    const row: Incident = {
      id: `inc${++this.seq}`,
      status: IncidentStatus.OPEN,
      resolutionNote: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, status?: IncidentStatus): Promise<Incident[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (status === undefined || r.status === status))
      .reverse();
  }
  async findById(id: string): Promise<Incident | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, data: UpdateIncidentData): Promise<Incident> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
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

describe('IncidentService', () => {
  let depots: InMemoryDepotRepository;
  let incidents: InMemoryIncidentRepository;
  let service: IncidentService;
  let depotId: string;

  const record = () =>
    service.record(
      { depotId, type: IncidentType.VEHICLE_BREAKDOWN, severity: IncidentSeverity.HIGH, title: 'Motor mogok' },
      'staff-1',
    );

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    incidents = new InMemoryIncidentRepository();
    service = new IncidentService(incidents, depots);
    depotId = (await depots.create(DEPOT)).id;
  });

  it('rejects recording against an unknown depot', async () => {
    await expect(
      service.record(
        { depotId: UNKNOWN, type: IncidentType.OTHER, severity: IncidentSeverity.LOW, title: 'x' },
        'staff-1',
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('records an OPEN incident defaulting the optional fields to null', async () => {
    const inc = await record();
    expect(inc.status).toBe(IncidentStatus.OPEN);
    expect(inc.reportedBy).toBe('staff-1');
    expect(inc.description).toBeNull();
    expect(inc.courierName).toBeNull();
  });

  it('lists a depot incidents and filters by status', async () => {
    const a = await record();
    await record();
    await service.resolve(a.id, 'towed', 'mgr-1');
    expect(await service.list(depotId)).toHaveLength(2);
    expect(await service.list(depotId, { status: IncidentStatus.RESOLVED })).toHaveLength(1);
  });

  it('list rejects an unknown depot', async () => {
    await expect(service.list(UNKNOWN)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('get throws for a missing incident', async () => {
    await expect(service.get('nope')).rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it('resolve stamps the resolution fields', async () => {
    const inc = await record();
    const resolved = await service.resolve(inc.id, 'sudah ditarik', 'mgr-1');
    expect(resolved.status).toBe(IncidentStatus.RESOLVED);
    expect(resolved.resolutionNote).toBe('sudah ditarik');
    expect(resolved.resolvedBy).toBe('mgr-1');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it('resolve throws for a missing incident', async () => {
    await expect(service.resolve('nope', 'x', 'mgr-1')).rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it('updateStatus to IN_PROGRESS keeps resolution fields cleared', async () => {
    const inc = await record();
    const moved = await service.updateStatus(inc.id, IncidentStatus.IN_PROGRESS);
    expect(moved.status).toBe(IncidentStatus.IN_PROGRESS);
    expect(moved.resolvedBy).toBeNull();
    expect(moved.resolutionNote).toBeNull();
  });

  it('updateStatus back from RESOLVED drops the resolution note/resolver', async () => {
    const inc = await record();
    await service.resolve(inc.id, 'done', 'mgr-1');
    const reopened = await service.updateStatus(inc.id, IncidentStatus.IN_PROGRESS);
    expect(reopened.resolutionNote).toBeNull();
    expect(reopened.resolvedBy).toBeNull();
    expect(reopened.resolvedAt).toBeNull();
  });
});
