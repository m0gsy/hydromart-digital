// @vitest-environment jsdom
/**
 * P3-3. Suspending a depot re-routes its subscribers on the next sweep — to a neighbour, or to
 * nobody. The suspend dialog says how many before the code is typed, from the server's dry run.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, post, del: vi.fn() } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { DepotSuspendDialog } from '@/components/hq/depot-suspend-dialog';

afterEach(() => vi.clearAllMocks());

const depot = { id: 'd-1', code: 'BDG01', name: 'Depot Bandung' };
const draw = () =>
  render(
    <LocaleProvider>
      <DepotSuspendDialog depot={depot} onClose={vi.fn()} onSuspended={vi.fn()} />
    </LocaleProvider>,
  );

describe('the suspend dialog counts the subscriptions it re-routes', () => {
  it('asks the dry run for this depot going inactive, and says who is left unserved', async () => {
    get.mockResolvedValue({ items: [], total: 0 });
    post.mockResolvedValue({ affected: 7, unserved: 2, moves: [] });
    draw();

    expect(await screen.findByText('7')).toBeTruthy();
    expect(screen.getByText('2 tak terjangkau depot lain')).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/admin/reroute-preview'),
      { depotId: 'd-1', active: false },
      true,
    );
  });

  it('shows a dash, not a reassuring 0, when the dry run fails', async () => {
    get.mockResolvedValue({ items: [], total: 0 });
    post.mockRejectedValue(new Error('down'));
    draw();

    expect(await screen.findByText('—')).toBeTruthy();
    expect(screen.queryByText(/tak terjangkau/)).toBeNull();
  });
});
