// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post, get, toast } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { post, get, getCached: get },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import HqVoucherFormPage from '@/app/hq/forms/voucher/page';

const T = idDict.hq.forms.voucher;
const PRODUCT = '0a1b2c3d-1111-4222-8333-444455556666';
const CATEGORY = '9f8e7d6c-1111-4222-8333-444455556666';

const draw = () =>
  render(
    <LocaleProvider>
      <HqVoucherFormPage />
    </LocaleProvider>,
  );

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(T.code), 'GALON20');
  await user.type(screen.getByLabelText(T.value), '20');
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) =>
    String(path).includes('categories')
      ? [{ id: CATEGORY, name: 'Air' }]
      : { items: [{ id: PRODUCT, name: 'Galon 19L' }], total: 1, page: 1, limit: 100 },
  );
});
afterEach(() => vi.clearAllMocks());

describe('hq voucher form · item scope (item 5 B)', () => {
  it('sends the product scope, and null for the other', async () => {
    const user = userEvent.setup();
    draw();
    await fillBasics(user);
    await screen.findByRole('option', { name: 'Galon 19L' });
    await user.selectOptions(screen.getByLabelText(T.scopeProduct), PRODUCT);
    await user.click(screen.getByRole('button', { name: T.publish }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toMatchObject({ productId: PRODUCT, categoryId: null });
  });

  it('sends null for both when left empty (whole order)', async () => {
    const user = userEvent.setup();
    draw();
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: T.publish }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toMatchObject({ productId: null, categoryId: null });
  });

  it('refuses both a product and a category before calling the server', async () => {
    const user = userEvent.setup();
    draw();
    await fillBasics(user);
    await screen.findByRole('option', { name: 'Galon 19L' });
    await screen.findByRole('option', { name: 'Air' });
    await user.selectOptions(screen.getByLabelText(T.scopeProduct), PRODUCT);
    await user.selectOptions(screen.getByLabelText(T.scopeCategory), CATEGORY);
    await user.click(screen.getByRole('button', { name: T.publish }));
    expect(await screen.findByText(T.scopeBoth)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('hides the scope fields for free shipping and never sends a scope', async () => {
    const user = userEvent.setup();
    draw();
    await user.type(screen.getByLabelText(T.code), 'ONGKIR20');
    await user.click(screen.getByText(T.freeShip));
    expect(screen.queryByLabelText(T.scopeProduct)).toBeNull();
    await user.click(screen.getByRole('button', { name: T.publish }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toMatchObject({ productId: null, categoryId: null });
  });
});
