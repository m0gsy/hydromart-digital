import { SettingType } from '@hydromart/platform';

import { CHURN_MODELS, DEFAULT_CHURN_MODEL } from '../domain/churn-models';
import { DEFAULT_MODEL, MODELS } from '../domain/models';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
  /** `string` settings only: regex the written value must match. */
  pattern?: string;
  /** Global-only tunable: no per-depot override is offered. */
  global?: boolean;
}

/**
 * PR-J. Which model a depot's forecasts run through, as a SETTING rather than an env var.
 *
 * That distinction is the entire point of the seam: a candidate model is turned on for one
 * depot, measured against the depot next door, and turned off again — by whoever is
 * watching the numbers, in the console, without a deploy and without waiting for anyone
 * with shell access. An env var would have made every one of those steps a release.
 *
 * The pattern is generated FROM the registry, so a name the service cannot resolve cannot
 * be saved in the first place. Nothing here changes what runs by default: both keys
 * default to the heuristic that has always run.
 */
export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'forecast.demandModel',
    label: 'Model prakiraan permintaan',
    type: 'string',
    envDefault: DEFAULT_MODEL,
    pattern: `^(${MODELS.map((m) => m.name).join('|')})$`,
  },
  {
    key: 'forecast.churnModel',
    label: 'Model risiko churn pelanggan',
    type: 'string',
    envDefault: DEFAULT_CHURN_MODEL,
    pattern: `^(${CHURN_MODELS.map((m) => m.name).join('|')})$`,
  },
];

export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d]),
);
