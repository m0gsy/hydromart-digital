import { Injectable, ValidationPipe } from '@nestjs/common';

/**
 * Strict global validation: strips unknown properties, rejects requests that carry
 * any, and transforms payloads into DTO instances. Applied to every route.
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
}
