// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ locale: 'id', t: (k: string) => k }) }));
vi.mock('@/lib/attribution', () => ({ readSources: () => ({}) }));
vi.mock('@/lib/geo', () => ({ currentPosition: vi.fn() }));

import FranchiseApplicationPage from '@/app/waralaba/page';
import { franchise } from '@/lib/dictionaries/id/franchise';

// The city and province go into an email sent from our own address: a web address typed there
// is refused in the browser first (the servers refuse it too).
async function fill(city: string, province = 'Jawa Barat') {
  const u = userEvent.setup();
  render(<FranchiseApplicationPage />);
  const type = async (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    await u.clear(el);
    await u.type(el, v);
  };
  await type('fa-name', 'Budi');
  await type('fa-phone', '081234567890');
  await type('fa-code', 'bdg-02');
  await type('fa-depot-name', 'Depot Buah Batu');
  await type('fa-city', city);
  await type('fa-province', province);
  await type('fa-lat', '-6.9');
  await type('fa-lng', '107.6');
  await type('fa-investment', '150000000');
  await type('fa-revenue', '45000000');
  await u.click(screen.getByRole('checkbox'));
  await u.click(screen.getByRole('button', { name: franchise.submit }));
}

describe('waralaba place names', () => {
  beforeEach(() => post.mockReset());

  it('refuses a city that looks like a web address and sends nothing', async () => {
    await fill('evil.com');
    expect(await screen.findByText(franchise.badCity)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a province that looks like a web address and sends nothing', async () => {
    await fill('Bandung', 'x.co.id');
    expect(await screen.findByText(franchise.badProvince)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends a real place name', async () => {
    post.mockResolvedValue({ id: 'a', proposedCode: 'BDG-02', proposedName: 'x', submittedAt: '2026-11-24T00:00:00Z' });
    await fill('Kab. Bekasi');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ city: 'Kab. Bekasi', province: 'Jawa Barat' });
  });
});
