import { BadRequestException } from '@nestjs/common';

import { DepotGovernanceService } from '../../src/application/services/depot-governance.service';
import { OperationalReportService } from '../../src/application/services/operational-report.service';
import { OperationalReportController } from '../../src/modules/operational-report.controller';

describe('OperationalReportController', () => {
  const report = jest.fn();
  const inRange = jest.fn();
  const controller = new OperationalReportController(
    { report } as unknown as OperationalReportService,
    { inRange } as unknown as DepotGovernanceService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('uses an inclusive from and exclusive to range', async () => {
    report.mockResolvedValue({ reportType: 'OPERATIONAL_MANAGEMENT' });
    await controller.costs({
      depotId: '11111111-1111-4111-8111-111111111111',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(report).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('passes the governance window straight through', async () => {
    inRange.mockResolvedValue({
      approvalsReviewed: 2,
      opnameVarianceIdr: -15000,
      settlementVarianceIdr: 0,
      daysClosed: 30,
    });
    await controller.governanceInRange({
      depotId: '11111111-1111-4111-8111-111111111111',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(inRange).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
    );
  });

  it('rejects a reversed governance range too', async () => {
    await expect(
      controller.governanceInRange({
        depotId: '11111111-1111-4111-8111-111111111111',
        from: '2026-08-02T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty or reversed date range', async () => {
    await expect(
      controller.costs({
        depotId: '11111111-1111-4111-8111-111111111111',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
