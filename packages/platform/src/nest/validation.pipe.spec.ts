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

  // Postgres cannot store a NUL (\u0000) in a text column: the insert throws and the caller got a
  // bare 500 for a form field a person (or a scanner) typed. It is bad input, so it is a 400 —
  // here once, for every service, instead of a check in every DTO.
  describe('NUL characters', () => {
    class AddressDto {
      @IsString()
      line!: string;
    }
    const addr = { type: 'body' as const, metatype: AddressDto };

    it('rejects a string carrying a NUL byte', async () => {
      await expect(pipe.transform({ line: 'Jl. Mawar\u0000 1' }, addr)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('finds one nested inside objects and arrays, and in a query string', async () => {
      class Nested {
        items!: { tags: string[] }[];
      }
      await expect(
        pipe.transform(
          { items: [{ tags: ['ok', 'bad\u0000'] }] },
          { type: 'body', metatype: undefined },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        pipe.transform({ q: 'a\u0000b' }, { type: 'query', metatype: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(Nested).toBeDefined();
    });

    it('says what is wrong in the standard validation shape', async () => {
      await expect(pipe.transform({ line: 'x\u0000' }, addr)).rejects.toMatchObject({
        response: { message: [expect.stringMatching(/NUL/)] },
      });
    });

    it('lets everything else through: emoji, accents, newlines, tabs, quotes, markup', async () => {
      const line = '🚰 Ñandú “x”\n\t<b>1</b> \'; DROP TABLE a;--';
      const out = await pipe.transform({ line }, addr);
      expect(out).toEqual({ line });
    });

    it('does not trip on values that are not strings or have no body', async () => {
      await expect(pipe.transform(undefined, addr)).rejects.toBeInstanceOf(BadRequestException);
      expect(await pipe.transform(5, { type: 'param', metatype: undefined })).toBe(5);
      expect(await pipe.transform(null, { type: 'custom', metatype: undefined })).toBeNull();
    });
  });

  it('rejects a missing required field', async () => {
    await expect(pipe.transform({ productId: 'p1' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
