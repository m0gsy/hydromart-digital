// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get },
  ApiError: class ApiError extends Error {},
}));

import { VoucherScopeNote } from '@/components/voucher-scope-note';
import { LocaleProvider } from '@/lib/locale-context';

const draw = (props: { productId?: string | null; categoryId?: string | null }) =>
  render(
    <LocaleProvider>
      <VoucherScopeNote {...props} />
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset().mockImplementation(async (path: string) =>
    String(path).includes('categories')
      ? [
          { id: 'c-1', name: 'Air' },
          { id: 'c-2', name: 'Snack' },
        ]
      : { id: 'p-1', name: 'Galon 19L' },
  );
});
afterEach(() => vi.clearAllMocks());

describe('voucher scope note on the wallet card', () => {
  it('says nothing for a whole-order voucher, and asks the catalogue for nothing', () => {
    const { container } = draw({ productId: null, categoryId: null });
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('names the product a voucher is limited to', async () => {
    draw({ productId: 'p-1' });
    expect(await screen.findByText('Khusus Galon 19L')).toBeTruthy();
  });

  it('names the category a voucher is limited to', async () => {
    draw({ categoryId: 'c-2' });
    expect(await screen.findByText('Khusus kategori Snack')).toBeTruthy();
  });

  it('still says it is limited, without a name, while loading', () => {
    get.mockImplementation(() => new Promise(() => {}));
    draw({ productId: 'p-1' });
    expect(screen.getByText('Khusus produk tertentu')).toBeTruthy();
  });

  it('falls back to the generic note when the name cannot be read', async () => {
    get.mockRejectedValue(new Error('down'));
    draw({ productId: 'p-1' });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByText('Khusus produk tertentu')).toBeTruthy();
  });

  it('falls back when the category is not in the list', async () => {
    draw({ categoryId: 'c-unknown' });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByText('Khusus produk tertentu')).toBeTruthy();
  });
});
