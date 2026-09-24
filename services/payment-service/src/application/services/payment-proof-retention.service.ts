import { Inject, Injectable, Logger } from '@nestjs/common';

import { proofKeyFromUrl } from '../../domain/payment-proof';
import { PaymentRepository } from '../ports/payment.repository';
import { StoragePort } from '../ports/storage.port';
import { PAYMENT_TOKENS } from '../tokens';

/** Rows handled per round, and rounds per call: a sweep is bounded, the next tick resumes. */
const BATCH = 200;
const MAX_ROUNDS = 25;

/**
 * UU PDP retention for the one thing payment-service stores that is not money: the photo a
 * customer uploads to prove a transfer — a picture of their banking app, with a name, an
 * account number and a balance in it.
 *
 * The payment ROW is a financial record and stays for ten years. Only the photo goes: the
 * object first, then the pointer. In that order on purpose — a pointer cleared before the
 * delete succeeds leaves an orphaned object nothing will ever look for again, whereas an
 * object deleted and a pointer left behind is found again on the next tick and finishes.
 *
 * The cutoff arrives from admin-service's retention policy (`payment_proof`, 12 months);
 * this service owns the rows and never the rule, exactly as proof-of-delivery works.
 */
@Injectable()
export class PaymentProofRetentionService {
  private readonly logger = new Logger(PaymentProofRetentionService.name);

  constructor(
    @Inject(PAYMENT_TOKENS.PaymentRepository) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_TOKENS.Storage) private readonly storage: StoragePort,
  ) {}

  /**
   * Raises when any object could not be removed, rather than returning the count that did
   * work: the caller records "0 purged" and "storage was unreachable" identically otherwise,
   * which is the one outcome a retention sweep exists to make impossible.
   */
  async purgeOlderThan(cutoff: Date): Promise<{ purged: number }> {
    let purged = 0;
    const failed = new Set<string>();

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const due = (await this.payments.findProofsSettledBefore(cutoff, BATCH)).filter(
        (row) => !failed.has(row.id),
      );
      if (due.length === 0) break;

      for (const row of due) {
        try {
          // A URL with no `payment-proof/` in it is not an object this service wrote, so there
          // is nothing to delete — only the pointer to drop.
          const key = proofKeyFromUrl(row.proofUrl);
          if (key) await this.storage.remove(key);
          await this.payments.clearProof(row.id);
          purged += 1;
        } catch (error) {
          failed.add(row.id);
          this.logger.error(`Payment proof ${row.id} not purged: ${(error as Error).message}`);
        }
      }
    }

    if (purged > 0) this.logger.log(`Purged ${purged} payment proof(s) older than the cutoff`);
    if (failed.size > 0) {
      throw new Error(`${failed.size} payment proof(s) could not be purged (${purged} were)`);
    }
    return { purged };
  }
}
