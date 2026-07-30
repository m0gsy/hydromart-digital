import { BadRequestException } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';

import { GlobalValidationPipe } from './validation.pipe';

class CreateOrderDto {
  @IsString()
  productId!: string;

  @IsInt()
  quantity!: number;
}

const meta = { type: 'body' as const, metatype: CreateOrderDto };

/**
 * The two settings that actually matter here are `forbidNonWhitelisted` and
 * `enableImplicitConversion: false`. Together they mean a client cannot smuggle an
 * extra field past a DTO, and cannot pass "5" where a number is required and have
 * the pipe quietly agree.
 */
describe('GlobalValidationPipe', () => {
  const pipe = new GlobalValidationPipe();

  it('transforms a valid payload into the DTO class', async () => {
    const out = await pipe.transform({ productId: 'p1', quantity: 2 }, meta);
    expect(out).toBeInstanceOf(CreateOrderDto);
    expect(out).toEqual({ productId: 'p1', quantity: 2 });
  });

  it('rejects an unknown property instead of silently stripping it', async () => {
    await expect(
      pipe.transform({ productId: 'p1', quantity: 2, isAdmin: true }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a string where an int is declared (no implicit conversion)', async () => {
    await expect(pipe.transform({ productId: 'p1', quantity: '2' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a missing required field', async () => {
    await expect(pipe.transform({ productId: 'p1' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
