import { Injectable, ValidationPipe } from '@nestjs/common';

/** Strict global validation: strips unknown props, rejects extras, transforms to DTOs. */
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
