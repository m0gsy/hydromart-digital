// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Four customer screens.
 *
 *  - CA-3-62: the cart's LINES were fixed; the add-on strip under them still drew a grey
 *    droplet for every card — four identical tiles above four different products, on the
 *    screen where somebody checks what they are about to buy.
 *  - CA-3-63: `imageUrl ? <RemoteImage/> : <Drop/>` covers a MISSING photo. A photo that is
 *    present but DEAD fell through to `fallback`, which defaults to null.
 *  - CA-3-67: every button in the change-phone block is `type="button"`, so the buttons were
 *    never the problem. Implicit submission was: Enter in the number field submitted the
 *    profile form and saved the profile instead of sending the code.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', phone: '0811' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account/edit',
  useSearchParams: () => new URLSearchParams(),
}));

import { ChangePhone } from '@/app/account/edit/change-phone';

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('CA-3-67 Enter in the change-phone block sends the code', () => {
  it('does not submit the profile form it lives inside', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ChangePhone currentPhone="0811" />
        <button type="submit">Simpan</button>
      </form>,
    );

    // The block starts collapsed; opening it is what the customer does first.
    await userEvent.click(await screen.findByText('hrFix.accountEdit.changePhone'));
    const field = await screen.findByLabelText('hrFix.accountEdit.newPhone');
    await userEvent.type(field, '081298765432{Enter}');

    // The whole defect: Enter used to save the profile and never send a code.
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});

describe('CA-3-62 and CA-3-63 — the product pictures', () => {
  const code = async (f: string) => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(f, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  };

  it('asks the catalogue for the add-on photos the recommender does not carry', async () => {
    const src = await code('src/app/cart/page.tsx');
    // recommendation-service answers ids and names, never photos. The helper that batches
    // the catalogue lookup already existed — the product page's own "Sering dibeli bersama"
    // uses it — and the cart's add-on strip simply never called it.
    expect(src).toContain('useRecommendationProducts(recs.data)');
    expect(src).toContain('addOnProducts.get(rec.productId)?.imageUrl');
  });

  it('gives every customer-facing product image somewhere to land when the URL is dead', async () => {
    for (const f of [
      'src/components/product-card.tsx',
      'src/app/products/detail/page.tsx',
      'src/app/cart/page.tsx',
    ]) {
      const src = await code(f);
      for (const [, tag] of src.matchAll(/<RemoteImage\b([\s\S]{0,600}?)\/>/g)) {
        // A missing photo was handled by a ternary; a photo that is present but broken fell
        // through to `fallback`, which defaults to null — an empty tinted box.
        expect(tag).toContain('fallback=');
      }
    }
  });
});
