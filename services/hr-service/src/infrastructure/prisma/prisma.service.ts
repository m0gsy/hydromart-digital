import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loggedQueryBounds } from '@hydromart/platform';
import { PrismaClient } from '../../../prisma/generated/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Every findMany that did not set its own `take` gets one. See @hydromart/platform.
    this.$use(loggedQueryBounds(this.logger));
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
