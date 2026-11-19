// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-1b of the flow plan: every door asks `canOpenRoute` (or the page's own gate) before it is
 * drawn, so a link either opens or is not there. Each case is a door that used to lead to a
 * page that does not exist, or to one that refuses the reader.
 */
const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));
const who = { role: 'SUPER_ADMIN', path: '/' };

vi.mock('@/lib/api', () => ({ api: { get, getCached, post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Uji', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => who.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], selectedId: 'd1', selected: null, scopedId: 'd1', setSelected: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ count: 0, subtotal: 0 }) }));
vi.mock('@/lib/unread', () => ({ useUnreadCount: () => 0, useOpsUnreadCount: () => 0 }));
vi.mock('@/components/location-selector', () => ({ LocationSelector: () => null }));
vi.mock('@/lib/use-effective-capabilities', () => ({ useEffectiveCapabilities: () => ({}) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ askReason: vi.fn(), confirm: vi.fn() }) }));

import DepotSearchPage from '@/app/dashboard/search/page';
import HqSearchPage from '@/app/hq/search/page';
import HqCustomersPage from '@/app/hq/customers/page';
import HqPricingPage from '@/app/hq/pricing/page';
import LandingPage from '@/app/hq/access/landing/page';
import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';
import { GROUPS } from '@/lib/ops-nav';
import { CommandPalette, HQ_COMMAND_EVENT } from '@/components/hq/command-palette';
import { WidgetCard } from '@/components/insight/widget-card';
import { Nav } from '@/components/nav';
import OrdersPage from '@/app/dashboard/orders/page';

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 10 });
const hrefOf = (text: string) => screen.getByText(text).closest('a')?.getAttribute('href') ?? null;

beforeEach(() => {
  who.role = 'SUPER_ADMIN';
  who.path = '/';
  window.history.replaceState({}, '', '/');
  get.mockReset().mockResolvedValue(page([]));
  getCached.mockReset().mockResolvedValue(page([]));
});
afterEach(() => vi.clearAllMocks());

async function searchDepot(term: string) {
  render(<DepotSearchPage />);
  fireEvent.change(screen.getByPlaceholderText('dashC.search.placeholder'), { target: { value: term } });
  fireEvent.submit(screen.getByPlaceholderText('dashC.search.placeholder').closest('form')!);
}

describe('depot console search', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/orders/manage'))
        return page([{ id: 'o1', orderNumber: 'HM-1', status: 'DELIVERED', total: 1000 }]);
      if (url.includes('/customers/lookup')) return { id: 'c1', fullName: 'Budi', phone: '+628123456789' };
      return page([]);
    });
  });

  it('opens an order in the queue panel, not at a route that does not exist', async () => {
    who.role = 'MANAGER';
    await searchDepot('+628123456789');
    await waitFor(() => expect(screen.getByText('HM-1')).toBeTruthy());
    expect(hrefOf('HM-1')).toBe('/dashboard/orders?order=o1');
  });

  it('links a customer to the depot directory for a role that may read it, and only then', async () => {
    who.role = 'MANAGER';
    await searchDepot('+628123456789');
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(hrefOf('Budi')).toBe('/dashboard/customers?q=%2B628123456789');
  });

  it('shows MARKETING the customer it may look up, with no door to a directory it may not read', async () => {
    // customerPhoneLookup yes, depotCrm no: /dashboard/customers would refuse it.
    who.role = 'MARKETING';
    await searchDepot('+628123456789');
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(hrefOf('Budi')).toBeNull();
  });
});

describe('head-office search', () => {
  async function searchHq(term: string) {
    render(<HqSearchPage />);
    fireEvent.change(screen.getByPlaceholderText('hq.search.placeholder'), { target: { value: term } });
  }

  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/customers/lookup')) return { id: 'c1', fullName: 'Budi', phone: '+628123456789' };
      if (url.includes('/orders/manage'))
        return page([{ id: 'o1', orderNumber: 'HM-1', status: 'DELIVERED', total: 1000 }]);
      return page([]);
    });
  });

  it('carries the phone to the customer screen, and the order to its detail', async () => {
    who.role = 'HEAD_OFFICE';
    await searchHq('+628123456789');
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy(), { timeout: 3000 });
    expect(hrefOf('Budi')).toBe('/hq/customers?phone=%2B628123456789');
    await waitFor(() => expect(screen.getByText('HM-1')).toBeTruthy(), { timeout: 3000 });
    expect(hrefOf('HM-1')).toBe('/hq/orders/detail?id=o1');
  });
});

describe('the customer screen reads the phone it was sent', () => {
  it('keeps the number looked up last in the URL, so a reload shows the same customer', async () => {
    who.role = 'HEAD_OFFICE';
    window.history.replaceState({}, '', '/hq/customers?phone=0811');
    get.mockImplementation(async (url: string) => {
      if (url.includes('lookup?phone=0811')) return { id: 'c1', fullName: 'Pertama', phone: '0811' };
      if (url.includes('lookup?phone=0822')) return { id: 'c2', fullName: 'Kedua', phone: '0822' };
      throw new Error('not under test');
    });
    render(<HqCustomersPage />);
    await waitFor(() => expect(screen.getByText('Pertama')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('hq.customers.lookupPh'), { target: { value: '0822' } });
    fireEvent.click(screen.getByText('hq.customers.lookup'));
    await waitFor(() => expect(screen.getByText('Kedua')).toBeTruthy());
    expect(window.location.search).toBe('?phone=0822');
  });

  it('looks the number up without being asked to', async () => {
    who.role = 'HEAD_OFFICE';
    window.history.replaceState({}, '', '/hq/customers?phone=%2B628123456789');
    get.mockImplementation(async (url: string) => {
      if (url.includes('/customers/lookup')) return { id: 'c1', fullName: 'Budi', phone: '+628123456789' };
      throw new Error('not under test');
    });
    render(<HqCustomersPage />);
    await waitFor(() =>
      expect(get.mock.calls.some(([u]) => String(u).includes('lookup?phone=%2B628123456789'))).toBe(true),
    );
  });
});

describe('Insight "see detail" links', () => {
  const ready = { data: { n: 1 }, error: null, loading: false, forbidden: false, reload: vi.fn() };
  const card = (detailHref: string) =>
    render(
      <WidgetCard title="T" source={ready as never} detailHref={detailHref}>
        {() => <p>body</p>}
      </WidgetCard>,
    );

  it("links to the twin this console owns", () => {
    who.role = 'MANAGER';
    who.path = '/dashboard/insight';
    card('/hq/churn');
    expect(hrefOf('insight.seeDetail')).toBe('/dashboard/churn');
  });

  it('keeps the head-office screen in the head-office console', () => {
    who.role = 'HEAD_OFFICE';
    who.path = '/hq/dashboard';
    card('/dashboard/monthly-pnl');
    expect(hrefOf('insight.seeDetail')).toBe('/hq/pnl');
  });

  it('draws nothing where the reader would be refused', () => {
    who.role = 'MANAGER';
    who.path = '/dashboard/insight';
    card('/hq/payments');
    expect(screen.queryByText('insight.seeDetail')).toBeNull();
  });
});

describe('the command palette offers only actions the role can open', () => {
  async function open() {
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(new Event(HQ_COMMAND_EVENT));
    });
  }

  it('hides the forms head office cannot use', async () => {
    who.role = 'HEAD_OFFICE';
    await open();
    expect(screen.queryByText('hq.common.actions.pricingRule')).toBeNull();
    expect(screen.queryByText('hq.common.actions.broadcast')).toBeNull();
    expect(screen.getByText('hq.common.actions.onboard')).toBeTruthy();
  });

  it('keeps every action for the super admin', async () => {
    await open();
    for (const key of ['pricingRule', 'voucher', 'onboard', 'invite', 'broadcast']) {
      expect(screen.getByText(`hq.common.actions.${key}`)).toBeTruthy();
    }
  });
});

describe('the pricing screen offers a new rule only to whoever may write one', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => (url.includes('count') ? [] : page([])));
  });

  it('head office reads the queue but gets no "new rule" door', async () => {
    who.role = 'HEAD_OFFICE';
    render(<HqPricingPage />);
    await waitFor(() => expect(screen.getByText('hq.pricing.title')).toBeTruthy());
    expect(screen.queryByText(/hq\.pricing\.newRule/)).toBeNull();
  });

  it('the super admin still gets it', async () => {
    render(<HqPricingPage />);
    await waitFor(() => expect(screen.getByText(/hq\.pricing\.newRule/)).toBeTruthy());
  });
});

describe('every door to the order queue uses the queue page own gate', () => {
  const ordersRow = GROUPS.flatMap((g) => g.items).find((i) => i.href === '/dashboard/orders')!;

  it('the rail row follows orderManageRead, so FINANCE reaches the read-only queue', () => {
    expect(ordersRow.show('FINANCE')).toBe(true);
    expect(ordersRow.show('HR')).toBe(false);
  });

  it('the phone bar drops the queue tab for HR but keeps the bar and its menu', () => {
    who.role = 'HR';
    who.path = '/dashboard/customers';
    render(<OpsBottomNav />);
    expect(screen.queryByText('hrFix.opsNav.queue')).toBeNull();
    expect(screen.getByText('opsFix.nav.more')).toBeTruthy();
  });

  it('the shop pill sends a role with no queue to its own console', () => {
    who.role = 'HR';
    render(<Nav />);
    const pill = screen.getByText('nav.ops').closest('a')!;
    expect(pill.getAttribute('href')).toBe('/hr');
  });

  it('the shop pill agrees with the phone bar: the depot head lands on its own console home', () => {
    who.role = 'KEPALA_DEPOT';
    render(<Nav />);
    expect(screen.getByText('nav.ops').closest('a')!.getAttribute('href')).toBe('/dashboard');
  });
});

describe('the access landing preview says where a role really lands', () => {
  it('a courier lands on the driver app, not the order queue', () => {
    who.role = 'SUPER_ADMIN';
    render(<LandingPage />);
    fireEvent.click(screen.getByText('hq.roles.STAFF_DEPOT'));
    expect(screen.getByText('/driver')).toBeTruthy();
    expect(screen.queryByText('/dashboard/orders')).toBeNull();
  });
});

describe('the order queue FINANCE now reaches from its rail', () => {
  // The load is the dispatch view (shifts) since flow 5b; both it and the old delivery list need trackingRead.
  const deliveryReads = () =>
    get.mock.calls.filter(([u]) => String(u).includes('/deliveries/api/v1/')).length;

  it('does not ask for the courier load it may not read (trackingRead)', async () => {
    who.role = 'FINANCE';
    who.path = '/dashboard/orders';
    render(<OrdersPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => {});
    expect(deliveryReads()).toBe(0);
  });

  it('still reads it for a role that assigns couriers', async () => {
    who.role = 'MANAGER';
    who.path = '/dashboard/orders';
    render(<OrdersPage />);
    await waitFor(() => expect(deliveryReads()).toBeGreaterThan(0));
  });
});
