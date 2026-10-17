import { describe, expect, it, vi } from 'vitest';

import { whenOrderKnown } from '@/lib/order-id';

describe('whenOrderKnown — no API call for an order that has no id yet', () => {
  it('does not call the API, and does not settle, while the id is empty', async () => {
    const load = vi.fn(async (id: string) => id);
    const settled = vi.fn();
    void whenOrderKnown('', load).then(settled, settled);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });

  it('loads normally once there is an id', async () => {
    await expect(whenOrderKnown('o-1', async (id) => `order ${id}`)).resolves.toBe('order o-1');
  });
});
