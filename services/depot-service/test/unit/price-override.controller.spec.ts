import { DepotPriceOverrideController } from '../../src/modules/price-override.controller';
import { PricingAdjustType } from '../../src/domain/pricing-rule';

describe('DepotPriceOverrideController.import', () => {
  const overrides = { importProposals: jest.fn() };
  const controller = new DepotPriceOverrideController(overrides as never);
  const DEPOT = '00000000-0000-4000-8000-000000000001';

  it('normalizes a missing note to null before handing rows to the service', async () => {
    overrides.importProposals.mockResolvedValue({ created: 1, skipped: 0, failed: 0, results: [] });

    await controller.import({ sub: 'mgr-1' } as never, DEPOT, {
      rows: [
        {
          productId: '11111111-1111-4111-8111-111111111111',
          productName: 'Galon 19L',
          currentPrice: 20000,
          adjustType: PricingAdjustType.PERCENT,
          value: -10,
        },
      ],
    } as never);

    expect(overrides.importProposals).toHaveBeenCalledWith(DEPOT, 'mgr-1', [
      {
        productId: '11111111-1111-4111-8111-111111111111',
        productName: 'Galon 19L',
        currentPrice: 20000,
        adjustType: PricingAdjustType.PERCENT,
        value: -10,
        note: null,
      },
    ]);
  });
});
