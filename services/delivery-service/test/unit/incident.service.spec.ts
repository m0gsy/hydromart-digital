import { randomUUID } from 'node:crypto';

import { IncidentService } from '../../src/application/services/incident.service';
import { IncidentCategory, IncidentSeverity } from '../../src/domain/incident';
import { FakeOpsNotifier, InMemoryIncidentRepository } from '../support/fakes';

describe('IncidentService', () => {
  let repo: InMemoryIncidentRepository;
  let ops: FakeOpsNotifier;
  let service: IncidentService;
  const driver = randomUUID();

  beforeEach(() => {
    repo = new InMemoryIncidentRepository();
    ops = new FakeOpsNotifier();
    service = new IncidentService(repo, ops);
  });

  const report = (severity: IncidentSeverity) =>
    service.report(driver, {
      category: IncidentCategory.ACCIDENT,
      severity,
      description: 'Ban bocor',
    });

  it('stores the incident and alerts ops for HIGH severity', async () => {
    const incident = await report(IncidentSeverity.HIGH);
    expect(incident).toMatchObject({ severity: IncidentSeverity.HIGH, driverId: driver });
    expect(repo.rows).toHaveLength(1);
    expect(ops.alerts).toHaveLength(1);
    expect(ops.alerts[0]).toMatchObject({ severity: IncidentSeverity.HIGH, category: IncidentCategory.ACCIDENT });
  });

  it('does not alert ops for LOW/MEDIUM severity', async () => {
    await report(IncidentSeverity.LOW);
    await report(IncidentSeverity.MEDIUM);
    expect(repo.rows).toHaveLength(2);
    expect(ops.alerts).toHaveLength(0);
  });

  it('lists a driver’s incidents newest first', async () => {
    await report(IncidentSeverity.LOW);
    await report(IncidentSeverity.HIGH);
    const list = await service.listForDriver(driver);
    expect(list).toHaveLength(2);
    expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
  });
});
