import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PdpAnonymiseDto } from '../../src/modules/dto/loyalty.dto';

describe('PdpAnonymiseDto', () => {
  it('accepts the body auth-service really sends (customerId + phone)', async () => {
    const dto = plainToInstance(PdpAnonymiseDto, {
      customerId: '00000000-0000-4000-8000-000000000001',
      phone: '+628123456789',
    });
    // The global pipe is forbidNonWhitelisted: an undeclared `phone` was a 400 (G-150).
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });
});
