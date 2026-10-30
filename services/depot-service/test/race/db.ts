import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '../../prisma/generated/client';

/*
 * Real-Postgres harness for the race specs.
 *
 * The unit specs simulate an interleaving with fakes: they prove the loser's LOGIC, not that
 * Postgres actually serialises two writers. These run against a real database, so a
 * compare-and-set that does not hold under concurrency fails here.
 *
 * `RACE_DATABASE_URL` points at a throwaway Postgres (CI service container, or a local
 * `docker run postgres:16`). Each run migrates a fresh schema of its own, so nothing is shared
 * and nothing real is touched. Unset → the specs skip, they never fail a developer's laptop.
 */
export const RACE_URL = process.env.RACE_DATABASE_URL;

export function describeRace(name: string, fn: () => void): void {
  (RACE_URL ? describe : describe.skip)(name, fn);
}

export async function freshPrisma(): Promise<{ prisma: PrismaClient; drop: () => Promise<void> }> {
  const schema = `race_${randomBytes(4).toString('hex')}`;
  const url = `${RACE_URL}${RACE_URL!.includes('?') ? '&' : '?'}schema=${schema}`;
  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DEPOT_DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return {
    prisma,
    drop: async () => {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
    },
  };
}

/** Starts every task before awaiting any, so they overlap for real. */
export function race(tasks: Array<() => Promise<unknown>>): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(tasks.map((t) => t()));
}
