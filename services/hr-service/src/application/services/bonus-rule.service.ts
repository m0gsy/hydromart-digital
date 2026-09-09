import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { assertFresh, AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

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

  /** CA-2-53: refused when the caller's copy is older — this rule decides who is paid what. */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: Partial<BonusRuleInput>,
    seenUpdatedAt?: string,
  ): Promise<BonusRule> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Rule bonus tidak ditemukan');
    if (existing.depotId) assertDepotAccess(user, existing.depotId);
    // Validation first: "your input is malformed" is a more useful answer than "reload",
    // and a malformed write is refused either way.
    this.validate({ ...existing, ...input } as BonusRuleInput, true);
    assertFresh(existing.updatedAt, seenUpdatedAt);
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

  /*
   * CA-1-31. This took no caller, so `GET /bonus-rules` with no query handed EVERY depot's
   * bonus rules to anyone with `hrView` — a set that reaches SUPERVISOR and
   * ASSISTANT_SUPERVISOR, each pinned to one depot. Bonus rules are money rules: they are
   * what mints a bonus onto a payslip, so another depot's are another depot's business.
   *
   * `depotScopeIds` returns undefined for anyone above depots, which is how HQ keeps the
   * whole-network view, and throws for a depot outside the caller's set — so asking for
   * someone else's by id is refused rather than quietly answered.
   */
  // `async` on purpose: `depotScopeIds` THROWS for a depot outside the caller's set, and a
  // method typed as returning a promise must reject rather than throw past its own signature
  // (same reason as `PayrollService.list`).
  async list(user: AuthenticatedUser, depotId?: string | null): Promise<BonusRule[]> {
    if (depotId !== undefined) {
      // `null` is the 'global' bucket — network-wide rules belong to no depot to check.
      if (depotId !== null) depotScopeIds(user, depotId);
      return this.repo.list(depotId);
    }
    return this.repo.list(depotScopeIds(user));
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
