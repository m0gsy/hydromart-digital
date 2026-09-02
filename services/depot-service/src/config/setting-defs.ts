import { Capability } from '@hydromart/access';
import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
  /** Global-only tunable: no per-depot override is offered (server rejects DEPOT scope). */
  global?: boolean;
  /**
   * A tunable whose WRITE needs more than `depotAdmin`, at either scope.
   *
   * Most business settings are a depot's own business. One is not: the auto-pass threshold
   * decides how much money moves without a human looking at it, and the manager who decides
   * the queue is the manager who would be raising it. Named here rather than in the
   * controller so the schema read can hand the same fact to the console (`requires`), and
   * the input a role may not save is disabled instead of failing after the click.
   */
  requires?: Capability;
}

// Business tunables ONLY. Env keys stay the boot-time fallback; values here are the
// documented defaults so the UI can show "ikut default (N)" before any override.
// envDefault must mirror this service's env.validation.ts defaults
export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'gallonDepositIdr',
    label: 'Deposit galon',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 1000000,
    envDefault: 20000,
  },
  {
    key: 'approvalAutoPassIdr',
    label: 'Batas auto-pass approval',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 100000000,
    envDefault: 100000,
    // Owner decision D7: head office and the superuser, nobody else — see the capability.
    requires: 'approvalThresholdWrite',
  },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
