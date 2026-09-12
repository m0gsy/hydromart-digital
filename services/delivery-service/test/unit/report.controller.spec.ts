import { BadRequestException } from '@nestjs/common';

import { ReportController } from '../../src/modules/report.controller';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';
/** Both controllers read only `businessTimeZone`; WIB is pinned so a UTC month-window
 * regression (H-16) fails here rather than in production reporting. */
const deliveryTestConfig = (timeZone = 'Asia/Jakarta'): DeliveryConfigService =>
  ({ businessTimeZone: timeZone }) as DeliveryConfigService;

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const headOffice = { sub: 'hq-1', role: 'HEAD_OFFICE', phone: null, depotId: null } as never;
const manager = (...depotIds: string[]) =>
  ({ sub: 'mgr-1', role: 'MANAGER', phone: null, depotId: null, depotIds }) as never;

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
  const reports = {
    sla: jest.fn().mockResolvedValue({}),
    slaByDepot: jest.fn().mockResolvedValue({}),
  };
  const controller = new ReportController(reports as never, deliveryTestConfig());

  it('passes through the window when one is given, and undefined when it is not', async () => {
    await controller.sla({ from: '2026-07-01', to: '2026-07-31' } as never, headOffice);
    expect(reports.sla).toHaveBeenCalledWith(
      { from: new Date('2026-07-01'), to: new Date('2026-07-31') },
      undefined,
      undefined,
    );

    await controller.slaByDepot({} as never, headOffice);
    expect(reports.slaByDepot).toHaveBeenCalledWith(
      { from: undefined, to: undefined },
      undefined,
      undefined,
    );
  });

  /*
   * SEC-AUDIT DLV-1 / DLV-2. `deliveryReports` admits MANAGER, a depot-scoped role.
   * `sla-by-depot` had no depot dimension at all, and `sla` treated an omitted `depotIds` as
   * "every depot" — so dropping one query parameter widened the answer to the whole network.
   */
  it("scopes both SLA reports to a manager's own depots when they ask for none", async () => {
    await controller.sla({} as never, manager(DEPOT_A, DEPOT_B));
    expect(reports.sla).toHaveBeenLastCalledWith(
      { from: undefined, to: undefined },
      undefined,
      [DEPOT_A, DEPOT_B],
    );

    await controller.slaByDepot({} as never, manager(DEPOT_A));
    expect(reports.slaByDepot).toHaveBeenLastCalledWith(
      { from: undefined, to: undefined },
      undefined,
      [DEPOT_A],
    );
  });

  // Asking for a depot still wins — DepotScopeGuard has already checked that request.
  it('keeps the depots the caller asked for', async () => {
    await controller.sla({ depotIds: [DEPOT_B] } as never, manager(DEPOT_A, DEPOT_B));
    expect(reports.sla).toHaveBeenLastCalledWith({ from: undefined, to: undefined }, undefined, [
      DEPOT_B,
    ]);
  });

  // S2. order-service's monthly review asks for one depot over one month. Same service
  // method as the bearer route above — the internal one differs only in how it is
  // authenticated, so the two can never report a different on-time rate for the same window.
  it('answers the internal route from the same computation, scoped to the given depot', async () => {
    await controller.internalSla({
      depotIds: ['d1'],
      from: '2026-06-30T17:00:00.000Z',
      to: '2026-07-31T17:00:00.000Z',
    } as never);
    expect(reports.sla).toHaveBeenLastCalledWith(
      {
        from: new Date('2026-06-30T17:00:00.000Z'),
        to: new Date('2026-07-31T17:00:00.000Z'),
      },
      undefined,
      ['d1'],
    );
  });
});
