/**
 * The largest values a column can hold, for `@Max(...)` on the DTOs that write them.
 *
 * 116 numeric DTO fields carried no upper bound, so a price typed with two extra zeros reached
 * Postgres and came back as 22003 "integer out of range" — a 500 and a Sentry page until the
 * gateway-wide 422 net (AllExceptionsFilter), and even then a refusal that could not name the
 * field. With the column's own limit on the DTO, the 400 names it before anything is written.
 */

/** A Postgres `integer` (int4) column: every Prisma `Int`. */
export const INT4_MAX = 2_147_483_647;

/**
 * The largest whole value a `Decimal(precision, scale)` column holds: 10^(precision - scale) - 1.
 * `@db.Decimal(12, 2)` holds up to 9 999 999 999.99, so the bound is 9 999 999 999.
 */
export function decimalMax(precision: number, scale: number): number {
  return 10 ** (precision - scale) - 1;
}

/**
 * A span in days a filter may ask for: one hundred years. A day count is turned into a timestamp
 * in SQL, and one past what a timestamp can hold fails with 22008, which the 22003 net does not
 * catch. Far beyond any real "customers lapsed for N days".
 */
export const MAX_DAYS = 36_500;
