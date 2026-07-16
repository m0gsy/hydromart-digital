import { IncidentSeverity, IncidentStatus } from '../../src/domain/incident';
import { IncidentNotFoundError } from '../../src/domain/errors';
import { IncidentService } from '../../src/application/services/incident.service';
import { InMemoryIncidentRepository, makeIncident } from '../support/fakes';

describe('IncidentService', () => {
  let repo: InMemoryIncidentRepository;
  let service: IncidentService;

  beforeEach(() => {
    repo = new InMemoryIncidentRepository();
    service = new IncidentService(repo);
  });

  it('creates an ONGOING incident', async () => {
    const i = await service.create({
      title: 'Latency',
      severity: IncidentSeverity.CRITICAL,
      affectedService: 'payment-service',
    });
    expect(i.status).toBe(IncidentStatus.ONGOING);
    expect(i.resolvedAt).toBeNull();
  });

  it('lists newest-first and filters by status', async () => {
    repo.rows = [
      makeIncident({ title: 'A', startedAt: new Date(1000), status: IncidentStatus.ONGOING }),
      makeIncident({ title: 'B', startedAt: new Date(3000), status: IncidentStatus.RESOLVED }),
      makeIncident({ title: 'C', startedAt: new Date(2000), status: IncidentStatus.ONGOING }),
    ];
    const all = await service.list({});
    expect(all.map((i) => i.title)).toEqual(['B', 'C', 'A']); // newest first
    expect(await service.list({ status: IncidentStatus.ONGOING })).toHaveLength(2);
  });

  it('patch appends a timeline update and resolves', async () => {
    const i = await service.create({
      title: 'Latency',
      severity: IncidentSeverity.WARNING,
      affectedService: 'order-service',
    });
    const noted = await service.patch(i.id, { note: 'Mitigation applied.' });
    expect(noted.updates).toHaveLength(1);
    expect(noted.updates[0].note).toBe('Mitigation applied.');
    const resolved = await service.patch(i.id, { status: IncidentStatus.RESOLVED });
    expect(resolved.status).toBe(IncidentStatus.RESOLVED);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('throws IncidentNotFoundError for unknown ids', async () => {
    await expect(service.patch('nope', { note: 'x' })).rejects.toBeInstanceOf(IncidentNotFoundError);
  });
});
