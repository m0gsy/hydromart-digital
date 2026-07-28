import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { BonusRule, BonusType } from '../../../prisma/generated/client';
import { BonusMetric, CompareOp, RewardKind } from '../../domain/bonus-rules';
import {
  BONUS_RULE_REPOSITORY,
  BonusRuleRepository,
  BonusRuleWrite,
} from '../ports/bonus-rule.repository';

const METRICS: readonly BonusMetric[] = [
  'ATTENDANCE_RATE',
  'PRESENT_DAYS',
  'ZERO_LATE',
  'IS_DEPOT_MANAGER',
  'SALES_TOTAL',
];
const OPS: readonly CompareOp[] = ['GTE', 'LTE', 'EQ'];
const REWARD_KINDS: readonly RewardKind[] = ['FIXED', 'PERCENT'];
const BONUS_TYPES: readonly BonusType[] = ['ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL'];

export interface BonusRuleInput {
  depotId?: string | null;
  bonusType: string;
  name: string;
  metric: string;
  op: string;
  threshold: number;
  rewardKind: string;
  rewardValue: number;
  active?: boolean;
}

/** Manage configurable auto-bonus rules. Global rules (depotId null) need an unrestricted caller. */
@Injectable()
export class BonusRuleService {
  constructor(@Inject(BONUS_RULE_REPOSITORY) private readonly repo: BonusRuleRepository) {}

  async create(user: AuthenticatedUser, input: BonusRuleInput): Promise<BonusRule> {
    this.validate(input);
    const depotId = input.depotId ?? null;
    if (depotId) assertDepotAccess(user, depotId);
    return this.repo.create({
      depotId,
      bonusType: input.bonusType as BonusType,
      name: input.name.trim(),
      metric: input.metric,
      op: input.op,
      threshold: input.threshold,
      rewardKind: input.rewardKind,
      rewardValue: input.rewardValue,
      active: input.active ?? true,
      createdBy: user.sub,
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: Partial<BonusRuleInput>,
  ): Promise<BonusRule> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Rule bonus tidak ditemukan');
    if (existing.depotId) assertDepotAccess(user, existing.depotId);
    this.validate({ ...existing, ...input } as BonusRuleInput, true);
    const patch: Partial<BonusRuleWrite> = {};
    if (input.bonusType !== undefined) patch.bonusType = input.bonusType as BonusType;
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.metric !== undefined) patch.metric = input.metric;
    if (input.op !== undefined) patch.op = input.op;
    if (input.threshold !== undefined) patch.threshold = input.threshold;
    if (input.rewardKind !== undefined) patch.rewardKind = input.rewardKind;
    if (input.rewardValue !== undefined) patch.rewardValue = input.rewardValue;
    if (input.active !== undefined) patch.active = input.active;
    return this.repo.update(id, patch);
  }

  list(depotId?: string | null): Promise<BonusRule[]> {
    return this.repo.list(depotId);
  }

  private validate(input: BonusRuleInput, partial = false): void {
    if (!partial && (!input.name || !input.name.trim()))
      throw new BadRequestException('name wajib diisi');
    if (input.bonusType !== undefined && !BONUS_TYPES.includes(input.bonusType as BonusType))
      throw new BadRequestException(`bonusType harus salah satu: ${BONUS_TYPES.join(', ')}`);
    if (input.metric !== undefined && !METRICS.includes(input.metric as BonusMetric))
      throw new BadRequestException(`metric harus salah satu: ${METRICS.join(', ')}`);
    if (input.op !== undefined && !OPS.includes(input.op as CompareOp))
      throw new BadRequestException(`op harus salah satu: ${OPS.join(', ')}`);
    if (input.rewardKind !== undefined && !REWARD_KINDS.includes(input.rewardKind as RewardKind))
      throw new BadRequestException(`rewardKind harus salah satu: ${REWARD_KINDS.join(', ')}`);
    if (input.rewardValue !== undefined && input.rewardValue < 0)
      throw new BadRequestException('rewardValue tidak boleh negatif');
  }
}
