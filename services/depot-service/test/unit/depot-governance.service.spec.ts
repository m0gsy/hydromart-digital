import { DepotGovernanceService } from '../../src/application/services/depot-governance.service';
import { ApprovalRepository } from '../../src/application/ports/approval.repository';
import { DailyCloseRepository } from '../../src/application/ports/daily-close.repository';
import { InventoryRepository } from '../../src/application/ports/inventory.repository';

const FROM = new Date('2026-07-01T00:00:00.000Z');
const TO = new Date('2026-08-01T00:00:00.000Z');

function make(
  over: {
    reviewed?: number;
    variances?: { sellPrice: number | null; delta: number }[];
    closes?: { codDepositedIdr: number; codExpectedIdr: number }[];
  } = {},
) {
  const approvals = {
    countReviewedInRange: jest.fn().mockResolvedValue(over.reviewed ?? 0),
  } as unknown as ApprovalRepository;
  const inventory = {
    opnameVariances: jest.fn().mockResolvedValue(over.variances ?? []),
  } as unknown as InventoryRepository;
  const closes = {
    listForDepotRange: jest.fn().mockResolvedValue(over.closes ?? []),
  } as unknown as DailyCloseRepository;
  return { service: new DepotGovernanceService(approvals, inventory, closes), approvals };
}

describe('DepotGovernanceService', () => {
  it('reports zeroes for a depot with no activity, never nulls', async () => {
    const { service } = make();
    await expect(service.inRange('d1', FROM, TO)).resolves.toEqual({
      approvalsReviewed: 0,
      opnameVarianceIdr: 0,
      settlementVarianceIdr: 0,
      daysClosed: 0,
    });
  });

  it('values opname variances at the line sell price, keeping the sign', async () => {
    const { service } = make({
      variances: [
        { sellPrice: 20_000, delta: -3 },
        { sellPrice: 20_000, delta: 1 },
      ],
    });
    const out = await service.inRange('d1', FROM, TO);
    // -3 short and +1 long is a net two gallons missing, not four movements' worth of loss.
    expect(out.opnameVarianceIdr).toBe(-40_000);
  });

  it('values a line with no sell price at zero rather than skipping the count', async () => {
    const { service } = make({ variances: [{ sellPrice: null, delta: -5 }] });
    await expect(service.inRange('d1', FROM, TO)).resolves.toMatchObject({
      opnameVarianceIdr: 0,
    });
  });

  it('sums deposited minus expected across the closed days', async () => {
    const { service } = make({
      closes: [
        { codDepositedIdr: 500_000, codExpectedIdr: 520_000 },
        { codDepositedIdr: 300_000, codExpectedIdr: 300_000 },
      ],
    });
    const out = await service.inRange('d1', FROM, TO);
    expect(out.settlementVarianceIdr).toBe(-20_000);
    // The denominator matters: two closed days out of a month is not a clean month.
    expect(out.daysClosed).toBe(2);
  });

  it('asks the approval repo for the window it was given', async () => {
    const { service, approvals } = make({ reviewed: 4 });
    const out = await service.inRange('d1', FROM, TO);
    expect(approvals.countReviewedInRange).toHaveBeenCalledWith('d1', FROM, TO);
    expect(out.approvalsReviewed).toBe(4);
  });
});
