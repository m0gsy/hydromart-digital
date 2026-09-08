import { Injectable } from '@nestjs/common';

import { BonusRule } from '../../../prisma/generated/client';
import { BonusRuleRepository, BonusRuleWrite } from '../../application/ports/bonus-rule.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class BonusRulePrismaRepository implements BonusRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: BonusRuleWrite): Promise<BonusRule> {
    return this.prisma.bonusRule.create({ data });
  }

  update(id: string, data: Partial<BonusRuleWrite>): Promise<BonusRule> {
    return this.prisma.bonusRule.update({ where: { id }, data });
  }

  findById(id: string): Promise<BonusRule | null> {
    return this.prisma.bonusRule.findUnique({ where: { id } });
  }

  listActiveForDepot(depotId: string | null): Promise<BonusRule[]> {
    // Depot-specific rules + global (null-depot) defaults both apply.
    return this.prisma.bonusRule.findMany({
      where: { active: true, OR: [{ depotId }, { depotId: null }] },
      orderBy: { createdAt: 'asc' },
    });
  }

  list(scope?: string | null | readonly string[]): Promise<BonusRule[]> {
    // The array arm mirrors `listActiveForDepot` above: a depot's own rules and the global
    // defaults both apply to it, so both belong in a depot-scoped listing (CA-1-31).
    const where = Array.isArray(scope)
      ? { OR: [{ depotId: { in: [...scope] } }, { depotId: null }] }
      : scope === undefined
        ? {}
        : { depotId: scope as string | null };
    return this.prisma.bonusRule.findMany({ where, orderBy: { createdAt: 'desc' } });
  }
}
