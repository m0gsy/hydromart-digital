import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { FraudFlagNotFoundError } from '../../src/domain/errors';
import { FraudFlagService } from '../../src/application/services/fraud-flag.service';
import { InMemoryFraudFlagRepository, makeFraudFlag } from '../support/fakes';

describe('FraudFlagService', () => {
  let repo: InMemoryFraudFlagRepository;
  let service: FraudFlagService;

  beforeEach(() => {
    repo = new InMemoryFraudFlagRepository();
    service = new FraudFlagService(repo);
  });

  it('ingests a flag with the supplied score/level/signals', async () => {
    const rec = await service.ingest({
      entityType: FraudEntityType.ORDER,
      entityRef: 'ORD-1',
      score: 91,
      level: FraudLevel.HIGH,
      signals: ['New address'],
    });
    expect(rec.score).toBe(91);
    expect(rec.status).toBe(FraudStatus.OPEN);
  });

  it('lists highest-score first and filters by level/status', async () => {
    repo.rows = [
      makeFraudFlag({ entityRef: 'low', score: 40, level: FraudLevel.LOW, status: FraudStatus.OPEN }),
      makeFraudFlag({ entityRef: 'high', score: 90, level: FraudLevel.HIGH, status: FraudStatus.REVIEWED }),
      makeFraudFlag({ entityRef: 'mid', score: 65, level: FraudLevel.MEDIUM, status: FraudStatus.OPEN }),
    ];
    const all = await service.list({});
    expect(all.map((f) => f.entityRef)).toEqual(['high', 'mid', 'low']); // highest score first
    expect(await service.list({ level: FraudLevel.HIGH })).toHaveLength(1);
    expect(await service.list({ status: FraudStatus.OPEN })).toHaveLength(2);
  });

  it('review/block/clear transition the status', async () => {
    const f = makeFraudFlag();
    repo.rows = [f];
    expect((await service.review(f.id)).status).toBe(FraudStatus.REVIEWED);
    expect((await service.block(f.id)).status).toBe(FraudStatus.BLOCKED);
    expect((await service.clear(f.id)).status).toBe(FraudStatus.CLEARED);
  });

  it('throws FraudFlagNotFoundError for unknown ids', async () => {
    await expect(service.review('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
    await expect(service.block('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
    await expect(service.clear('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
  });
});
