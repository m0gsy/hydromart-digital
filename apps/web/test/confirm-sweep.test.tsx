// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Step 06 of the console-audit sweep: destructive actions ask before they act.
 *
 * `ConfirmDialog` shipped in M4 and reached 4 of 132 console pages, because it is a
 * controlled component and every call site had to carry its own state. `useConfirm()`
 * makes it one line, and these tests hold the line: each one drives a real screen and
 * asserts that the request does NOT go out until somebody says yes.
 */

const { get, post, patch, del, put } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, del, put },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'SUPER_ADMIN' }, loading: false }),
}));

import { ConfirmProvider, useConfirm } from '@/components/confirm';
import { CartProvider } from '@/lib/cart-context';
import { LocaleProvider } from '@/lib/locale-context';

const renderIn = (node: React.ReactElement, withCart = false) =>
  render(
    <LocaleProvider>
      <ConfirmProvider>{withCart ? <CartProvider>{node}</CartProvider> : node}</ConfirmProvider>
    </LocaleProvider>,
  );

/** The confirm button inside the dialog, not the page button that opened it. */
const dialogConfirm = async () =>
  within(await screen.findByRole('alertdialog')).getByRole('button', {
    name: /^Konfirmasi$|^Confirm$|^Kosongkan keranjang$|^Empty/i,
  });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  put.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('useConfirm', () => {
  function Probe({ reason }: { reason?: boolean }) {
    const { confirm, askReason } = useConfirm();
    const [answer, setAnswer] = useState<string>('—');
    return (
      <button
        onClick={async () => {
          const value = reason
            ? await askReason({ title: 'Judul', message: 'Pesan', label: 'Alasan' })
            : await confirm({ title: 'Judul', message: 'Pesan' });
          setAnswer(JSON.stringify(value));
        }}
      >
        go {answer}
      </button>
    );
  }

  it('resolves false when the dialog is dismissed rather than hanging forever', async () => {
    const user = userEvent.setup();
    renderIn(<Probe />);
    await user.click(screen.getByRole('button', { name: /go/ }));
    await user.click(await screen.findByRole('button', { name: /Batal|Cancel/i }));
    // A promise nobody settles leaves the caller's `busy` flag stuck true forever.
    await screen.findByRole('button', { name: /go false/ });
  });

  it('resolves true on confirm', async () => {
    const user = userEvent.setup();
    renderIn(<Probe />);
    await user.click(screen.getByRole('button', { name: /go/ }));
    await user.click(await dialogConfirm());
    await screen.findByRole('button', { name: /go true/ });
  });

  it('requires a reason, trims it, and starts blank every time', async () => {
    const user = userEvent.setup();
    renderIn(<Probe reason />);

    await user.click(screen.getByRole('button', { name: /go/ }));
    const ok = await dialogConfirm();
    // A blank reason read back later is evidence nobody wrote.
    expect((ok as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByRole('textbox'), '  motor mogok  ');
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    await user.click(ok);
    await screen.findByRole('button', { name: /go "motor mogok"/ });

    // Second opening must not inherit the first reason.
    await user.click(screen.getByRole('button', { name: /go/ }));
    expect((await screen.findByRole('textbox')).getAttribute('value')).not.toBe('motor mogok');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });
});

describe('destructive actions ask first', () => {
  it('CA-3-29 — emptying the cart', async () => {
    const CART = {
      items: [
        {
          productId: 'p-1',
          productName: 'Galon 19L',
          quantity: 2,
          unitPrice: 20000,
          lineTotal: 40000,
        },
      ],
      subtotal: 40000,
      depotId: null,
      pricingBasis: 'CATALOG',
      reseller: null,
    };
    get.mockResolvedValue(CART);
    const { default: CartPage } = await import('@/app/cart/page');
    const user = userEvent.setup();
    renderIn(<CartPage />, true);

    await user.click(await screen.findByRole('button', { name: /Kosongkan keranjang|Empty/i }));
    // The whole point: the request has NOT gone out yet.
    expect(del).not.toHaveBeenCalled();

    await user.click(await dialogConfirm());
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });
});

describe('hq/access matrix saves as one transaction', () => {
  it('CA-2-62 — one request for every change, not one request each', async () => {
    const { RbacMatrix } = await import('@/app/hq/access/rbac-matrix');
    get.mockResolvedValue({ defaults: {}, overrides: {}, effective: {} });
    put.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderIn(<RbacMatrix />);

    // Flip two capability cells, then save.
    const cells = await screen.findAllByRole('button', { pressed: false });
    expect(cells.length).toBeGreaterThan(1);
    await user.click(cells[0]!);
    await user.click(cells[1]!);
    await user.click(screen.getByRole('button', { name: /^Simpan|^Save/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0] ?? [];
    // A loop of one request per capability left the matrix half applied when one failed.
    expect(path).toBe('/auth/api/v1/access/matrix');
    expect(Array.isArray((body as { changes: unknown[] }).changes)).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });
});
