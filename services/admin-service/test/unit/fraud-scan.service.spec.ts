import { FraudScanService } from '../../src/application/services/fraud-scan.service';
import { FraudSignalsPort, RepeatedRefundSignal } from '../../src/application/ports/fraud-signals.port';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { InMemoryFraudFlagRepository } from '../support/fakes';
import { AdminConfigService } from '../../src/config/admin-config.service';

/*
 * `/hq/fraud` could list, review, block and clear flags — and nothing anywhere raised one,
 * so the queue was permanently whatever had been inserted by hand and every verb on that
 * screen acted on a list that could not grow.
 *
 * The scan judges ONE thing: customers with repeated settled refunds. 15b never says what
 * makes an order suspicious, so it starts where nothing has to be guessed.
 */
const config = (over: Partial<{ windowDays: number; minRefunds: number; highRefunds: number }> = {}) =>
  ({
    fraudScan: { windowDays: 30, minRefunds: 3, highRefunds: 5, ...over },
  }) as unknown as AdminConfigService;

const signals = (rows: RepeatedRefundSignal[] | null): FraudSignalsPort => ({
  repeatedRefunds: async () => rows,
});

const NOW = new Date('2026-08-16T00:00:00.000Z');

describe('FraudScanService', () => {
  let flags: InMemoryFraudFlagRepository;

  beforeEach(() => {
    flags = new InMemoryFraudFlagRepository();
  });

  it('raises a review item per customer over the threshold, with the count behind it', async () => {
    const scan = new FraudScanService(
      flags,
      signals([{ customerId: 'cust-1', refunds: 4, amountIdr: 240_000 }]),
      config(),
    );

    const result = await scan.run(NOW);

    expect(result).toEqual({ scanned: 1, flagged: 1, skipped: 0, unavailable: false });
    expect(flags.rows).toHaveLength(1);
    expect(flags.rows[0]).toMatchObject({
      entityType: FraudEntityType.ACCOUNT,
      entityRef: 'cust-1',
      score: 4,
      // Four is over the min and under the HIGH rung: a human looks, nothing is blocked.
      level: FraudLevel.MEDIUM,
      status: FraudStatus.OPEN,
    });
    // The reviewer can check the claim rather than trust a score.
    expect(flags.rows[0].signals.join(' ')).toMatch(/4 refund dalam 30 hari/);
  });

  it('calls the higher rung HIGH, and still only asks for a review', async () => {
    const scan = new FraudScanService(
      flags,
      signals([{ customerId: 'cust-9', refunds: 7, amountIdr: 900_000 }]),
      config(),
    );
    await scan.run(NOW);
    expect(flags.rows[0]).toMatchObject({ level: FraudLevel.HIGH, status: FraudStatus.OPEN });
  });

  /*
   * A daily scan over a rolling window sees the same customer every morning until their
   * refunds age out. Without this the reviewer opens a queue holding thirty copies of one
   * case, which is the same as having no queue.
   */
  it('does not raise a second flag for a case somebody is still holding', async () => {
    const rows = [{ customerId: 'cust-1', refunds: 4, amountIdr: 240_000 }];
    const scan = new FraudScanService(flags, signals(rows), config());

    await scan.run(NOW);
    const second = await scan.run(NOW);

    expect(second).toEqual({ scanned: 1, flagged: 0, skipped: 1, unavailable: false });
    expect(flags.rows).toHaveLength(1);
  });

  // Once the case is closed the customer can be flagged again — a cleared flag is a verdict
  // on what was seen then, not a permanent exemption from being looked at.
  it('flags again after the earlier case was closed', async () => {
    const rows = [{ customerId: 'cust-1', refunds: 4, amountIdr: 240_000 }];
    const scan = new FraudScanService(flags, signals(rows), config());
    await scan.run(NOW);
    await flags.setStatus(flags.rows[0].id, FraudStatus.CLEARED);

    const again = await scan.run(NOW);

    expect(again.flagged).toBe(1);
    expect(flags.rows).toHaveLength(2);
  });

  /*
   * The failure that matters most: payment-service unreadable. Reporting `scanned: 0` alone
   * would read as a clean week — the exact shape of lie the rest of this audit was about.
   */
  it('reports itself unavailable rather than a quiet week when the signals cannot be read', async () => {
    const scan = new FraudScanService(flags, signals(null), config());

    const result = await scan.run(NOW);

    expect(result).toEqual({ scanned: 0, flagged: 0, skipped: 0, unavailable: true });
    expect(flags.rows).toHaveLength(0);
  });

  // The scheduler calls run() with no argument, so the default `now` is a real branch.
  it('defaults its window to the moment it runs', async () => {
    const repeatedRefunds = jest.fn().mockResolvedValue([]);
    const scan = new FraudScanService(
      flags,
      { repeatedRefunds } as unknown as FraudSignalsPort,
      config(),
    );

    await scan.run();

    const [from, to] = repeatedRefunds.mock.calls[0];
    expect(to.getTime() - from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('asks over the configured window, and never invents a threshold of its own', async () => {
    const repeatedRefunds = jest.fn().mockResolvedValue([]);
    const scan = new FraudScanService(
      flags,
      { repeatedRefunds } as unknown as FraudSignalsPort,
      config({ windowDays: 7, minRefunds: 2 }),
    );

    await scan.run(NOW);

    expect(repeatedRefunds).toHaveBeenCalledWith(
      new Date('2026-08-09T00:00:00.000Z'),
      NOW,
      2,
    );
  });
});
