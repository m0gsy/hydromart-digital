import { plainToInstance } from 'class-transformer';

import { CategoryController } from '../../src/modules/category.controller';
import { ProductController } from '../../src/modules/product.controller';
import { UpdateCategoryDto } from '../../src/modules/dto/category.dto';
import { UpdateProductDto } from '../../src/modules/dto/product.dto';

/*
 * `seenUpdatedAt` is the version the client read, a token for the freshness check (CA-2-53) and
 * not a column. Both controllers passed the whole dto on as the patch, so the stamp reached
 * `prisma.product.update({ data })` and Prisma refused it — HTTP 500 on every catalog edit the
 * console made with the stamp it is now required to send. In-memory repositories accept any
 * object, so only a real database could say so.
 */
const SEEN = '2026-09-26T06:19:26.408Z';
const ID = '22222222-2222-4222-8222-222222222222';

describe('the freshness stamp does not reach the patch', () => {
  it('product', async () => {
    const svc = { update: jest.fn().mockResolvedValue({}) };
    const dto = plainToInstance(UpdateProductDto, { active: false, seenUpdatedAt: SEEN });
    await new ProductController(svc as never).update(ID, dto, { sub: 'u' } as never);
    const [, patch, seen, by] = svc.update.mock.calls[0];
    expect(seen).toBe(SEEN);
    expect(by).toBe('u');
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ active: false });
  });

  it('category', async () => {
    const svc = { update: jest.fn().mockResolvedValue({}) };
    const dto = plainToInstance(UpdateCategoryDto, { name: 'Air', seenUpdatedAt: SEEN });
    await new CategoryController(svc as never).update(ID, dto);
    const [, patch, seen] = svc.update.mock.calls[0];
    expect(seen).toBe(SEEN);
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ name: 'Air' });
  });
});
