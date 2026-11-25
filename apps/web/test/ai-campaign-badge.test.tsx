// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HD-17, the screens: a campaign draft the AI web made says so, with the AI's reason, in the
 * campaign list and in its report. Nothing else changes: a person still presses Kirim.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

import { CampaignList } from '@/components/campaigns/campaign-list';
import { CampaignReport } from '@/components/dashboard/campaign-report';

const campaign = (over: object) => ({
  id: 'c1',
  name: 'Promo galon',
  channel: 'IN_APP',
  status: 'DRAFT',
  totalRecipients: 12,
  sentCount: 0,
  failedCount: 0,
  createdBy: 'u1',
  createdAt: '2026-11-26T00:00:00.000Z',
  sentAt: null,
  scheduledFor: null,
  ...over,
});

beforeEach(() => get.mockReset());

describe('campaign list', () => {
  const list = (items: object[]) =>
    get.mockResolvedValue({ items, total: items.length, page: 1, limit: 50, totalPages: 1 });

  it('marks an AI draft, shows the reason, and keeps the Kirim button for who may send', async () => {
    list([campaign({ source: 'AI', aiReason: 'Pelanggan lama tidak memesan.' })]);
    render(<CampaignList canManage emptyHint="kosong" />);
    expect(await screen.findByText('dashboard.campaigns.aiBadge')).toBeTruthy();
    expect(screen.getByText('Pelanggan lama tidak memesan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /dashboard.campaigns.sendNow/ })).toBeTruthy();
  });

  it('shows nothing extra on a staff campaign or an older response', async () => {
    list([campaign({ source: 'STAFF', aiReason: null }), campaign({ id: 'c2' })]);
    render(<CampaignList canManage emptyHint="kosong" />);
    await screen.findAllByText('Promo galon');
    expect(screen.queryByText('dashboard.campaigns.aiBadge')).toBeNull();
    expect(screen.queryByText('dashboard.campaigns.aiReason:')).toBeNull();
  });
});

describe('campaign report', () => {
  const detail = (over: object) => ({ ...campaign(over), messageTemplate: 'Hai', updatedAt: '2026-11-26T00:00:00.000Z', recipients: [] });

  it('marks an AI draft and shows the reason', async () => {
    get.mockResolvedValue(detail({ source: 'AI', aiReason: 'Stok melimpah.' }));
    render(<CampaignReport campaignId="c1" onClose={() => undefined} />);
    expect(await screen.findByText('dashboard.campaigns.aiBadge')).toBeTruthy();
    expect(screen.getByText('Stok melimpah.')).toBeTruthy();
  });

  it('shows nothing extra on a staff campaign', async () => {
    get.mockResolvedValue(detail({ source: 'STAFF' }));
    render(<CampaignReport campaignId="c1" onClose={() => undefined} />);
    await screen.findByText('Promo galon');
    expect(screen.queryByText('dashboard.campaigns.aiBadge')).toBeNull();
  });
});

describe('dictionaries', () => {
  it('have the AI badge and reason in both languages', async () => {
    const { id } = await import('@/lib/dictionaries/id');
    const { en } = await import('@/lib/dictionaries/en');
    expect(id.dashboard.campaigns.aiBadge).toBe('Usulan AI');
    expect(id.dashboard.campaigns.aiReason).toBe('Alasan AI');
    expect(en.dashboard.campaigns.aiBadge).toBe('AI suggestion');
    expect(en.dashboard.campaigns.aiReason).toBe('AI reason');
  });
});
