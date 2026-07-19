import { CommissionController } from '../../src/modules/commission.controller';
import { CommissionService } from '../../src/application/services/commission.service';
import { ApplySchemeDto } from '../../src/modules/dto/commission.dto';

describe('CommissionController', () => {
  const commission = {
    listCurrent: jest.fn().mockResolvedValue([]),
    apply: jest.fn().mockResolvedValue([]),
  };
  const controller = new CommissionController(commission as unknown as CommissionService);
  afterEach(() => jest.clearAllMocks());

  it('listSchemes delegates to listCurrent', async () => {
    await controller.listSchemes();
    expect(commission.listCurrent).toHaveBeenCalledWith();
  });

  it('apply maps effectiveDate to a Date and passes items through', async () => {
    const items = [{ depotId: 'd1', pct: 20 }];
    await controller.apply({ effectiveDate: '2026-08-01', items } as unknown as ApplySchemeDto);
    expect(commission.apply).toHaveBeenCalledWith({
      effectiveDate: new Date('2026-08-01'),
      items,
    });
  });
});
