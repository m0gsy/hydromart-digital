import { AiCampaignPrismaRepository } from '../../src/infrastructure/prisma/ai-campaign.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H4 part 2 (O-09) against a real Postgres: only campaigns that FINISHED sending count, dated by
 * the instant they finished (half-open), with their recipients by outcome.
 */
describeRace('AI campaign totals against a real database', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiCampaignPrismaRepository;
  const from = new Date('2026-09-30T17:00:00.000Z');
  const to = new Date('2026-10-31T17:00:00.000Z');

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiCampaignPrismaRepository(prisma as never);
  });
  afterAll(async () => drop());

  const campaign = async (status: string, sentAt: Date | null, recipients: { status: string }[]) =>
    prisma.campaign.create({
      data: {
        name: 'Promo',
        messageTemplate: 'Halo',
        status: status as never,
        createdBy: 'u1',
        sentAt,
        recipients: { create: recipients.map((r, i) => ({ phone: `0812000${i}${Math.random().toString().slice(2, 8)}`, status: r.status as never })) },
      },
    });

  it('counts finished campaigns by the instant they finished and their recipients by outcome', async () => {
    await campaign('SENT', from, [{ status: 'SENT' }, { status: 'SENT' }, { status: 'FAILED' }]); // at the start: in
    await campaign('COMPLETED_WITH_FAILURES', new Date('2026-10-15T03:00:00Z'), [{ status: 'SENT' }, { status: 'SKIPPED' }, { status: 'PENDING' }]);
    await campaign('SENT', to, [{ status: 'SENT' }]); // at the end: out
    await campaign('SENDING', null, [{ status: 'SENT' }]); // still sending: not final
    await campaign('CANCELLED', new Date('2026-10-16T03:00:00Z'), [{ status: 'SKIPPED' }]); // cancelled: not finished
    await expect(repo.totals(from, to)).resolves.toEqual({ campaigns: 2, sent: 3, failed: 1, skipped: 1, other: 1 });
    await expect(repo.totals(new Date('2020-01-01T00:00:00Z'), new Date('2020-02-01T00:00:00Z'))).resolves.toEqual({
      campaigns: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      other: 0,
    });
  });
});
