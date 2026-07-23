import { BadRequestException } from '@nestjs/common';

import { OperationalReportService } from '../../src/application/services/operational-report.service';
import { OperationalReportController } from '../../src/modules/operational-report.controller';

describe('OperationalReportController', () => {
  const report = jest.fn();
  const controller = new OperationalReportController({ report } as unknown as OperationalReportService);

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
