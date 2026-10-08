// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get, getCached: get }, ApiError: class ApiError extends Error {} }));

import { CategorySelect, DepotSelect, ProductSelect } from '@/components/catalog-select';

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 100 });

afterEach(() => vi.clearAllMocks());

describe('catalog pickers', () => {
  it('lists real products and reports the chosen id', async () => {
    get.mockResolvedValue(page([{ id: 'p-1', name: 'Galon 19L' }, { id: 'p-2', name: 'Botol 600ml' }]));
    const onChange = vi.fn();
    render(<ProductSelect value="" onChange={onChange} emptyLabel="Semua produk" />);
    await screen.findByRole('option', { name: 'Galon 19L' });
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'p-2');
    expect(onChange).toHaveBeenCalledWith('p-2');
  });

  it('lists categories and depots', async () => {
    get.mockImplementation(async (path: string) =>
      String(path).includes('categories') ? [{ id: 'c-1', name: 'Air' }] : page([{ id: 'd-1', name: 'Depot Satu' }]),
    );
    render(
      <>
        <CategorySelect value="" onChange={() => {}} emptyLabel="Semua kategori" />
        <DepotSelect value="" onChange={() => {}} emptyLabel="Semua depot" />
      </>,
    );
    expect(await screen.findByRole('option', { name: 'Air' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Depot Satu' })).toBeTruthy();
  });

  it('keeps a saved id selectable when the list does not contain it or cannot load', async () => {
    get.mockRejectedValue(new Error('down'));
    render(<ProductSelect value="saved-id" onChange={() => {}} emptyLabel="Semua produk" />);
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(select.value).toBe('saved-id');
  });
});
