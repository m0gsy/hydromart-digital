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
    expect(p).toMatchObject({
      onTimeThresholdMinutes: 90,
      healthyBandPct: 95,
      criticalBandPct: 85,
    });
  });

  it('saves and reads back the policy', async () => {
    await service.save({ onTimeThresholdMinutes: 60, healthyBandPct: 90, criticalBandPct: 80 });
    const p = await service.get();
    expect(p).toMatchObject({
      onTimeThresholdMinutes: 60,
      healthyBandPct: 90,
      criticalBandPct: 80,
    });
  });

  /* CA-2-53 — see the security policy spec; same shape, same two admins. */
  it('refuses a save built on a copy that is already out of date', async () => {
    const first = await service.save({
      onTimeThresholdMinutes: 90,
      healthyBandPct: 95,
      criticalBandPct: 85,
    });
    await expect(
      service.save(
        { onTimeThresholdMinutes: 120, healthyBandPct: 90, criticalBandPct: 80 },
        new Date(first.updatedAt.getTime() - 1000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
    expect((await service.get()).onTimeThresholdMinutes).toBe(90);
  });

  it('accepts a save from someone looking at the current row', async () => {
    const first = await service.save({
      onTimeThresholdMinutes: 90,
      healthyBandPct: 95,
      criticalBandPct: 85,
    });
    const second = await service.save(
      { onTimeThresholdMinutes: 120, healthyBandPct: 95, criticalBandPct: 85 },
      first.updatedAt.toISOString(),
    );
    expect(second.onTimeThresholdMinutes).toBe(120);
  });
});
