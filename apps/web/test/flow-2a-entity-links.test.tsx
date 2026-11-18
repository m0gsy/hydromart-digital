// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-2a of the flow plan: a name on a depot or HQ screen is a door to that thing's own page,
 * for a reader who may open it; anyone else keeps the plain text they had before. Every
 * caller is rendered twice, once for a role the destination admits and once for one it
 * refuses, because a link to a page that refuses its reader is the defect PR-1 removed.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const who = { role: 'MANAGER' };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  getBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
  translate: (k: string) => k,
  useLocale: () => ({ locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, assignedDepotId: 'd-1' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: async () => true, askReason: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    selectedId: 'd-1',
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { entityHref } from '@/lib/entity-href';
import { DeliveryDetail } from '@/components/dashboard/delivery-detail';
import { OrderDetail } from '@/components/dashboard/order-detail';
import SettlementsPage from '@/app/dashboard/settlements/page';
import TeamPerformancePage from '@/app/dashboard/team-performance/page';
import ApprovalDetailPage from '@/app/dashboard/approvals/detail/page';
import CustomerDetailPage from '@/app/dashboard/customers/detail/page';
import RatingsPage from '@/app/dashboard/ratings/page';
import InventoryPage from '@/app/dashboard/inventory/page';
import PurchaseOrdersPage from '@/app/dashboard/purchase-orders/page';
import PurchaseOrderDetailPage from '@/app/dashboard/purchase-orders/detail/page';
import HqCustomersPage from '@/app/hq/customers/page';
import HqRefundsPage from '@/app/hq/refunds/page';
import HqOrderDetailPage from '@/app/hq/orders/detail/page';
import HrEmployeeDetailPage from '@/app/hr/employees/detail/page';

const ANON = '00000000-0000-0000-0000-000000000000';
const REFERRAL = { code: { code: 'REF1' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 };
const hrefOf = (text: string | RegExp) =>
  screen.getByText(text).closest('a')?.getAttribute('href') ?? null;
/** Route every GET by the first matching URL fragment; anything unmatched answers `[]`. */
const serve = (routes: [string, unknown][]) =>
  get.mockImplementation(async (url: string) => {
    const hit = routes.find(([part]) => String(url).includes(part));
    return hit ? hit[1] : [];
  });
const at = (url: string) => window.history.replaceState({}, '', url);

beforeEach(() => {
  who.role = 'MANAGER';
  at('/');
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('entityHref', () => {
  it('sends each kind to its page in each console, only for a role that may open it', () => {
    expect(entityHref('order', 'o1', 'dashboard', 'MANAGER')).toBe('/dashboard/orders?order=o1');
    expect(entityHref('order', 'o1', 'dashboard', 'MARKETING')).toBeNull();
    expect(entityHref('order', 'o1', 'hq', 'HEAD_OFFICE')).toBe('/hq/orders/detail?id=o1');
    expect(entityHref('customer', 'c1', 'dashboard', 'MANAGER')).toBe('/dashboard/customers/detail?id=c1');
    expect(entityHref('customer', 'c1', 'dashboard', 'FINANCE')).toBeNull();
    expect(entityHref('customer', '+62811', 'hq', 'HEAD_OFFICE')).toBe('/hq/customers?phone=%2B62811');
    expect(entityHref('courier', 'k1', 'dashboard', 'MANAGER')).toBe('/dashboard/team-performance?driver=k1');
    expect(entityHref('courier', 'k1', 'dashboard', 'KEPALA_DEPOT')).toBeNull();
    expect(entityHref('depot', 'dp1', 'hq', 'HEAD_OFFICE')).toBe('/hq/depots/detail?id=dp1');
    expect(entityHref('supplier', 's1', 'dashboard', 'MANAGER')).toBe('/dashboard/suppliers');
    expect(entityHref('supplier', 's1', 'dashboard', 'KEPALA_DEPOT')).toBeNull();
    expect(entityHref('stock', 'Galon 19L', 'dashboard', 'MANAGER')).toBe('/dashboard/inventory');
    expect(entityHref('gallon', 'r1', 'dashboard', 'MANAGER')).toBe('/dashboard/returns');
  });

  it('has no door for an empty ref, the anonymous counter buyer, or a console with no page', () => {
    expect(entityHref('order', null, 'dashboard', 'MANAGER')).toBeNull();
    expect(entityHref('order', '', 'dashboard', 'MANAGER')).toBeNull();
    expect(entityHref('customer', ANON, 'dashboard', 'MANAGER')).toBeNull();
    expect(entityHref('depot', 'dp1', 'dashboard', 'MANAGER')).toBeNull();
  });
});

describe('delivery sheet: the order number', () => {
  const DELIVERY = {
    id: 'dl1',
    orderId: 'o1',
    orderNumber: 'ORD-77',
    driverId: 'k1',
    depotId: 'd-1',
    status: 'ON_DELIVERY',
    destinationAddress: 'Jl. Cikini 5',
    destinationLat: null,
    destinationLng: null,
    recipientPhone: null,
    codAmount: null,
    assignedAt: '2026-11-18T02:00:00.000Z',
  };

  it('opens the order in the queue panel', async () => {
    get.mockResolvedValue(DELIVERY);
    render(<DeliveryDetail deliveryId="dl1" />);
    await screen.findByText('ORD-77');
    expect(hrefOf('ORD-77')).toBe('/dashboard/orders?order=o1');
  });

  it('stays text for a role the order queue refuses', async () => {
    who.role = 'MARKETING';
    get.mockResolvedValue(DELIVERY);
    render(<DeliveryDetail deliveryId="dl1" />);
    await screen.findByText('ORD-77');
    expect(hrefOf('ORD-77')).toBeNull();
  });
});

describe('order panel: the buyer', () => {
  const ORDER = {
    id: 'o-1',
    orderNumber: 'HM-0001',
    status: 'DELIVERED',
    depotId: 'd-1',
    customerId: 'c-1',
    recipientName: 'Wahyu',
    phone: '081234567890',
    addressLine: 'Jl. Mawar 1',
    city: 'Jakarta',
    province: 'DKI',
    postalCode: '12345',
    notes: null,
    deliveryWindow: null,
    subtotal: 20000,
    deliveryFee: 5000,
    discount: 0,
    total: 25000,
    items: [],
    history: [],
    isWalkIn: false,
    driverName: null,
    createdAt: '2026-11-18T02:00:00.000Z',
  };
  const show = (order: typeof ORDER) =>
    render(<OrderDetail order={order as never} onClose={vi.fn()} onChanged={vi.fn()} />);

  it('opens the customer for a role that reads the depot CRM', () => {
    show(ORDER);
    expect(hrefOf('Wahyu')).toBe('/dashboard/customers/detail?id=c-1');
  });

  it('stays text for FINANCE, which opens orders but not the CRM', () => {
    who.role = 'FINANCE';
    show(ORDER);
    expect(hrefOf('Wahyu')).toBeNull();
  });

  it('stays text for a counter sale with no account behind it', () => {
    show({ ...ORDER, customerId: ANON, isWalkIn: true });
    expect(hrefOf('Wahyu')).toBeNull();
  });
});

describe('settlements: the courier', () => {
  const SETTLEMENT = {
    id: 's1',
    shiftId: 'sh1',
    driverId: 'k1',
    depotId: 'd-1',
    status: 'SUBMITTED',
    orderIds: ['o1'],
    expectedAmount: 50000,
    depositedAmount: 50000,
    variance: 0,
    chargedToDriver: false,
    chargeRequestedBy: null,
    note: null,
    verifiedBy: null,
    verifiedAt: null,
    createdAt: '2026-11-18T02:00:00.000Z',
    updatedAt: '2026-11-18T02:00:00.000Z',
  };
  const routes: [string, unknown][] = [
    ['/settlements/rules', { surplusNoteThresholdIdr: 5000 }],
    ['/settlements', [SETTLEMENT]],
    ['drivers', [{ id: 'k1', fullName: 'Andi Kurir', phone: '0811' }]],
  ];

  it("opens that courier's card on the team screen", async () => {
    serve(routes);
    render(<SettlementsPage />);
    await screen.findByText('Andi Kurir');
    expect(hrefOf('Andi Kurir')).toBe('/dashboard/team-performance?driver=k1');
  });

  it('stays text for KEPALA_DEPOT, who verifies deposits but has no team screen', async () => {
    who.role = 'KEPALA_DEPOT';
    serve(routes);
    render(<SettlementsPage />);
    await screen.findByText('Andi Kurir');
    expect(hrefOf('Andi Kurir')).toBeNull();
  });
});

describe('team screen: `?driver=` marks that courier', () => {
  const REPORT = {
    from: '2026-11-01',
    to: '2026-12-01',
    couriers: [
      { driverId: 'k1', delivered: 10, onTimeRate: 1, failed: 0, rating: 5 },
      { driverId: 'k2', delivered: 8, onTimeRate: 0.95, failed: 1, rating: 4.5 },
    ],
    operators: [],
  };
  const routes: [string, unknown][] = [
    ['depot-team', REPORT],
    [
      '/staff',
      {
        items: [
          { id: 'k1', fullName: 'Andi Kurir', phone: '0811' },
          { id: 'k2', fullName: 'Bima Kurir', phone: '0812' },
        ],
        total: 2,
        page: 1,
        limit: 100,
      },
    ],
  ];

  it("marks the courier the link named, and only that one", async () => {
    at('/dashboard/team-performance?driver=k2');
    serve(routes);
    const { container } = render(<TeamPerformancePage />);
    await screen.findByText('Bima Kurir');
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Bima Kurir');
    expect(screen.queryByText('mgrFix.teamPerf.notThisMonth')).toBeNull();
  });

  it('says so when that courier delivered nothing this month', async () => {
    at('/dashboard/team-performance?driver=k9');
    serve(routes);
    const { container } = render(<TeamPerformancePage />);
    await screen.findByText('Andi Kurir');
    expect(screen.getByText('mgrFix.teamPerf.notThisMonth')).toBeTruthy();
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it('marks nothing without `?driver=`', async () => {
    at('/dashboard/team-performance');
    serve(routes);
    const { container } = render(<TeamPerformancePage />);
    await screen.findByText('Andi Kurir');
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
    expect(screen.queryByText('mgrFix.teamPerf.notThisMonth')).toBeNull();
  });
});

describe('approval detail: the subject opens the nearest list', () => {
  const APPROVAL = {
    id: 'a1',
    depotId: 'd-1',
    type: 'OPNAME_VARIANCE',
    title: 'Selisih opname Galon 19L',
    subjectRef: 'Galon 19L',
    amountIdr: -250_000,
    autoPassThreshold: 100_000,
    status: 'PENDING',
    payload: { system: 100, physical: 90, variance: -10 },
    submittedBy: '11111111-1111-4111-8111-111111111111',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: '2026-11-18T02:00:00.000Z',
  };
  const open = async (approval: Record<string, unknown>) => {
    at('/dashboard/approvals/detail?id=a1');
    serve([['/approvals/', approval]]);
    render(<ApprovalDetailPage />);
    await screen.findByText(String(approval.title));
  };

  it('a stock count opens the stock list', async () => {
    await open(APPROVAL);
    expect(hrefOf('Galon 19L')).toBe('/dashboard/inventory');
  });

  it('a gallon variance and a deposit refund open the returns list', async () => {
    await open({ ...APPROVAL, type: 'GALLON_VARIANCE', title: 'Selisih galon', subjectRef: 'r-1' });
    expect(hrefOf('r-1')).toBe('/dashboard/returns');
  });

  it('a cashier shift has no screen, so it stays text', async () => {
    await open({ ...APPROVAL, type: 'COD_VARIANCE', title: 'Selisih kas', subjectRef: 'shift:sh1' });
    expect(hrefOf(/shift:sh1/)).toBeNull();
  });
});

describe('customer detail: recent orders', () => {
  const DETAIL = {
    profile: {
      fullName: 'Budi',
      phone: '081234567890',
      isSubscriber: false,
      orderCount: 1,
      totalSpentIdr: 20000,
      gallonsOnLoan: 0,
      overdueGallons: 0,
      oldestGallonAt: null,
      churnRisk: null,
    },
    addresses: [],
    depositLedger: [],
    recentOrders: [{ id: 'o1', status: 'DELIVERED', totalIdr: 20000, placedAt: '2026-11-18T02:00:00.000Z' }],
  };

  it('each one opens in the order queue', async () => {
    at('/dashboard/customers/detail?id=c1');
    // The detail screen also asks for the customer's referral card; served an empty list it
    // read `code` of undefined after the test had passed, failing the file at random in CI.
    serve([['/depot-detail', DETAIL], ['referral', REFERRAL]]);
    render(<CustomerDetailPage />);
    await screen.findByText('DELIVERED');
    expect(hrefOf('DELIVERED')).toBe('/dashboard/orders?order=o1');
  });

  it('stays text for HR, which reads the directory but not the order queue', async () => {
    who.role = 'HR';
    at('/dashboard/customers/detail?id=c1');
    // The detail screen also asks for the customer's referral card; served an empty list it
    // read `code` of undefined after the test had passed, failing the file at random in CI.
    serve([['/depot-detail', DETAIL], ['referral', REFERRAL]]);
    render(<CustomerDetailPage />);
    await screen.findByText('DELIVERED');
    expect(hrefOf('DELIVERED')).toBeNull();
  });
});

describe('ratings: the buyer and the order', () => {
  const REPORT = {
    depotId: 'd-1',
    from: null,
    to: null,
    average: 5,
    count: 1,
    distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
    recent: [
      {
        orderId: 'o1',
        customerId: 'c1',
        customerName: 'Sari',
        stars: 5,
        comment: 'Cepat',
        createdAt: '2026-11-18T02:00:00.000Z',
      },
    ],
  };

  it('the name opens the customer and a link opens the order', async () => {
    serve([['ratings', REPORT]]);
    render(<RatingsPage />);
    await screen.findByText('Sari');
    expect(hrefOf('Sari')).toBe('/dashboard/customers/detail?id=c1');
    expect(hrefOf('opsFix.ratings.openOrder')).toBe('/dashboard/orders?order=o1');
  });

  it('a card from an older server, without ids, keeps its text and draws no order link', async () => {
    const { orderId: _o, customerId: _c, ...old } = REPORT.recent[0]!;
    serve([['ratings', { ...REPORT, recent: [old] }]]);
    render(<RatingsPage />);
    await screen.findByText('Sari');
    expect(hrefOf('Sari')).toBeNull();
    expect(screen.queryByText('opsFix.ratings.openOrder')).toBeNull();
  });
});

describe('purchasing from the low-stock filter', () => {
  it('offers the draft with the low filter on, to a role that buys', async () => {
    at('/dashboard/inventory?low=1');
    render(<InventoryPage />);
    await waitFor(() => expect(screen.getByText('opsFix.poDraft.open')).toBeTruthy());
    expect(hrefOf('opsFix.poDraft.open')).toBe('/dashboard/purchase-orders?draft=1');
  });

  it('does not offer it with the filter off, nor to a role without purchasing', async () => {
    at('/dashboard/inventory');
    const first = render(<InventoryPage />);
    await waitFor(() => expect(screen.getByText(/opsFix\.inv\.filterLow/)).toBeTruthy());
    expect(screen.queryByText('opsFix.poDraft.open')).toBeNull();
    first.unmount();

    who.role = 'KEPALA_DEPOT';
    at('/dashboard/inventory?low=1');
    render(<InventoryPage />);
    await waitFor(() => expect(screen.getByText(/opsFix\.inv\.filterLow/)).toBeTruthy());
    expect(screen.queryByText('opsFix.poDraft.open')).toBeNull();
  });

  it('`?draft=1` opens the draft once and leaves the URL clean', async () => {
    at('/dashboard/purchase-orders?draft=1');
    render(<PurchaseOrdersPage />);
    await waitFor(() => expect(screen.getByText('opsFix.poDraft.title')).toBeTruthy());
    expect(window.location.search).toBe('');
  });

  it('with no supplier yet, the draft says so as a door to the supplier list', async () => {
    at('/dashboard/purchase-orders?draft=1');
    render(<PurchaseOrdersPage />);
    await waitFor(() => expect(screen.getByText('opsFix.poDraft.noSuppliers')).toBeTruthy());
    expect(hrefOf('opsFix.poDraft.noSuppliers')).toBe('/dashboard/suppliers');
  });

  it('a purchase order names its supplier as a door to the supplier list', async () => {
    at('/dashboard/purchase-orders/detail?id=po1');
    serve([
      [
        '/purchase-orders/',
        {
          id: 'po1',
          depotId: 'd-1',
          poNumber: 'PO-001',
          supplierId: 'sp1',
          supplierName: 'PT Air Jernih',
          status: 'DRAFT',
          lines: [],
          subtotalIdr: 0,
          shippingIdr: 0,
          totalIdr: 0,
          expectedAt: null,
          receivedAt: null,
          createdAt: '2026-11-18T02:00:00.000Z',
        },
      ],
    ]);
    render(<PurchaseOrderDetailPage />);
    await screen.findByText('PT Air Jernih');
    expect(hrefOf('PT Air Jernih')).toBe('/dashboard/suppliers');
  });
});

describe('head office: orders behind refunds and customers', () => {
  it('a refund names its order as a door to the order', async () => {
    who.role = 'HEAD_OFFICE';
    serve([
      [
        'refunds/queue',
        {
          items: [
            {
              id: 'pay-1',
              orderId: 'o-9',
              orderNumber: 'HM-260904-001',
              customerId: 'c-1',
              method: 'TRANSFER',
              status: 'PAID',
              amount: 150_000,
              refundedAmount: null,
              refundReason: 'dipungut lebih',
              refundApproval: 'PENDING',
              orderStatus: 'DELIVERED',
              createdAt: '2026-11-18T02:00:00.000Z',
              updatedAt: '2026-11-18T02:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 100,
        },
      ],
      ['refunds/rules', { hqApprovalThresholdIdr: 100_000 }],
    ]);
    render(<HqRefundsPage />);
    await screen.findByText('HM-260904-001');
    expect(hrefOf('HM-260904-001')).toBe('/hq/orders/detail?id=o-9');
  });

  it("a customer's recent order opens the order", async () => {
    who.role = 'HEAD_OFFICE';
    at('/hq/customers?phone=0811');
    serve([
      ['/customers/lookup', { id: 'c1', fullName: 'Budi', phone: '0811', role: 'CUSTOMER' }],
      ['/loyalty/', null],
      [
        '/reports/',
        {
          customerId: 'c1',
          orderCount: 1,
          revenue: 20000,
          firstOrderAt: null,
          lastOrderAt: null,
          recentOrders: [
            { id: 'o-7', orderNumber: 'HM-7', status: 'DELIVERED', total: 20000, createdAt: '2026-11-18T02:00:00.000Z' },
          ],
        },
      ],
    ]);
    render(<HqCustomersPage />);
    await screen.findByText('HM-7');
    expect(hrefOf('HM-7')).toBe('/hq/orders/detail?id=o-7');
  });
});

describe('head office order detail: the buyer and the depot', () => {
  const ORDER = {
    id: 'o-1',
    orderNumber: 'HM-0001',
    status: 'DELIVERED',
    depotId: 'd-1',
    customerId: 'c-1',
    recipientName: 'Wahyu',
    phone: '0899',
    addressLine: 'Jl. Mawar 1',
    city: 'Jakarta',
    province: null,
    postalCode: null,
    subtotal: 20000,
    deliveryFee: 0,
    discount: 0,
    total: 20000,
    items: [],
    history: [],
    driverName: null,
    createdAt: '2026-11-18T02:00:00.000Z',
  };
  const routes: [string, unknown][] = [
    ['by-ids', [{ id: 'c-1', fullName: 'Wahyu', phone: '+62811' }]],
    ['/manage/', ORDER],
    ['/payments', { items: [], total: 0, page: 1, limit: 10 }],
    ['/depots/api/v1/depots/d-1', { id: 'd-1', name: 'Depot Satu' }],
  ];

  it("opens the buyer by their ACCOUNT phone, not the recipient's, and names the depot", async () => {
    who.role = 'HEAD_OFFICE';
    at('/hq/orders/detail?id=o-1');
    serve(routes);
    render(<HqOrderDetailPage />);
    await screen.findByText('HM-0001');
    await waitFor(() => expect(hrefOf('Wahyu')).toBe('/hq/customers?phone=%2B62811'));
    await waitFor(() => expect(hrefOf('Depot Satu')).toBe('/hq/depots/detail?id=d-1'));
  });

  it('never asks for names it may not read: DIREKTUR keeps the plain name', async () => {
    who.role = 'DIREKTUR';
    at('/hq/orders/detail?id=o-1');
    serve(routes);
    render(<HqOrderDetailPage />);
    await screen.findByText('HM-0001');
    expect(hrefOf('Wahyu')).toBeNull();
    expect(get.mock.calls.some(([url]) => String(url).includes('by-ids'))).toBe(false);
  });
});

/*
 * Flow PR-2a-ii: a courier is a login. The depot opens their card on the team screen (via the
 * order's own delivery, asked only of roles that may read deliveries), head office and the team
 * screen open their HR record by that login, which the HR screen resolves itself.
 */
describe('courier links (2a-ii)', () => {
  it('entityHref: a courier on the head-office side, and any staff login, open the HR record', () => {
    expect(entityHref('courier', 'k1', 'hq', 'HEAD_OFFICE')).toBe('/hr/employees/detail?account=k1');
    expect(entityHref('staffAccount', 'k1', 'dashboard', 'MANAGER')).toBe('/hr/employees/detail?account=k1');
    expect(entityHref('staffAccount', 'k1', 'dashboard', 'KEPALA_DEPOT')).toBeNull();
  });

  const ORDER = {
    id: 'o-1',
    orderNumber: 'HM-0001',
    status: 'DELIVERED',
    depotId: 'd-1',
    customerId: 'c-1',
    recipientName: 'Wahyu',
    phone: '0811',
    addressLine: 'Jl. Mawar 1',
    city: 'Jakarta',
    province: null,
    postalCode: null,
    notes: null,
    deliveryWindow: null,
    subtotal: 20000,
    deliveryFee: 0,
    discount: 0,
    total: 20000,
    items: [],
    history: [],
    isWalkIn: false,
    driverName: 'Andi Kurir',
    createdAt: '2026-11-18T02:00:00.000Z',
  };
  const courierRoutes: [string, unknown][] = [
    ['/deliveries?orderId=o-1', { items: [{ id: 'dl1', orderId: 'o-1', driverId: 'k1' }], total: 1, page: 1, limit: 1 }],
    ['/payments', { items: [], total: 0, page: 1, limit: 10 }],
  ];

  it("the depot order panel opens the courier's card on the team screen", async () => {
    serve(courierRoutes);
    render(<OrderDetail order={ORDER as never} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() =>
      expect(hrefOf(/hrFix\.orderDetail\.courier/)).toBe('/dashboard/team-performance?driver=k1'),
    );
  });

  it('a role that may not read deliveries never asks, and keeps the name as text', async () => {
    who.role = 'FINANCE';
    serve(courierRoutes);
    render(<OrderDetail order={ORDER as never} onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText(/hrFix\.orderDetail\.courier/);
    expect(hrefOf(/hrFix\.orderDetail\.courier/)).toBeNull();
    expect(get.mock.calls.some(([url]) => String(url).includes('/deliveries?orderId='))).toBe(false);
  });

  it('head office opens the courier’s HR record', async () => {
    who.role = 'HEAD_OFFICE';
    at('/hq/orders/detail?id=o-1');
    serve([
      ...courierRoutes,
      ['/manage/', ORDER],
      ['/payments', { items: [], total: 0, page: 1, limit: 10 }],
    ]);
    render(<HqOrderDetailPage />);
    await screen.findByText('HM-0001');
    await waitFor(() => expect(hrefOf('Andi Kurir')).toBe('/hr/employees/detail?account=k1'));
  });
});

describe('HR record by login (2a-ii)', () => {
  it('resolves `?account=` to the employee and loads that record', async () => {
    who.role = 'HR';
    at('/hr/employees/detail?account=k1');
    serve([
      ['authSubjectId=k1', { rows: [{ id: 'e1', fullName: 'Andi Kurir' }], total: 1, page: 1, pageSize: 1 }],
      ['/employees/api/v1/employees/e1', { id: 'e1', fullName: 'Andi Kurir', employeeCode: 'K-01', status: 'ACTIVE' }],
    ]);
    render(<HrEmployeeDetailPage />);
    await waitFor(() =>
      expect(get.mock.calls.some(([url]) => String(url).endsWith('/employees/api/v1/employees/e1'))).toBe(true),
    );
  });
});
