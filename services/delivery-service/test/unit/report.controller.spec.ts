import { BadRequestException } from '@nestjs/common';

import { ReportController } from '../../src/modules/report.controller';

describe('ReportController.depotTeam', () => {
  const depotId = '00000000-0000-4000-8000-000000000001';
  const reports = { depotTeam: jest.fn() };
  const controller = new ReportController(reports as never);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T08:00:00.000Z'));
    reports.depotTeam.mockReset().mockResolvedValue({ couriers: [], operators: [] });
  });

  afterEach(() => jest.useRealTimers());

  it('defaults the optional range to the current UTC month', async () => {
    await controller.depotTeam({ depotId });

    expect(reports.depotTeam).toHaveBeenCalledWith(
      depotId,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
    );
  });

  it('rejects an empty or reversed [from,to) window', () => {
    expect(() =>
      controller.depotTeam({
        depotId,
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-10T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });
});
