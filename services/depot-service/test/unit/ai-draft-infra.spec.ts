import { DepotConfigService } from '../../src/config/depot-config.service';
import { DraftSource } from '../../src/domain/draft-source';
import { DepotAuditSink } from '../../src/infrastructure/http/audit.sink';
import { PriceOverrideProposalPrismaRepository } from '../../src/infrastructure/prisma/price-override-proposal.prisma.repository';
import { PurchaseOrderPrismaRepository } from '../../src/infrastructure/prisma/purchase-order.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/*
 * HD-17: the audit sink the AI draft routes write to, and the two lookups by AI suggestion id
 * (the unique key a retry finds its draft by).
 */
describe('DepotAuditSink', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (key = 'internal-key') =>
    ({ authServiceUrl: 'http://auth:3001', internalServiceKey: key }) as DepotConfigService;

  it('posts to the shared ingest under the depot namespace; the pre-write throws, the outcome never does', async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = jest.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 201 } as never;
    }) as never;
    await new DepotAuditSink(config()).record({ action: 'ai.drafts.created' });
    await new DepotAuditSink(config()).recordOrThrow({ action: 'ai.drafts.created.requested' });
    expect(bodies.map((b) => b.action)).toEqual([
      'depot.ai.drafts.created',
      'depot.ai.drafts.created.requested',
    ]);

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;
    await expect(new DepotAuditSink(config()).record({ action: 'a' })).resolves.toBeUndefined();
    await expect(new DepotAuditSink(config()).recordOrThrow({ action: 'a' })).rejects.toThrow();
    await expect(new DepotAuditSink(config('')).recordOrThrow({ action: 'a' })).rejects.toThrow(
      'not configured',
    );
  });
});

describe('findByAiSuggestionId', () => {
  const ID = '5c1e2f3a-0000-4000-8000-000000000003';

  it('finds a price proposal by its suggestion id, and maps the AI fields', async () => {
    const row = {
      id: 'p1',
      depotId: 'd1',
      depotName: 'A',
      productId: 'pr',
      productName: 'Galon',
      currentPrice: '20000',
      adjustType: 'PERCENT',
      value: '-10',
      note: null,
      status: 'PENDING',
      proposedBy: 'u',
      decidedBy: null,
      decisionReason: null,
      source: 'AI',
      aiSuggestionId: ID,
      aiReason: 'Karena.',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findUnique = jest.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    const repo = new PriceOverrideProposalPrismaRepository({
      priceOverrideProposal: { findUnique },
    } as unknown as PrismaService);
    await expect(repo.findByAiSuggestionId(ID)).resolves.toMatchObject({
      source: DraftSource.AI,
      aiSuggestionId: ID,
      aiReason: 'Karena.',
      currentPrice: 20000,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { aiSuggestionId: ID } });
    await expect(repo.findByAiSuggestionId(ID)).resolves.toBeNull();
  });

  it('finds a purchase order by its suggestion id', async () => {
    const row = { id: 'po1', source: 'AI', aiSuggestionId: ID, aiReason: 'x', status: 'DRAFT', lines: [] };
    const findUnique = jest.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    const repo = new PurchaseOrderPrismaRepository({
      purchaseOrder: { findUnique },
    } as unknown as PrismaService);
    await expect(repo.findByAiSuggestionId(ID)).resolves.toMatchObject({
      id: 'po1',
      source: DraftSource.AI,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { aiSuggestionId: ID } });
    await expect(repo.findByAiSuggestionId(ID)).resolves.toBeNull();
  });
});
