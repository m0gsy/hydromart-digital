import { MonthlyCloseController } from '../../src/modules/monthly-close.controller';
import { MonthlyCloseService } from '../../src/application/services/monthly-close.service';

// Thin delegate, same shape as DailyCloseController: each handler maps the DTO to service
// args and returns what the service returns. The service is mocked; this only asserts the
// wiring, not the business rules (covered in monthly-close.service.spec.ts).

type Mocked = { [K in keyof MonthlyCloseService]: jest.Mock };

function makeService(): Mocked {
  return {
    get: jest.fn().mockResolvedValue({ close: null, missingDays: [] }),
    close: jest.fn().mockResolvedValue({ id: 'c1' }),
    reopen: jest.fn().mockResolvedValue({ id: 'c1', reopenedBy: 'hq-1' }),
  } as unknown as Mocked;
}

const user = { sub: 'kd-1', role: 'KEPALA_DEPOT', phone: '0811' } as never;

describe('MonthlyCloseController', () => {
  let service: Mocked;
  let controller: MonthlyCloseController;

  beforeEach(() => {
    service = makeService();
    controller = new MonthlyCloseController(service as unknown as MonthlyCloseService);
  });

  it('get: forwards depotId and businessMonth, returns the view', async () => {
    await expect(
      controller.get('d1', { businessMonth: '2026-07' } as never, user),
    ).resolves.toEqual({ close: null, missingDays: [] });
    expect(service.get).toHaveBeenCalledWith(user, 'd1', '2026-07');
  });

  it('close: forwards the note, defaulting to null when omitted', async () => {
    await controller.close('d1', { businessMonth: '2026-07' } as never, user);
    expect(service.close).toHaveBeenCalledWith(user, 'd1', '2026-07', null);

    await controller.close('d1', { businessMonth: '2026-07', note: 'beres' } as never, user);
    expect(service.close).toHaveBeenCalledWith(user, 'd1', '2026-07', 'beres');
  });

  it('reopen: forwards the acting user as reopenedBy', async () => {
    await expect(
      controller.reopen('d1', { businessMonth: '2026-07' } as never, user),
    ).resolves.toMatchObject({ reopenedBy: 'hq-1' });
    expect(service.reopen).toHaveBeenCalledWith('d1', '2026-07', 'kd-1');
  });
});
