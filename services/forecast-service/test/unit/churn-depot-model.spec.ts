/**
 * Owner decision 2026-11-19: HQ scores each customer with that customer's DEPOT model.
 *
 * The depot list and the CRM card already used the depot's model, but HQ's list scored every
 * row with the global one. A depot that had picked its own model saw a customer as HIGH, while
 * head office rated the same person MEDIUM. One customer now has one risk band everywhere.
 */
import { SettingsCache } from '@hydromart/platform';

import { ForecastService } from '../../src/application/services/forecast.service';
import { ForecastConfigService } from '../../src/config/forecast-config.service';
import { FakeForecastRepository } from '../support/fakes';

const NOW = new Date('2026-07-12T12:00:00Z');
const configStub = {
  churnWindowDays: 45,
  churnMonetaryRef: 0,
  forecastModelForDepot: () => 'heuristic',
} as unknown as ForecastConfigService;
const noNames = async () => new Map<string, string>();

// Depot d-a chose the recency-only baseline; everyone else runs the global heuristic.
const settings = () =>
  new SettingsCache({
    loadAll: async () => [{ scope: 'DEPOT', depotId: 'd-a', key: 'forecast.churnModel', value: 'recency-only' }],
  });

async function seed(repo: FakeForecastRepository, service: ForecastService) {
  // Five orders each, the last one 30 days ago: the heuristic dampens for frequency, the
  // baseline does not, so the two models disagree about the very same history.
  for (const [customerId, depotId] of [
    ['at-a', 'd-a'],
    ['at-b', 'd-b'],
  ] as const) {
    for (let i = 0; i < 5; i += 1) {
      await service.ingest({
        orderId: `${customerId}-${i}`,
        customerId,
        depotId,
        total: 40_000,
        at: new Date(NOW.getTime() - (30 + i) * 86_400_000),
        items: [{ productId: 'p', productName: 'Galon', sku: 'G', unit: 'galon', quantity: 1 }],
      });
    }
  }
  void repo;
}

describe('HQ churn uses each customer’s depot model', () => {
  it('scores a row with its own depot’s model, as the depot list does', async () => {
    const repo = new FakeForecastRepository();
    const service = new ForecastService(repo, configStub, noNames, settings());
    await seed(repo, service);

    const hq = await service.churnList({ now: NOW });
    const depotA = await service.churnList({ depotId: 'd-a', now: NOW });
    const depotB = await service.churnList({ depotId: 'd-b', now: NOW });
    const score = (list: { customers: { customerId: string; riskScore: number }[] }, id: string) =>
      list.customers.find((c) => c.customerId === id)?.riskScore;

    expect(score(hq, 'at-a')).toBe(score(depotA, 'at-a'));
    expect(score(hq, 'at-b')).toBe(score(depotB, 'at-b'));
    // The two depots' models really do disagree about the same history.
    expect(score(hq, 'at-a')).not.toBe(score(hq, 'at-b'));
  });
});
