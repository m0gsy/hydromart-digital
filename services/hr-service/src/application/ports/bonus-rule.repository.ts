import { BonusRule, BonusType } from '../../../prisma/generated/client';

export const BONUS_RULE_REPOSITORY = Symbol('BONUS_RULE_REPOSITORY');

export interface BonusRuleWrite {
  depotId: string | null;
  bonusType: BonusType;
  name: string;
  metric: string;
  op: string;
  threshold: number;
  rewardKind: string;
  rewardValue: number;
  active: boolean;
  createdBy: string | null;
}

export interface BonusRuleRepository {
  create(data: BonusRuleWrite): Promise<BonusRule>;
  update(id: string, data: Partial<BonusRuleWrite>): Promise<BonusRule>;
  findById(id: string): Promise<BonusRule | null>;
  /** Active rules that apply to a depot: its own overrides + the global (null-depot) defaults. */
  listActiveForDepot(depotId: string | null): Promise<BonusRule[]>;
  /**
   * Admin listing. `undefined` = every rule; `null` = the global (network-wide) rules only;
   * a uuid = that depot's rules; an array = those depots' rules PLUS the global defaults,
   * because a global rule pays out at every depot and a supervisor must see what pays their
   * staff (CA-1-31).
   */
  list(scope?: string | null | readonly string[]): Promise<BonusRule[]>;
}
