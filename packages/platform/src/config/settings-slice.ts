import { BadRequestException } from '@nestjs/common';

import { coerce, SettingRow, SettingsCache, SettingType, SettingsSource } from './settings';

/** One tunable a service exposes on its settings screen. */
export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  envDefault: number | string;
  min?: number;
  max?: number;
  /**
   * `string` settings only: a regex the value must match, source form, anchored by the
   * author. `min`/`max` cannot police a string, and a free-text tunable that something
   * downstream has to parse — a slot list, a code format — fails at the reader rather
   * than at the person who typed it otherwise.
   */
  pattern?: string;
  /** true = GLOBAL scope only; a per-depot override is refused. */
  global?: boolean;
}

export interface SettingsSliceRepository extends SettingsSource {
  upsert(row: SettingRow & { updatedBy: string }): Promise<void>;
  remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void>;
}

export interface PutSettingInput {
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  key: string;
  value: string;
  updatedBy: string;
}

/**
 * Refuse a value the store cannot keep as typed.
 *
 * `coerce` is deliberately forgiving because it also runs on the READ path, where a
 * malformed stored value must fall back rather than throw. On the WRITE path that same
 * forgiveness is a trap, and it sprang: `coerce('0.05', 'int')` is `Math.trunc(0.05)` — a
 * silent `0` — and `min: 0` then waves it through.
 *
 * Not hypothetical. Production is serving `silverDiscountPct = goldDiscountPct =
 * platinumDiscountPct = 0` right now, against coded defaults of 2/5/8. The field's unit is
 * `%` and it wants `5`; somebody typed the rate, `0.05`, and was told nothing. Every
 * customer the app calls GOLD has been paying full price since.
 *
 * A value that changes when it is stored is a unit mistake, not a rounding question. The
 * message names the unit, because naming it is the whole fix: the next person types `5`.
 */
function assertStorable(def: SettingDef, raw: string): void {
  if (def.type === 'string') return;

  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(n)) {
    // Today this stores 0 — the same silent zero, by the other door.
    throw new BadRequestException(
      `${def.key} must be a number${def.unit ? ` in ${def.unit}` : ''} — got "${raw}"`,
    );
  }
  if ((def.type === 'int' || def.type === 'money') && !Number.isInteger(n)) {
    const advice =
      def.unit === '%' ? 'Enter the percentage itself (5, not 0.05).' : 'Enter a whole number.';
    throw new BadRequestException(
      `${def.key} is a whole number${def.unit ? ` in ${def.unit}` : ''}, so "${raw}" would be stored as ${Math.trunc(n)}. ${advice}`,
    );
  }
}

/**
 * Q-1: seven services shipped a byte-identical copy of this class — same three
 * methods, same four validation messages, same cache handling. The only real
 * variation was the defs table each one owns, and referral-service's "every
 * tunable here is global" note, which is now just `global: true` on its defs.
 *
 * Services subclass this and pass their own defs; the schema/put/reset behaviour
 * lives in one place, which is also the only reason Q-7's TTL fix was a one-line
 * change instead of seven.
 */
export abstract class SettingsSliceService {
  protected constructor(
    protected readonly repo: SettingsSliceRepository,
    public readonly cache: SettingsCache,
    protected readonly defs: SettingDef[],
    protected readonly defByKey: Record<string, SettingDef>,
  ) {}

  async schema(
    depotId: string | null,
  ): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }> {
    // Q-7: a read, so the cache's own TTL decides whether this costs a query.
    await this.cache.ensureFresh();
    const effective: Record<string, number | string> = {};
    for (const def of this.defs) {
      effective[def.key] = this.cache.effective(def.key, def.type, def.envDefault, depotId);
    }
    return { defs: this.defs, effective };
  }

  async put(input: PutSettingInput): Promise<void> {
    const def = this.defByKey[input.key];
    if (!def) {
      throw new BadRequestException(`Unknown setting: ${input.key}`);
    }
    if (input.scope === 'DEPOT' && !input.depotId) {
      throw new BadRequestException('depotId required for a DEPOT override');
    }
    if (def.global && input.scope === 'DEPOT') {
      throw new BadRequestException(`${input.key} is a global-only setting; no per-depot override`);
    }
    assertStorable(def, input.value);
    const coerced = coerce(input.value, def.type);
    if (def.type === 'string' && def.pattern && !new RegExp(def.pattern).test(String(coerced))) {
      throw new BadRequestException(`${input.key} must match ${def.pattern}`);
    }
    if (def.type !== 'string') {
      const n = coerced as number;
      if (def.min != null && n < def.min) {
        throw new BadRequestException(`${input.key} below min ${def.min}`);
      }
      if (def.max != null && n > def.max) {
        throw new BadRequestException(`${input.key} above max ${def.max}`);
      }
    }
    await this.repo.upsert({
      scope: input.scope,
      depotId: input.scope === 'GLOBAL' ? null : input.depotId,
      key: input.key,
      value: String(coerced),
      updatedBy: input.updatedBy,
    });
    // A write, not a read: the caller must see its own edit, TTL or no TTL.
    await this.cache.refresh();
  }

  async reset(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    if (scope === 'DEPOT' && !depotId) {
      throw new BadRequestException('depotId required for a DEPOT override');
    }
    await this.repo.remove(scope, scope === 'GLOBAL' ? null : depotId, key);
    await this.cache.refresh();
  }
}
