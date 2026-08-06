import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** A year and a day: long enough for any year-on-year report, short enough to bound the scan. */
export const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Bounds how wide a date range may be. Put it on the upper bound and name the lower one, the
 * same way as {@link IsNotBefore}.
 *
 * Reports and exports read every row in their window, so an unbounded window is an unbounded
 * query: `?from=1970-01-01&to=2100-01-01` costs whatever the table happens to hold. Capping the
 * page size does not help those endpoints — they are supposed to return the whole window — so
 * the bound has to be on the window itself.
 *
 * Only fires when both bounds are present and parseable; a missing or malformed bound is left
 * to @IsOptional / @IsISO8601 so one mistake is never reported twice. An open-ended range (only
 * `from`, or only `to`) is therefore NOT bounded by this rule — endpoints that must never be
 * open-ended make both bounds required.
 */
export function IsWithinDays(
  lowerBoundProperty: string,
  maxDays: number = MAX_RANGE_DAYS,
  validationOptions?: ValidationOptions,
) {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isWithinDays',
      target: object.constructor,
      propertyName,
      constraints: [lowerBoundProperty, maxDays],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [lowerKey, limit] = args.constraints as [string, number];
          const lower = (args.object as Record<string, unknown>)[lowerKey];
          if (typeof value !== 'string' || typeof lower !== 'string') return true;
          const upperMs = Date.parse(value);
          const lowerMs = Date.parse(lower);
          if (Number.isNaN(upperMs) || Number.isNaN(lowerMs)) return true;
          return upperMs - lowerMs <= limit * MS_PER_DAY;
        },
        defaultMessage(args: ValidationArguments): string {
          const [lowerKey, limit] = args.constraints as [string, number];
          return `rentang ${lowerKey}..${args.property} maksimal ${limit} hari`;
        },
      },
    });
  };
}
