// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The hero's quick chips are shortcuts into the catalog's filter. They used to be three
 * hardcoded searches — tapping "Air botol" searched for the word "botol" and left the
 * catalog's category filter on "Semua", which is the bug this covers.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import { Hero } from '@/components/hero';

beforeEach(() => get.mockReset());

const href = (name: string) => screen.getByText(name).getAttribute('href');

describe('hero quick chips', () => {
  it('links to the real categories, by the id the catalog filters on', async () => {
    get.mockResolvedValue([
      { id: 'cat_1', name: 'Isi ulang galon', slug: 'isi-ulang', sortOrder: 1, active: true },
      { id: 'cat_2', name: 'Air botol', slug: 'botol', sortOrder: 2, active: true },
      { id: 'cat_3', name: 'Dispenser', slug: 'dispenser', sortOrder: 3, active: true },
      { id: 'cat_4', name: 'Aksesori', slug: 'aksesori', sortOrder: 4, active: true },
    ]);

    render(<Hero />);

    await waitFor(() => expect(href('Air botol')).toBe('/products?category=cat_2'));
    expect(href('Isi ulang galon')).toBe('/products?category=cat_1');
    // Three chips fit the row; the rest of the catalog is one tap further in.
    expect(screen.queryByText('Aksesori')).toBeNull();
  });

  it('falls back to the search chips when the catalog has no categories', async () => {
    get.mockResolvedValue([]);

    render(<Hero />);

    await waitFor(() => expect(href('home.hero.quick.bottled')).toBe('/products?search=botol'));
  });
});
