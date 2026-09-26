import { plainToInstance } from 'class-transformer';

import { RewardController } from '../../src/modules/reward.controller';
import { UpdateRewardItemDto } from '../../src/modules/dto/reward.dto';

/*
 * `seenUpdatedAt` is the version the client read, not a column (CA-2-53). The controller passed the
 * whole dto on as the patch, so the stamp reached `prisma.rewardItem.update({ data })` and Prisma
 * refused it: HTTP 500 on every reward edit the console made with the stamp. In-memory
 * repositories accept any object; only a real database could say so.
 */
describe('the freshness stamp does not reach the patch', () => {
  it('reward item', async () => {
    const item = { id: 'r', name: 'Voucher', unit: 'x', pointsCost: 500, imageUrl: null, stock: null, active: true, createdAt: new Date(), updatedAt: new Date() };
    const rewards = { updateItem: jest.fn().mockResolvedValue(item) };
    const dto = plainToInstance(UpdateRewardItemDto, { pointsCost: 600, seenUpdatedAt: '2026-09-26T06:00:00.000Z' });
    await new RewardController(rewards as never).updateItem('22222222-2222-4222-8222-222222222222', dto);
    const [, patch, seen] = rewards.updateItem.mock.calls[0];
    expect(seen).toBe('2026-09-26T06:00:00.000Z');
    expect(patch).not.toHaveProperty('seenUpdatedAt');
    expect(patch).toMatchObject({ pointsCost: 600 });
  });
});
