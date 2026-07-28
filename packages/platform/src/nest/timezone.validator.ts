import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * A real IANA timezone identifier ('Asia/Jakarta'), not merely a non-empty string.
 * Common Indonesian shorthand ('WIB', 'WITA') and UTC offsets ('GMT+7') are NOT IANA
 * zones: they carry no DST history and every date library rejects them downstream, so
 * storing one silently breaks every scheduled report and cut-off that reads it.
 *
 * Validated by asking Intl to build a formatter for the zone — the only zone database
 * already present in Node, so this adds no dependency.
 */
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.trim() === '') {
            return false;
          }
          // Intl accepts bare 'UTC' and offset-style ids on some runtimes; an IANA zone
          // always has a Region/Location form, so require it rather than trusting Intl alone.
          if (value !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+/-]+$/.test(value)) {
            return false;
          }
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value });
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} harus zona waktu IANA yang sah (mis. Asia/Jakarta), bukan singkatan seperti WIB atau GMT+7`;
        },
      },
    });
  };
}
