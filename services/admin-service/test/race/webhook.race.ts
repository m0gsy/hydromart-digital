import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WebhookDeliveryPrismaRepository } from '../../src/infrastructure/prisma/webhook-delivery.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('webhook deliveries on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: WebhookDeliveryPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new WebhookDeliveryPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const endpoint = () =>
    prisma.webhookEndpoint.create({
      data: {
        url: `https://partner.example.com/${randomUUID()}`,
        events: ['x'],
        active: true,
        secret: 'a'.repeat(64),
      },
    });
  const delivery = (endpointId: string) =>
    prisma.webhookDelivery.create({
      data: { endpointId, event: 'x', payload: {}, nextAttemptAt: new Date(Date.now() - 1000) },
    });

  it('two overlapping sweeps never claim the same delivery', async () => {
    const ep = await endpoint();
    const ids = new Set<string>();
    for (let i = 0; i < 12; i++) ids.add((await delivery(ep.id)).id);
    const now = new Date();
    const [a, b] = await race([
      () => repo.claimDue(now, 12, 300_000),
      () => repo.claimDue(new Date(now.getTime() + 1), 12, 300_000),
    ]);
    const claimedA = (a as PromiseFulfilledResult<{ id: string }[]>).value.map((d) => d.id);
    const claimedB = (b as PromiseFulfilledResult<{ id: string }[]>).value.map((d) => d.id);
    expect(claimedA.filter((id) => claimedB.includes(id))).toEqual([]);
  });

  it('a sweep whose lease lapsed cannot overwrite the sweep that re-claimed the delivery', async () => {
    const ep = await endpoint();
    const d = await delivery(ep.id);
    const t0 = new Date();
    const [first] = await repo.claimDue(t0, 5, 1_000);
    // The lease runs out and a second sweep takes the row.
    const [second] = await repo.claimDue(new Date(t0.getTime() + 2_000), 5, 300_000);
    expect(first.id).toBe(d.id);
    expect(second.id).toBe(d.id);

    await repo.markDelivered(d.id, 200, new Date(), second.leaseUntil);
    // The first sweep finishes late, with the lease it no longer holds.
    await repo.markRetry(d.id, 1, new Date(), 'late timeout', 504, first.leaseUntil);

    const row = (await prisma.webhookDelivery.findUnique({ where: { id: d.id } }))!;
    expect(row.status).toBe('DELIVERED');
    expect(row.lastError).toBeNull();
  });

  /*
   * HD-7: "secret wajib" held by the column itself, so no code path (an old release mid-deploy,
   * a raw write, a future endpoint) can leave a delivery unsigned.
   */
  it('refuses an endpoint with no secret or a short one', async () => {
    const id = randomUUID();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "webhook_endpoints" ("id", "url", "events") VALUES ('${id}', 'https://x.example.com', '{x}')`,
      ),
    ).rejects.toThrow(/23502/); // not_null_violation
    await expect(
      prisma.webhookEndpoint.create({
        data: { url: 'https://x.example.com', events: ['x'], secret: 'a'.repeat(31) },
      }),
    ).rejects.toThrow(/webhook_endpoints_secret_length/);
    await expect(
      prisma.webhookEndpoint.update({ where: { id: (await endpoint()).id }, data: { secret: '' } }),
    ).rejects.toThrow(/webhook_endpoints_secret_length/);
  });

  // The migration and its rollback, run for real: the rollback lets the old rows back in, the
  // migration fixes exactly those rows, and running it a second time changes nothing.
  it('the migration gives an endpoint without a usable secret a random one, and runs twice', async () => {
    const dir = join(__dirname, '../../prisma/migrations/20261122220000_webhook_secret_required');
    const statements = (file: string): string[] =>
      readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^(BEGIN|COMMIT)$/i.test(s));
    const run = async (file: string) => {
      for (const sql of statements(file)) await prisma.$executeRawUnsafe(sql);
    };

    const kept = await endpoint();
    await run('rollback.sql');
    const [none, short] = [randomUUID(), randomUUID()];
    await prisma.$executeRawUnsafe(
      `INSERT INTO "webhook_endpoints" ("id", "url", "events", "secret") VALUES
         ('${none}', 'https://a.example.com', '{x}', NULL),
         ('${short}', 'https://b.example.com', '{x}', 'kunci-pendek')`,
    );

    await run('migration.sql');
    const secretOf = async (id: string) =>
      (await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).secret;
    expect(await secretOf(none)).toMatch(/^[0-9a-f]{64}$/);
    expect(await secretOf(short)).toMatch(/^[0-9a-f]{64}$/);
    expect(await secretOf(none)).not.toBe(await secretOf(short));
    expect(await secretOf(kept.id)).toBe(kept.secret);

    const before = await secretOf(none);
    await run('migration.sql');
    expect(await secretOf(none)).toBe(before);
    await expect(
      prisma.webhookEndpoint.create({ data: { url: 'https://c.example.com', events: ['x'], secret: 'x' } }),
    ).rejects.toThrow(/webhook_endpoints_secret_length/);
  });
});
