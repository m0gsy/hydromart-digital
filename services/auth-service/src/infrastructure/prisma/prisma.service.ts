import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loggedQueryBounds } from '@hydromart/platform';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around the generated Prisma client that ties its lifecycle to the
 * Nest module lifecycle. The connection string is read from AUTH_DATABASE_URL
 * (see prisma/schema.prisma).
 */
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
