# Query bounds

Every read has a ceiling. This is where the ceilings are and which one to reach for.

Written closing PR6 of the merged audit (H-39, H-43…H-48, D-1…D-7, Q-16).

## The three bounds

**1. The net — `queryBoundsMiddleware` (`@hydromart/platform`).**
Installed by every service's `PrismaService`. Any `findMany` that did not set `take` gets
`take: 500`. A caller that passes its own `take` keeps it. When a capped query comes back
holding exactly the cap, the service logs a warning naming the model — a truncated read
nobody notices is the same defect wearing a smaller number.

This is a safety net, not a design. It exists because 129 `findMany` calls had no bound at
all and the next new one would have had none either. **Do not rely on it for a read that
must be complete** — see the next bound.

Its known edge: Prisma middleware only sees top-level operations, so a nested `include`
still returns the whole relation. Bound those on the relation's own repository method.

**2. The walk — `readAllPages` (`@hydromart/platform`).**
For reads that must return their whole window: exports, month-end reports, reconciliation.
Keyset pages, so peak memory is one page; an `onOverflow` callback that never returns, so
the caller raises its own domain error instead of serving part of a month.

```ts
readAllPages(
  ({ take, cursor }) => this.prisma.thing.findMany({
    where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],   // id last: deterministic cursor
    take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  }),
  { pageSize: 500, max: 20_000, onOverflow: () => { throw new ReportRangeTooLargeError(20_000); } },
)
```

A report that silently stops at row 500 returns a revenue number that looks right and is
not. Refusing the range is the lesser harm; truncating it is a liability.

**3. The request — DTO decorators.**
`@Max` on every `page` (1000), `limit`/`pageSize` (100), and window param, and
`@IsWithinDays('from')` on every report/export date range (366 days by default). A report
reads every row in its window, so bounding the page size does nothing for it — the window
itself has to be bounded.

## Indexes

Index choices follow the query shapes, not intuition: `stock_movements` on
`(itemId, createdAt)` and `(type, createdAt)`, `orders` on `(customerId|status|depotId,
createdAt)`, `customer_profiles` on `favoriteDepotId`, `notifications` on
`(event, createdAt)`.

Single-column indexes that are the leftmost prefix of a composite were dropped rather than
kept — Postgres uses the composite for the same equality lookup, and every extra index is
another b-tree written on each INSERT.

### Adding one (H-39)

`CREATE INDEX` locks writes on the table for the whole build; `CREATE INDEX CONCURRENTLY`
does not, but cannot run inside a transaction — which is where Prisma Migrate puts a
migration file. So:

1. add the `CREATE INDEX CONCURRENTLY IF NOT EXISTS` line to `scripts/create-indexes.sh`
2. add the plain `CREATE INDEX IF NOT EXISTS` to the migration, same index name
3. production runs `scripts/create-indexes.sh` **before** `scripts/migrate-prod.sh`; the
   migration then finds the index already there. A fresh database builds it in the
   migration, where locking an empty table costs nothing.

`scripts/check-index-concurrency.mjs` fails CI if a migration dated after 2026-08-04 adds
an index with no entry in the runner.

## Known debt

- **D-6 — response DTOs.** 558 routes still declare no response shape, so the OpenAPI
  document describes what endpoints are for and not what they return. That is also why the
  web client's `endpoints.ts` is hand-maintained (F-17).
  `scripts/check-api-responses.mjs` holds the line: a new undocumented route fails CI, and
  `--update` re-records the baseline once you have lowered it.
- **Q-16 — OFFSET pagination.** List endpoints still page with `skip: (page-1) * limit`.
  Bounded now (page ≤ 1000) and index-backed, so the cost has a ceiling, but a deep page
  still scans everything before it. Keyset pagination is the real fix and changes the
  client contract, so it belongs with the frontend work.
- **D-7** is the audit's reference map rather than a finding: the per-service
  `findMany`-without-`take` ratio. It was the targeting data for the work above; the ratio
  is what the middleware now bounds, and the report reads are the ones that got a real
  walk. The per-page fetch-count half of it belongs to F-1.
