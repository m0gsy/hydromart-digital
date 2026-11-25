// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HD-17 part A, the screens: a draft the AI web made says so, with the AI's reason, on the two
 * screens a person decides it on. Nothing else about those screens changes: HQ still presses
 * Setujui / Tolak, staff still press Kirim.
 */
const { get, getCached, post } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ askReason: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams('id=po-1'),
}));

import PoDetailPage from '@/app/dashboard/purchase-orders/detail/page';
import HqPricingPage from '@/app/hq/pricing/page';

const proposal = (over: object) => ({
  id: 'p1',
  depotId: 'd1',
  depotName: 'Depot A',
  productId: 'pr1',
  productName: 'Galon 19L',
  currentPrice: 20000,
  adjustType: 'PERCENT',
  value: -10,
  note: null,
  status: 'PENDING',
  proposedBy: 'aaaaaaaa-0000-4000-8000-000000000000',
  proposedByName: 'Budi',
  decidedBy: null,
  createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
  ...over,
});

const po = (over: object) => ({
  id: 'po-1',
  poNumber: 'PO-AI000001',
  depotId: 'd1',
  supplierId: 's1',
  supplierName: 'Tirta Makmur',
  status: 'DRAFT',
  lines: [{ itemType: 'GALON', label: 'Galon 19L', quantity: 60, unitCostIdr: 18000 }],
  subtotalIdr: 1_080_000,
  shippingIdr: 0,
  totalIdr: 1_080_000,
  expectedAt: null,
  receivedAt: null,
  createdAt: '2026-11-25T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  for (const m of [get, getCached, post]) m.mockReset();
});

describe('/hq/pricing queue', () => {
  const queue = (items: object[]) =>
    get.mockImplementation(async (url: string) =>
      String(url).includes('count-by-product')
        ? []
        : String(url).includes('price-overrides')
          ? { items, total: items.length, page: 1, limit: 50 }
          : { items: [], total: 0, page: 1, limit: 50 },
    );

  it('marks an AI proposal and shows the reason', async () => {
    queue([proposal({ source: 'AI', aiReason: 'Pesaing turun 10%.' })]);
    render(<HqPricingPage />);
    expect(await screen.findByText('hq.pricing.queue.aiBadge')).toBeTruthy();
    expect(screen.getByText('Pesaing turun 10%.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hq.pricing.queue.approve' })).toBeTruthy();
  });

  it('shows nothing extra on a staff proposal', async () => {
    queue([proposal({ source: 'STAFF', aiReason: null }), proposal({ id: 'p2' })]);
    render(<HqPricingPage />);
    await screen.findAllByText('Galon 19L');
    expect(screen.queryByText('hq.pricing.queue.aiBadge')).toBeNull();
    expect(screen.queryByText('hq.pricing.queue.aiReason:')).toBeNull();
  });
});

describe('english dictionary', () => {
  it('has the AI badge and reason on both screens', async () => {
    const { hq } = await import('@/lib/dictionaries/en/hq');
    const { hrFix } = await import('@/lib/dictionaries/en/hrFix');
    expect(hq.pricing.queue.aiBadge).toBe('AI suggestion');
    expect(hq.pricing.queue.aiReason).toBe('AI reason');
    expect(hrFix.purchaseOrders.aiBadge).toBe('AI suggestion');
    expect(hrFix.purchaseOrders.aiReason).toBe('AI reason');
  });
});

describe('purchase order detail', () => {
  it('marks an AI draft and shows the reason', async () => {
    const draft = po({ source: 'AI', aiReason: 'Stok tinggal dua hari.' });
    get.mockResolvedValue(draft);
    getCached.mockResolvedValue(draft);
    render(<PoDetailPage />);
    expect(await screen.findByText('hrFix.purchaseOrders.aiBadge')).toBeTruthy();
    expect(screen.getByText('Stok tinggal dua hari.')).toBeTruthy();
  });

  it('shows nothing extra on a staff order', async () => {
    const staff = po({ source: 'STAFF' });
    get.mockResolvedValue(staff);
    getCached.mockResolvedValue(staff);
    render(<PoDetailPage />);
    await screen.findByText('PO-AI000001');
    expect(screen.queryByText('hrFix.purchaseOrders.aiBadge')).toBeNull();
  });
});
