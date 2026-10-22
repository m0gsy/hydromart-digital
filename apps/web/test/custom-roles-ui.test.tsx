// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customRoleLabel, isCustomRole, roleLabel } from '@/lib/custom-role';

const { get, put, post, del, getCached } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  getCached: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: { get, put, post, del, getCached } }));

import { BuiltInRolesPanel } from '@/app/hq/access/built-in-roles-panel';
import { CustomRolesPanel, DepotRulesPanel } from '@/app/hq/access/custom-roles-panels';
import { RbacMatrix } from '@/app/hq/access/rbac-matrix';
import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';

const DEPOT = '11111111-1111-1111-1111-111111111111';

const MATRIX = {
  effective: { dashboard: ['MANAGER', 'C_kasir'] },
  customRoles: [{ key: 'C_kasir', name: 'Kasir Depot', scope: 'LOCKED' }],
  roleSettings: [
    { roleKey: 'MANAGER', name: 'Manajer Wilayah', description: 'wilayah', scope: 'LOCKED', disabled: false },
    { roleKey: 'FINANCE', disabled: true },
  ],
  depotOverrides: [{ capability: 'dashboard', roleKey: 'C_kasir', depotId: DEPOT, effect: 'GRANT' }],
};

/** The app's own dialog, which replaces the banned window.confirm. */
const dialog = () => screen.findByRole('alertdialog');
const answer = async (label: RegExp) => {
  const d = await dialog();
  fireEvent.click(within(d).getByRole('button', { name: label }));
};
const switchOff = (row: HTMLElement) =>
  fireEvent.click(
    Array.from(row.querySelectorAll('button')).find((b) => /Nonaktifkan|Switch off/.test(b.textContent ?? '')) as HTMLElement,
  );

const wrap = (ui: React.ReactElement) =>
  render(
    <LocaleProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/access/matrix')) return MATRIX;
    if (url.endsWith('/access/roles'))
      return [
        { key: 'C_kasir', name: 'Kasir Depot', description: 'kasir', scope: 'LOCKED', archivedAt: null },
        { key: 'C_old', name: 'Lama', description: null, scope: 'GLOBAL', archivedAt: '2026-01-01' },
      ];
    return {};
  });
  getCached.mockResolvedValue({ items: [{ id: DEPOT, name: 'Depot A', code: 'A01' }], total: 1 });
  put.mockResolvedValue(undefined);
  post.mockResolvedValue({});
  del.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('custom role labels', () => {
  it('labels a custom key from its slug and leaves built-ins to the dictionary', () => {
    expect(isCustomRole('C_kasir')).toBe(true);
    expect(isCustomRole('MANAGER')).toBe(false);
    expect(isCustomRole(null)).toBe(false);
    expect(customRoleLabel('C_kasir_depot')).toBe('Kasir depot');
    expect(customRoleLabel('C_')).toBe('C_');
    const t = (k: string) => `T:${k}`;
    expect(roleLabel(t, 'C_kasir_depot')).toBe('Kasir depot');
    expect(roleLabel(t, 'MANAGER')).toBe('T:hq.roles.MANAGER');
    expect(roleLabel(t, 'MANAGER', 'x.y')).toBe('T:x.y.MANAGER');
  });
});

describe('RbacMatrix with a custom role', () => {
  it('adds a column for it, names built-ins from their setting, and blocks forbidden cells', async () => {
    wrap(<RbacMatrix />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Kas$/ })).toBeTruthy());
    // The custom column exists and the renamed built-in carries its new name.
    expect(screen.getAllByRole('button', { name: /Manajer Wilayah/ }).length).toBeGreaterThan(0);
    const forbidden = screen
      .getAllByRole('button', { pressed: false })
      .filter((b) => b.getAttribute('aria-label')?.includes('Kasir Depot') && (b as HTMLButtonElement).disabled);
    expect(forbidden.length).toBeGreaterThan(0);
    // An allowed cell is clickable and toggles.
    const cell = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-label')?.endsWith('Kasir Depot') && !(b as HTMLButtonElement).disabled);
    expect(cell).toBeTruthy();
    const before = cell?.getAttribute('aria-pressed');
    fireEvent.click(cell as HTMLElement);
    expect(cell?.getAttribute('aria-pressed')).not.toBe(before);
  });
});

describe('BuiltInRolesPanel', () => {
  it('shows names and state, edits a role, and never offers to switch off SUPER_ADMIN', async () => {
    const onChanged = vi.fn();
    wrap(<BuiltInRolesPanel refreshKey={0} onChanged={onChanged} />);
    await screen.findByText(/Manajer Wilayah/);
    // FINANCE is off; SUPER_ADMIN has no disable control (3 = 11 switchable roles minus nothing).
    const rows = screen.getAllByRole('listitem');
    const superRow = rows.find((r) => r.textContent?.includes('SUPER_ADMIN')) as HTMLElement;
    expect(superRow.textContent).not.toMatch(/Nonaktifkan|Switch off/);
    const financeRow = rows.find((r) => r.textContent?.includes('FINANCE')) as HTMLElement;
    expect(financeRow.textContent).toMatch(/Aktifkan|Switch on/);

    const managerRow = rows.find((r) => r.textContent?.includes('MANAGER')) as HTMLElement;
    fireEvent.click(managerRow.querySelector('button') as HTMLElement); // Ubah / Edit
    fireEvent.click(await screen.findByRole('button', { name: /Simpan|Save/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]?.[0]).toBe('/auth/api/v1/access/builtin/MANAGER');
    expect(put.mock.calls[0]?.[1]).toMatchObject({ name: 'Manajer Wilayah', scope: 'LOCKED' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('confirms before switching a role off, and does nothing when declined', async () => {
    wrap(<BuiltInRolesPanel refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText(/Manajer Wilayah/);
    const rows = screen.getAllByRole('listitem');
    const hrRow = rows.find((r) => r.textContent?.includes('· HR')) as HTMLElement;
    switchOff(hrRow);
    await answer(/Batal|Cancel/);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(put).not.toHaveBeenCalled();
    switchOff(hrRow);
    await answer(/Nonaktifkan|Switch off/);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/auth/api/v1/access/builtin/HR/disabled', { disabled: true }, true),
    );
  });

  it('surfaces a refusal from the server', async () => {
    put.mockRejectedValueOnce(new Error('Peran masih dipakai 2 akun.'));
    wrap(<BuiltInRolesPanel refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText(/Manajer Wilayah/);
    const hrRow = screen.getAllByRole('listitem').find((r) => r.textContent?.includes('· HR')) as HTMLElement;
    switchOff(hrRow);
    await answer(/Nonaktifkan|Switch off/);
    await screen.findByText(/masih dipakai 2 akun/);
  });
});

describe('CustomRolesPanel', () => {
  it('lists active roles only, creates one (optionally from a built-in), and archives', async () => {
    const onChanged = vi.fn();
    wrap(<CustomRolesPanel onChanged={onChanged} />);
    await screen.findByText('Kasir Depot');
    expect(screen.queryByText('Lama')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Buat peran|Create role/ }));
    const input = (await screen.findAllByRole('textbox'))[0] as HTMLElement;
    fireEvent.change(input, { target: { value: 'Manajer Kecil' } });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0] as HTMLElement, { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByRole('button', { name: /^Simpan$|^Save$/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ name: 'Manajer Kecil', copyFrom: 'MANAGER', scope: 'RESOLVED' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Arsipkan|Archive/ }));
    await answer(/Arsipkan|Archive/);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/auth/api/v1/access/roles/C_kasir', true));
  });

  it('edits an existing role with PUT', async () => {
    wrap(<CustomRolesPanel onChanged={vi.fn()} />);
    await screen.findByText('Kasir Depot');
    fireEvent.click(screen.getByRole('button', { name: /^Ubah$|^Edit$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Simpan$|^Save$/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]?.[0]).toBe('/auth/api/v1/access/roles/C_kasir');
  });

  it('shows the server error and keeps the form open', async () => {
    post.mockRejectedValueOnce(new Error('Peran dengan nama itu sudah ada'));
    wrap(<CustomRolesPanel onChanged={vi.fn()} />);
    await screen.findByText('Kasir Depot');
    fireEvent.click(screen.getByRole('button', { name: /Buat peran|Create role/ }));
    fireEvent.change((await screen.findAllByRole('textbox'))[0] as HTMLElement, { target: { value: 'Kasir Depot' } });
    fireEvent.click(screen.getByRole('button', { name: /^Simpan$|^Save$/ }));
    await screen.findByText(/sudah ada/);
  });
});

describe('DepotRulesPanel', () => {
  it('lists existing exceptions with the depot name, adds and removes one', async () => {
    wrap(<DepotRulesPanel refreshKey={0} />);
    await screen.findByText('Depot A · A01', { selector: 'td' });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[2] as HTMLElement, { target: { value: DEPOT } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah pengecualian|Add exception/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]?.[0]).toBe(`/auth/api/v1/access/matrix/dashboard/depots/${DEPOT}`);
    expect(put.mock.calls[0]?.[1]).toEqual({ roleKey: 'STAFF_DEPOT', effect: 'GRANT' });

    fireEvent.click(screen.getByRole('button', { name: /^Hapus$|^Remove$/ }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/auth/api/v1/access/matrix/dashboard/depots/${DEPOT}/C_kasir`, true),
    );
  });

  it('hides forbidden capabilities once a custom role is picked, and needs a depot to add', async () => {
    wrap(<DepotRulesPanel refreshKey={0} />);
    await screen.findByText('Depot A · A01', { selector: 'td' });
    expect((screen.getByRole('button', { name: /Tambah pengecualian|Add exception/ }) as HTMLButtonElement).disabled).toBe(true);
    const [role, capability] = screen.getAllByRole('combobox') as [HTMLSelectElement, HTMLSelectElement];
    const before = capability.options.length;
    fireEvent.change(role, { target: { value: 'C_kasir' } });
    expect(capability.options.length).toBeLessThan(before);
  });

  it('shows an unknown depot instead of a raw id, and an error from the server', async () => {
    getCached.mockResolvedValue({ items: [], total: 0 });
    wrap(<DepotRulesPanel refreshKey={0} />);
    await screen.findByText(/depot tidak dikenal|unknown depot/);
    get.mockRejectedValueOnce(new Error('boom'));
    cleanup();
    wrap(<DepotRulesPanel refreshKey={1} />);
    await screen.findByText('boom');
  });
});

describe('roleScope from the session', () => {
  it('answers for the signed-in role from the server, and from the compiled list for any other', async () => {
    const { loadSessionCapabilities, canWritePromoRule, isDepotResolvedRole } = await import('@/lib/roles');
    const rule = { depotId: null };
    // Compiled: a MANAGER is depot-limited, a custom role is not known.
    expect(isDepotResolvedRole('MANAGER')).toBe(true);
    expect(isDepotResolvedRole('C_kasir')).toBe(false);
    loadSessionCapabilities('C_kasir', ['promoRuleWrite'], 'RESOLVED');
    expect(isDepotResolvedRole('C_kasir')).toBe(true);
    expect(canWritePromoRule('C_kasir', rule)).toBe(false);
    loadSessionCapabilities('C_kasir', ['promoRuleWrite'], 'GLOBAL');
    expect(isDepotResolvedRole('C_kasir')).toBe(false);
    expect(canWritePromoRule('C_kasir', rule)).toBe(true);
    // A SUPER_ADMIN-narrowed HR is depot-limited; the compiled MANAGER answer is untouched.
    loadSessionCapabilities('HR', ['promoRuleWrite'], 'LOCKED');
    expect(canWritePromoRule('HR', rule)).toBe(false);
    expect(isDepotResolvedRole('MANAGER')).toBe(true);
    loadSessionCapabilities(null, null);
  });
});

describe('a failed read is not shown as the live data', () => {
  it('the matrix says so, and locks every cell', async () => {
    get.mockRejectedValue(new Error('503 down'));
    wrap(<RbacMatrix />);
    await screen.findByText(/503 down/);
    expect(screen.getByRole('alert').textContent).toMatch(/gagal dibaca|could not be read/);
    const cells = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('the built-in panel will not open an edit form from settings it never read', async () => {
    get.mockRejectedValue(new Error('503 down'));
    wrap(<BuiltInRolesPanel refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText(/503 down/);
    const edits = screen.getAllByRole('button', { name: /^Ubah$|^Edit$/ });
    expect(edits.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    const off = screen.getAllByRole('button', { name: /Nonaktifkan|Switch off/ });
    expect(off.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('the depot panel shows the raw id and a warning when the depot list could not be read', async () => {
    getCached.mockRejectedValue(new Error('depots down'));
    wrap(<DepotRulesPanel refreshKey={0} />);
    await screen.findByText(DEPOT, { selector: 'td' });
    expect(screen.queryByText(/depot tidak dikenal|unknown depot/)).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('the depot panel treats a truncated depot list as incomplete, not as "unknown"', async () => {
    getCached.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, i) => ({ id: `d-${i}`, name: `D${i}`, code: `C${i}` })),
      total: 250,
    });
    wrap(<DepotRulesPanel refreshKey={0} />);
    await screen.findByText(DEPOT, { selector: 'td' });
    expect(screen.queryByText(/depot tidak dikenal|unknown depot/)).toBeNull();
  });
});

describe('role pickers', () => {
  it('useDisabledRoles / useCustomRoles read the matrix only for a role that may, and warn on failure', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.doMock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'SUPER_ADMIN' } }) }));
    const { useCustomRoles, useDisabledRoles } = await import('@/lib/use-custom-roles');
    function Probe() {
      const custom = useCustomRoles();
      const off = useDisabledRoles();
      return <p data-testid="p">{custom.map((r) => r.key).join(',')}|{[...off].join(',')}</p>;
    }
    getCached.mockResolvedValue(MATRIX);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('C_kasir|FINANCE'));
    cleanup();

    getCached.mockRejectedValue(new Error('down'));
    render(<Probe />);
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('p').textContent).toBe('|');
    warn.mockRestore();
    vi.doUnmock('@/lib/auth-context');
  });

  it('a role without staffAdmin never makes the request', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'CUSTOMER' } }) }));
    const { useCustomRoles } = await import('@/lib/use-custom-roles');
    function Probe() {
      return <p data-testid="q">{useCustomRoles().length}</p>;
    }
    getCached.mockClear();
    render(<Probe />);
    expect(screen.getByTestId('q').textContent).toBe('0');
    expect(getCached).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/auth-context');
  });
});
