import { SlaPolicyService } from '../../src/application/services/sla-policy.service';
import { InMemorySlaPolicyRepository } from '../support/fakes';

describe('SlaPolicyService', () => {
  let repo: InMemorySlaPolicyRepository;
  let service: SlaPolicyService;

  beforeEach(() => {
    repo = new InMemorySlaPolicyRepository();
    service = new SlaPolicyService(repo);
  });

  it('returns platform defaults before anything is saved', async () => {
    const p = await service.get();
    expect(p).toMatchObject({ onTimeThresholdMinutes: 90, healthyBandPct: 95, criticalBandPct: 85 });
  });

  it('saves and reads back the policy', async () => {
    await service.save({ onTimeThresholdMinutes: 60, healthyBandPct: 90, criticalBandPct: 80 });
    const p = await service.get();
    expect(p).toMatchObject({ onTimeThresholdMinutes: 60, healthyBandPct: 90, criticalBandPct: 80 });
  });
});
