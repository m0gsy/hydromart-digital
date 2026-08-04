import { PrismaService } from './prisma.service';

/**
 * Next value of the shared withdrawal-reference counter (H-13).
 *
 * The franchise-owner and courier cash-out tables both carry a UNIQUE `reference`, and
 * both used to mint it from four random digits — so a collision was not a cosmetic
 * duplicate, it was a 500 on someone's money. `nextval` is safe across concurrent
 * sessions and transactions; one sequence covers both tables because all the reference
 * has to be is distinct.
 */
export async function nextReferenceSequence(prisma: PrismaService): Promise<number> {
  const rows = await prisma.$queryRaw<
    { v: bigint }[]
  >`SELECT nextval('withdrawal_reference_seq') AS v`;
  return Number(rows[0]?.v ?? 0);
}
