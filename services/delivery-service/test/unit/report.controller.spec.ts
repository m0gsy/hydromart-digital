import { BadRequestException } from '@nestjs/common';

import { ReportController } from '../../src/modules/report.controller';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';
/** Both controllers read only `businessTimeZone`; WIB is pinned so a UTC month-window
 * regression (H-16) fails here rather than in production reporting. */
const deliveryTestConfig = (timeZone = 'Asia/Jakarta'): DeliveryConfigService =>
  ({ businessTimeZone: timeZone }) as DeliveryConfigService;


describe('ReportController.depotTeam', () => {
  const depotId = '00000000-0000-4000-8000-000000000001';
  const reports = { depotTeam: jest.fn() };
  const controller = new ReportController(reports as never, deliveryTestConfig());

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T08:00:00.000Z'));
    reports.depotTeam.mockReset().mockResolvedValue({ couriers: [], operators: [] });
  });

  afterEach(() => jest.useRealTimers());

  // H-16: the default window is the WIB month now. 1 July 00:00 WIB is 2026-06-30T17:00Z —
  // the old UTC bounds started at 07:00 WIB and so lost the first seven hours of the month.
  it('defaults the optional range to the current WIB month', async () => {
    await controller.depotTeam({ depotId });

    expect(reports.depotTeam).toHaveBeenCalledWith(
      depotId,
      new Date('2026-06-30T17:00:00.000Z'),
      new Date('2026-07-31T17:00:00.000Z'),
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

describe('ReportController range parsing', () => {
  const reports = { sla: jest.fn().mockResolvedValue({}), slaByDepot: jest.fn().mockResolvedValue({}) };
  const controller = new ReportController(reports as never, deliveryTestConfig());

  it('passes through the window when one is given, and undefined when it is not', async () => {
    await controller.sla({ from: '2026-07-01', to: '2026-07-31' } as never);
    expect(reports.sla).toHaveBeenCalledWith(
      { from: new Date('2026-07-01'), to: new Date('2026-07-31') },
      undefined,
      undefined,
    );

    await controller.slaByDepot({} as never);
    expect(reports.slaByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined }, undefined);
  });
});
