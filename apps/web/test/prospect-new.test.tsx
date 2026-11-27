// @vitest-environment jsdom
//
// AREA-2c: the field find (/dashboard/prospects/new) and the do-not-contact form. A pin from GPS or pasted,
// never (0, 0); the server's refusals shown; the owner depot said on the success card; the gate by capability.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post, position, ask, auth, FakeApiError, FakeGeoError } = vi.hoisted(() => ({
  post: vi.fn(),
  position: vi.fn(),
  ask: vi.fn(),
  auth: { role: 'KEPALA_DEPOT' },
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
  FakeGeoError: class extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { post }, ApiError: FakeApiError }));
vi.mock('@/lib/geo', () => ({ currentPosition: position, GeoError: FakeGeoError }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'dep-a', code: 'BKS', name: 'Bekasi' }], selectedId: null }),
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: ask }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NewProspectPage from '@/app/dashboard/prospects/new/page';
import { DncForm } from '@/components/prospects/dnc-form';
import { loadSessionCapabilities } from '@/lib/roles';

const made = (over: Record<string, unknown> = {}) => ({ id: 'p-9', name: 'Bengkel Jaya', ownerDepotId: 'dep-a', ...over });
const fix = (latitude: number, longitude: number, accuracy = 9.4) => ({ coords: { latitude, longitude, accuracy } });
const label = (k: string) => screen.getByLabelText(`opsFix.prospectsField.${k}`);
const press = (name: string) => userEvent.click(screen.getByRole('button', { name: `opsFix.prospectsField.${name}` }));

async function fillBasics() {
  await userEvent.type(label('field.name'), '  Bengkel Jaya ');
  await userEvent.selectOptions(label('field.category'), 'BENGKEL');
}

beforeEach(() => {
  auth.role = 'KEPALA_DEPOT';
  loadSessionCapabilities(null, null);
  for (const m of [post, position, ask]) m.mockReset();
  ask.mockResolvedValue(true);
});
afterEach(cleanup);

describe('field find', () => {
  it('pins from GPS (saying the accuracy), posts the trimmed row, and names the owner depot on the success card', async () => {
    position.mockResolvedValue(fix(-6.2, 106.9));
    post.mockResolvedValue(made());
    render(<NewProspectPage />);
    await fillBasics();
    await userEvent.type(label('field.phone'), ' 0812 ');
    await press('pin.use');
    expect(await screen.findByText('opsFix.prospectsField.pin.fromGps|{"m":9}')).toBeTruthy();
    expect(position).toHaveBeenCalledWith({ pin: true });
    await press('field.save');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects');
    expect(post.mock.calls[0]?.[1]).toEqual({
      name: 'Bengkel Jaya',
      category: 'BENGKEL',
      latitude: -6.2,
      longitude: 106.9,
      phone: '0812',
    });
    expect(await screen.findByText('opsFix.prospectsField.field.ownerDepot|{"depot":"BKS - Bekasi"}')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'opsFix.prospectsField.field.open' }).getAttribute('href')).toBe(
      '/dashboard/prospects/detail?id=p-9',
    );
  });

  it('accepts a pasted pin and says so', async () => {
    post.mockResolvedValue(made({ ownerDepotId: null }));
    render(<NewProspectPage />);
    await fillBasics();
    await userEvent.type(label('pin.paste'), '-6.2, 106.9');
    expect(await screen.findByText('opsFix.prospectsField.pin.fromPaste')).toBeTruthy();
    await press('field.save');
    expect(await screen.findByText('opsFix.prospectsField.field.ownerNone')).toBeTruthy();
    expect(position).not.toHaveBeenCalled();
    // "Tambah lagi" starts a clean form.
    await press('field.addAnother');
    expect((label('field.name') as HTMLInputElement).value).toBe('');
  });

  it('names another depot without a code when the depot is not in the caller list', async () => {
    position.mockResolvedValue(fix(-6.2, 106.9, Number.NaN));
    post.mockResolvedValue(made({ ownerDepotId: 'dep-z' }));
    render(<NewProspectPage />);
    await fillBasics();
    await press('pin.use');
    await waitFor(() => expect(screen.queryByText(/pin.fromGps/)).toBeNull());
    expect(screen.getByText('opsFix.prospectsField.pin.fromPaste')).toBeTruthy();
    await press('field.save');
    expect(await screen.findByText('opsFix.prospectsField.field.ownerDepot|{"depot":"opsFix.prospectsField.field.ownerOther"}')).toBeTruthy();
  });

  it.each(['0, 0', '-6,2, 106,8', '95, 10'])('refuses the pasted pin %j and never posts', async (text) => {
    render(<NewProspectPage />);
    await fillBasics();
    await userEvent.type(label('pin.paste'), text);
    expect(await screen.findByText('opsFix.prospectsField.pin.bad')).toBeTruthy();
    await press('field.save');
    expect(await screen.findByText('opsFix.prospectsField.field.pinMissing')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a GPS fix at (0, 0)', async () => {
    position.mockResolvedValue(fix(0, 0));
    render(<NewProspectPage />);
    await press('pin.use');
    expect(await screen.findByText('errors.geo.unavailable')).toBeTruthy();
  });

  it('shows a location failure by its reason, and a non-geo failure as unavailable', async () => {
    position.mockRejectedValueOnce(new FakeGeoError('timeout'));
    render(<NewProspectPage />);
    await press('pin.use');
    expect(await screen.findByText('errors.geo.timeout')).toBeTruthy();
    position.mockRejectedValueOnce(new Error('boom'));
    await press('pin.use');
    expect(await screen.findByText('opsFix.prospectsField.pin.unavailable')).toBeTruthy();
  });

  it('needs a name and a category before anything else', async () => {
    render(<NewProspectPage />);
    await press('field.save');
    expect(await screen.findByText('opsFix.prospectsField.field.nameMissing')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['a duplicate', new FakeApiError(409, 'Usaha dengan nama yang sama sudah ada dalam radius 150 m'), 'Usaha dengan nama yang sama sudah ada dalam radius 150 m'],
    ['a do-not-contact', new FakeApiError(409, 'Nomor atau usaha ini ada di daftar jangan dihubungi'), 'Nomor atau usaha ini ada di daftar jangan dihubungi'],
    ['an out-of-area pin (404)', new FakeApiError(404, 'Prospek tidak ditemukan'), 'opsFix.prospectsField.field.outOfArea'],
    ['an error with no text', new FakeApiError(500, ''), 'opsFix.prospects.actions.failed'],
    ['a dropped call', new TypeError('Failed to fetch'), 'opsFix.prospects.actions.failed'],
  ])('shows the refusal for %s', async (_n, error, text) => {
    post.mockRejectedValue(error);
    render(<NewProspectPage />);
    await fillBasics();
    await userEvent.type(label('pin.paste'), '-6.2, 106.9');
    await press('field.save');
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('opens for a Work-only role (Sales Depot), not for a Read-only role', async () => {
    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    const first = render(<NewProspectPage />);
    expect(screen.getByLabelText('opsFix.prospectsField.field.name')).toBeTruthy();
    first.unmount();
    auth.role = 'DIREKTUR';
    loadSessionCapabilities('DIREKTUR', ['b2bProspectRead']);
    render(<NewProspectPage />);
    expect(screen.getByText('opsFix.prospectsField.field.gateTitle')).toBeTruthy();
    expect(screen.queryByLabelText('opsFix.prospectsField.field.name')).toBeNull();
  });
});

describe('field find accessibility', () => {
  it('links the error to the fields and moves focus to it, then to the success card', async () => {
    render(<NewProspectPage />);
    await press('field.save');
    const alert = await screen.findByText('opsFix.prospectsField.field.nameMissing');
    expect(alert.id).toBe('field-find-error');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(label('field.name').getAttribute('aria-invalid')).toBe('true');
    expect(label('field.name').getAttribute('aria-describedby')).toBe('field-find-error');
    await fillBasics();
    await userEvent.type(label('pin.paste'), '-6.2, 106.9');
    post.mockResolvedValue(made());
    await press('field.save');
    const status = await screen.findByText('opsFix.prospectsField.field.ownerDepot|{"depot":"BKS - Bekasi"}');
    await waitFor(() => expect(status.parentElement).toBe(document.activeElement));
  });
});

describe('do-not-contact form', () => {
  it('asks first, sends nothing on cancel, and tells the list to reload after a success', async () => {
    ask.mockResolvedValueOnce(false);
    post.mockResolvedValue({ entries: 1, prospects: 1 });
    const onDone = vi.fn();
    render(<DncForm onClose={vi.fn()} onDone={onDone} />);
    await userEvent.type(label('dnc.phone'), '0812');
    await press('dnc.submit');
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ title: 'opsFix.prospectsField.dnc.confirmTitle', tone: 'danger' });
    expect(post).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    await press('dnc.submit');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const done = await screen.findByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  it('links its error to the phone field and focuses it', async () => {
    post.mockRejectedValue(new FakeApiError(403, 'Tidak diizinkan'));
    render(<DncForm onClose={vi.fn()} />);
    await userEvent.type(label('dnc.phone'), '0812');
    await press('dnc.submit');
    const alert = await screen.findByText('Tidak diizinkan');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(label('dnc.phone').getAttribute('aria-describedby')).toBe('dnc-error');
    expect(label('dnc.phone').getAttribute('aria-invalid')).toBe('true');
  });

  it('registers a phone and says what happened', async () => {
    post.mockResolvedValue({ entries: 1, prospects: 2 });
    render(<DncForm onClose={vi.fn()} />);
    await userEvent.type(label('dnc.phone'), ' 0812 ');
    await press('dnc.submit');
    expect(await screen.findByText('opsFix.prospectsField.dnc.done|{"entries":1,"prospects":2}')).toBeTruthy();
    expect(post.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/do-not-contact');
    expect(post.mock.calls[0]?.[1]).toEqual({ phone: '0812', reason: 'PROSPECT_REFUSED' });
  });

  it('registers a business name at a pin when there is no phone', async () => {
    post.mockResolvedValue({ entries: 1, prospects: 0 });
    const onClose = vi.fn();
    render(<DncForm onClose={onClose} />);
    await userEvent.type(label('dnc.name'), 'Kos Mawar');
    await userEvent.type(label('pin.paste'), '-6.2, 106.9');
    await userEvent.selectOptions(label('dnc.reason'), 'LEGAL');
    await press('dnc.submit');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toEqual({ name: 'Kos Mawar', latitude: -6.2, longitude: 106.9, reason: 'LEGAL' });
    await press('dnc.cancel');
    expect(onClose).toHaveBeenCalled();
  });

  it('needs a phone, or a name with a pin, and shows a refusal', async () => {
    render(<DncForm onClose={vi.fn()} />);
    await press('dnc.submit');
    expect(await screen.findByText('opsFix.prospectsField.dnc.needInput')).toBeTruthy();
    await userEvent.type(label('dnc.name'), 'Kos Mawar');
    await press('dnc.submit');
    expect(await screen.findByText('opsFix.prospectsField.dnc.needInput')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await userEvent.type(label('dnc.phone'), '0812');
    post.mockRejectedValue(new FakeApiError(403, 'Tidak diizinkan'));
    await press('dnc.submit');
    expect(await screen.findByText('Tidak diizinkan')).toBeTruthy();
  });
});
