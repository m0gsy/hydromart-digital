// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Five screens that offered something they could not deliver, or that could not be used.
 *
 *  - CA-1-32: the HR rail offered Pelanggan and Reseller to every role holding `hrView`,
 *    but both screens live in customer-service behind narrower capabilities. FINANCE got
 *    both and ASSISTANT_SUPERVISOR got Reseller, each opening onto a 403 rendered as a
 *    load failure.
 *  - CA-1-30: the employee WRITE pages had no gate of their own — the list hid the "Ubah"
 *    control and the URL did not. A read-only role filled in a whole form and learnt it was
 *    refused at Simpan.
 *  - CA-3-65: four `<label htmlFor>` pointed at ids that do not exist. `htmlFor` cannot
 *    label a `<div>`, so a row of buttons — payment type, expense category, quantity,
 *    frequency — was announced as an unnamed group.
 *  - CA-3-66: the location panel had no way to close. Outside taps did nothing, and the
 *    Android back button left the PAGE.
 *  - CA-3-61: the amber promo card kept a light background in dark mode while its text
 *    switched to a light amber — the title of a promotion, invisible.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const auth = { customer: null as { id: string; role: string } | null };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams('id=emp-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'emp-1' }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));

// Both providers are chrome these components sit inside in the real app; neither is what
// these tests are about.
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: null, setLocation: vi.fn() }),
}));

import { hrNavItems } from '@/components/hr/hr-rail';
import { Field } from '@/components/ui';
import { LocationSelector } from '@/components/location-selector';
import EditEmployeePage from '@/app/hr/employees/detail/edit/page';
import NewEmployeePage from '@/app/hr/employees/new/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ items: [], rows: [] });
});
afterEach(() => vi.clearAllMocks());

const hrefs = (role: string) => hrNavItems(role).map((i) => i.href);

describe('CA-1-32 the HR rail only offers what the reader can open', () => {
  it('keeps Pelanggan and Reseller from FINANCE, who holds neither capability', () => {
    // FINANCE has `hrView` — that is why it reaches this console at all — and is on
    // neither `depotCrm` nor `resellerView`.
    expect(hrefs('FINANCE')).not.toContain('/hr/customers');
    expect(hrefs('FINANCE')).not.toContain('/hr/resellers');
    // Everything else it may read is still offered.
    expect(hrefs('FINANCE')).toContain('/hr/payroll');
  });

  it('keeps Reseller from ASSISTANT_SUPERVISOR while leaving Pelanggan', () => {
    // The two lists differ: `depotCrm` includes this role and `resellerView` does not.
    expect(hrefs('ASSISTANT_SUPERVISOR')).toContain('/hr/customers');
    expect(hrefs('ASSISTANT_SUPERVISOR')).not.toContain('/hr/resellers');
  });

  it('still offers both to HR, whose console this is', () => {
    expect(hrefs('HR')).toEqual(expect.arrayContaining(['/hr/customers', '/hr/resellers']));
  });
});

describe('CA-1-30 the employee write pages are gated, not just their buttons', () => {
  it('refuses the edit form to a role that may only read the roster', async () => {
    auth.customer = { id: 'u1', role: 'FINANCE' };
    render(<EditEmployeePage />);
    await waitFor(() => expect(screen.getByText('hq.denied.title')).toBeTruthy());
    // And it never asked for the record either.
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses the create form to the same role', async () => {
    auth.customer = { id: 'u1', role: 'FINANCE' };
    render(<NewEmployeePage />);
    await waitFor(() => expect(screen.getByText('hq.denied.title')).toBeTruthy());
  });

  it('lets HR through', async () => {
    auth.customer = { id: 'u2', role: 'HR' };
    render(<NewEmployeePage />);
    await waitFor(() => expect(screen.queryByText('hq.denied.title')).toBeNull());
  });
});

describe('CA-3-65 a Field names whatever it wraps', () => {
  it('labels a real control by id, as it always did', () => {
    render(
      <Field label="Nama">
        <input type="text" />
      </Field>,
    );
    // The accessible name comes from the label; getByLabelText fails if it does not.
    expect(screen.getByLabelText('Nama')).toBeTruthy();
  });

  it('labels a button row as a named group, which htmlFor cannot do', () => {
    render(
      <Field label="Jenis">
        <div>
          <button type="button">Tunai</button>
          <button type="button">Transfer</button>
        </div>
      </Field>,
    );
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
    const labelId = group.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('Jenis');
  });

  it('leaves a role the caller already chose alone', () => {
    render(
      <Field label="Frekuensi">
        <div role="radiogroup">
          <button type="button">Mingguan</button>
        </div>
      </Field>,
    );
    expect(screen.getByRole('radiogroup').getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('CA-3-66 the location panel can be dismissed', () => {
  beforeEach(() => {
    get.mockResolvedValue({ items: [] });
  });

  it('closes on a tap outside it', async () => {
    render(
      <div>
        <LocationSelector />
        <button type="button">di luar</button>
      </div>,
    );
    await userEvent.click(screen.getByText('home.location.placeholder'));
    await waitFor(() => expect(screen.getByText('home.location.useMyLocation')).toBeTruthy());

    await userEvent.click(screen.getByText('di luar'));
    await waitFor(() => expect(screen.queryByText('home.location.useMyLocation')).toBeNull());
  });

  it('closes on Escape', async () => {
    render(<LocationSelector />);
    await userEvent.click(screen.getByText('home.location.placeholder'));
    await waitFor(() => expect(screen.getByText('home.location.useMyLocation')).toBeTruthy());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('home.location.useMyLocation')).toBeNull());
  });

  it('closes on the Android back gesture instead of leaving the page', async () => {
    render(<LocationSelector />);
    await userEvent.click(screen.getByText('home.location.placeholder'));
    await waitFor(() => expect(screen.getByText('home.location.useMyLocation')).toBeTruthy());

    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByText('home.location.useMyLocation')).toBeNull());
  });
});


describe('CA-3-61 the amber promo card is readable in dark mode', () => {
  /*
   * The background was a literal `bg-amber-50` with no dark variant, so it stayed a pale
   * cream block while the title and subtitle switched to `var(--warning)` — #e0b64a in
   * dark. Pale amber on pale cream: the title of a promotion, and the line explaining it,
   * both effectively invisible on the home screen.
   *
   * Asserted on the class rather than on a computed colour: jsdom applies no stylesheet,
   * so a colour assertion here would pass whatever the card actually looked like. What is
   * checkable is that the background is a THEMED token and not a one-theme literal.
   */
  it('paints its background from a token that moves with the theme', async () => {
    const { AmberCard } = await import('@/components/promo-carousel');
    const { container } = render(
      <AmberCard
        promo={{
          id: 'p1',
          title: 'Diskon Lebaran',
          subtitle: 'Sampai 30%',
          imageUrl: null,
          ctaLabel: null,
          ctaHref: null,
          voucherCode: null,
          sortOrder: 0,
          active: true,
          startsAt: null,
          endsAt: null,
          updatedAt: '2026-09-09T00:00:00.000Z',
        }}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-[color:var(--warning-bg)]');
    // The literal that could not follow the theme.
    expect(card.className).not.toContain('bg-amber-50');
  });
});
