import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Rejects a reversed date range on a query DTO: put it on the upper bound and name
 * the lower-bound property. A reversed range used to sail through every report
 * endpoint and silently return an empty result set, which reads as "no sales" rather
 * than "your filter is backwards".
 *
 * Both bounds are optional everywhere they are used, so the rule only fires when BOTH
 * are present and parseable — an absent or malformed bound is left to @IsOptional /
 * @IsISO8601 so this never double-reports the same field.
 *
 * Equal timestamps pass: `to` is an exclusive upper bound in these DTOs, so from == to
 * is a legitimately empty (not invalid) window.
 */
export function IsNotBefore(
  lowerBoundProperty: string,
  validationOptions?: ValidationOptions,
) {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isNotBefore',
      target: object.constructor,
      propertyName,
      constraints: [lowerBoundProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [lowerKey] = args.constraints as [string];
          const lower = (args.object as Record<string, unknown>)[lowerKey];
          if (typeof value !== 'string' || typeof lower !== 'string') {
            return true;
          }
          const upperMs = Date.parse(value);
          const lowerMs = Date.parse(lower);
          if (Number.isNaN(upperMs) || Number.isNaN(lowerMs)) {
            return true;
          }
          return upperMs >= lowerMs;
        },
        defaultMessage(args: ValidationArguments): string {
          const [lowerKey] = args.constraints as [string];
          return `${args.property} tidak boleh lebih awal dari ${lowerKey} (rentang tanggal terbalik)`;
        },
      },
    });
  };
}
