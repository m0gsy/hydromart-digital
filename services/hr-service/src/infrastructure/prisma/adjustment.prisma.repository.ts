import { Injectable } from '@nestjs/common';
import { Bonus, BonusType, Deduction, DeductionType } from '../../../prisma/generated/client';

import {
  BonusRepository,
  DeductionRepository,
} from '../../application/ports/adjustment.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class BonusPrismaRepository implements BonusRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    employeeId: string;
    type: BonusType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Bonus> {
    return this.prisma.bonus.create({ data });
  }

  listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Bonus[]> {
    return this.prisma.bonus.findMany({ where: { employeeId, periodMonth }, orderBy: { createdAt: 'desc' } });
  }
}

@Injectable()
export class DeductionPrismaRepository implements DeductionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    employeeId: string;
    type: DeductionType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Deduction> {
    return this.prisma.deduction.create({ data });
  }

  listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Deduction[]> {
    return this.prisma.deduction.findMany({ where: { employeeId, periodMonth }, orderBy: { createdAt: 'desc' } });
  }
}
