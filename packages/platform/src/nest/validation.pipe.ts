import { ArgumentMetadata, BadRequestException, Injectable, ValidationPipe } from '@nestjs/common';

/** True when any string anywhere inside `value` carries a NUL (\u0000) character. */
function hasNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasNul);
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasNul);
  return false;
}

/**
 * Strict global validation: strips unknown props, rejects extras, transforms to DTOs.
 *
 * Also refuses a NUL (\u0000) anywhere in a body, query or parameter. Postgres cannot store one
 * in a text column, so the INSERT used to throw and the caller got a bare 500 for something a
 * person or a scanner typed into a form field. It is bad input: a 400, decided here once for
 * every service rather than as a check in every DTO.
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type !== 'custom' && hasNul(value)) {
      throw new BadRequestException([
        'the request contains a NUL (\\u0000) character, which cannot be stored',
      ]);
    }
    return super.transform(value, metadata);
  }
}
