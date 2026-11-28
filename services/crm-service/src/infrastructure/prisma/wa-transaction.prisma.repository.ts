import { Injectable } from '@nestjs/common';

import {
  WaCapRepository,
  WaConsentRepository,
  WaMessageRepository,
  WaTransactionRepository,
} from '../../application/ports/wa.repository';
import { WaCapPrismaRepository } from './wa-cap.prisma.repository';
import { WaConsentPrismaRepository } from './wa-consent.prisma.repository';
import { WaMessagePrismaRepository } from './wa-message.prisma.repository';
import { PrismaService } from './prisma.service';

/**
 * HD-12/HD-13: the same three repositories bound to ONE interactive transaction. A webhook item writes its
 * dedupe key, its consent rows and its cancellations through them, so a failure anywhere takes the dedupe key
 * with it and Meta's retry processes the item again.
 */
@Injectable()
export class WaTransactionPrismaRepository implements WaTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(
    fn: (tx: { consent: WaConsentRepository; messages: WaMessageRepository; caps: WaCapRepository }) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((client) => {
      // The transaction client has the same model delegates as the service, which is all the repositories use.
      const bound = client as unknown as PrismaService;
      return fn({
        consent: new WaConsentPrismaRepository(bound),
        messages: new WaMessagePrismaRepository(bound),
        caps: new WaCapPrismaRepository(bound),
      });
    });
  }
}
