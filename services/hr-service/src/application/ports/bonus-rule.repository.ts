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
  listActiveForDepot(depotId: string): Promise<BonusRule[]>;
  /** Admin listing: all rules for a depot scope (null = global), or every rule when undefined. */
  list(depotId?: string | null): Promise<BonusRule[]>;
}
