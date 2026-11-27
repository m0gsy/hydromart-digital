import { Injectable } from '@nestjs/common';

import {
  UnservedDemandRepository,
  UnservedDemandRow,
} from '../../application/ports/unserved-demand.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class UnservedDemandPrismaRepository implements UnservedDemandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(row: UnservedDemandRow): Promise<void> {
    await this.prisma.unservedDemand.create({ data: row });
  }
}
