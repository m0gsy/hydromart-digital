import { ConfigService } from '@nestjs/config';

import { ForecastConfigService } from '../../src/config/forecast-config.service';

/**
 * The per-depot model setting is read on a request path, so every wrong value it can be
 * given has to end somewhere safe. "Somewhere safe" is the heuristic everybody else gets —
 * never an exception, because that would take a depot's stock screen down over a typo.
 */
describe('forecast model setting', () => {
  const config = (env: Record<string, string>) =>
    new ForecastConfigService({
      get: (key: string, fallback: unknown) => env[key] ?? fallback,
    } as unknown as ConfigService);

  it('defaults to the heuristic when nothing is set', () => {
    expect(config({}).forecastModel).toBe('heuristic');
    expect(config({}).forecastModelForDepot('depot-1')).toBe('heuristic');
  });

  it('honours a global override', () => {
    expect(config({ FORECAST_MODEL: 'moving-average' }).forecastModelForDepot('depot-1')).toBe(
      'moving-average',
    );
  });

  it('gives a named depot its own model and leaves the others alone', () => {
    const c = config({ FORECAST_MODEL_BY_DEPOT: '{"depot-1":"moving-average"}' });
    expect(c.forecastModelForDepot('depot-1')).toBe('moving-average');
    expect(c.forecastModelForDepot('depot-2')).toBe('heuristic');
  });

  it('falls back to the global model for a depotless (all-depots) forecast', () => {
    const c = config({ FORECAST_MODEL: 'moving-average', FORECAST_MODEL_BY_DEPOT: '{"d":"heuristic"}' });
    expect(c.forecastModelForDepot(null)).toBe('moving-average');
    expect(c.forecastModelForDepot(undefined)).toBe('moving-average');
  });

  it('ignores a malformed map instead of throwing inside a forecast', () => {
    const c = config({ FORECAST_MODEL_BY_DEPOT: '{not json' });
    expect(c.forecastModelForDepot('depot-1')).toBe('heuristic');
  });
});
