// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, put, del, role, confirm, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  role: { current: 'SUPER_ADMIN' },
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, put, del },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: role.current } }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('@/lib/wib', async (orig) => ({
  ...(await orig<typeof import('@/lib/wib')>()),
  todayWib: () => '2026-11-22',
}));

import HqLegalEntitiesPage from '@/app/hq/legal-entities/page';
import { ApiError } from '@/lib/api';
import { nextPoint, pointOn } from '@/lib/legal-entities';

const KELOLA = {
  id: 'le-1',
  name: 'PT Kelola Air',
  kind: 'OPERATOR',
  active: true,
  updatedAt: '2026-11-22T01:00:00.000Z',
  aiReadRoles: ['HEAD_OFFICE'],
};
const INDO = { ...KELOLA, id: 'le-2', name: 'PT Indowater', kind: 'FRANCHISOR', aiReadRoles: [] };
const ROLES = [
  { key: 'HEAD_OFFICE', name: null, custom: false },
  { key: 'FINANCE', name: null, custom: false },
];
const DEPOTS = [
  {
    depotId: 'd-1',
    code: 'JKT-01',
    name: 'Depot Cikini',
    ownershipType: 'HKP',
    active: true,
    points: [
      { id: 'p-2', legalEntityId: 'le-2', effectiveFrom: '2027-01-01' },
      { id: 'p-1', legalEntityId: 'le-1', effectiveFrom: '2026-01-01' },
    ],
  },
  { depotId: 'd-2', code: 'JKT-02', name: 'Depot Tutup', ownershipType: 'HKP', active: false, points: [] },
];
const EMPLOYEES = [
  {
    employeeId: 'e-1',
    employeeCode: 'HR-0001',
    fullName: 'Budi',
    position: 'Kasir',
    depotId: 'd-1',
    status: 'ACTIVE',
    points: [],
  },
];

function serve({ employeesFail = false } = {}) {
  get.mockImplementation((path: string) => {
    if (path.endsWith('/legal-entities')) return Promise.resolve({ entities: [KELOLA, INDO], roles: ROLES });
    if (path.endsWith('/legal-entities/depots')) return Promise.resolve(DEPOTS);
    if (path.endsWith('/employee-legal-entities')) {
      return employeesFail ? Promise.reject(new Error('down')) : Promise.resolve(EMPLOYEES);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe('pointOn / nextPoint', () => {
  const points = DEPOTS[0].points;
  it('reads the point in force on a day and the next dated change', () => {
    expect(pointOn(points, '2026-11-22')?.id).toBe('p-1');
    expect(pointOn(points, '2027-01-01')?.id).toBe('p-2');
    expect(pointOn(points, '2025-12-31')).toBeNull();
    expect(nextPoint(points, '2026-11-22')?.id).toBe('p-2');
    expect(nextPoint(points, '2027-01-01')).toBeNull();
  });
});

describe('/hq/legal-entities', () => {
  beforeEach(() => {
    role.current = 'SUPER_ADMIN';
    serve();
    post.mockResolvedValue([]);
    patch.mockResolvedValue({});
    put.mockResolvedValue({ entities: [KELOLA, INDO], roles: ROLES });
    del.mockResolvedValue(undefined);
    confirm.mockResolvedValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it('shows each depot on the entity in force today, the dated change, and hides closed ones', async () => {
    render(<HqLegalEntitiesPage />);
    const row = (await screen.findByText('JKT-01 · Depot Cikini')).closest('tr')!;
    expect(within(row).getByText('PT Kelola Air')).toBeTruthy();
    expect(within(row).getByText('hq.legalEntities.assign.scheduled')).toBeTruthy();
    expect(screen.queryByText('JKT-02 · Depot Tutup')).toBeNull();
    await userEvent.click(screen.getAllByLabelText('hq.legalEntities.assign.showInactive')[0]);
    expect(screen.getByText('JKT-02 · Depot Tutup')).toBeTruthy();
  });

  it('adds an entity with its trimmed name and kind', async () => {
    render(<HqLegalEntitiesPage />);
    await userEvent.type(await screen.findByLabelText('hq.legalEntities.entities.name'), '  PT Mitra Satu ');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    expect(post).toHaveBeenCalledWith('/depots/api/v1/legal-entities', { name: 'PT Mitra Satu', kind: 'FRANCHISEE' }, true);
  });

  it('refuses a one-letter name before asking the server', async () => {
    render(<HqLegalEntitiesPage />);
    await userEvent.type(await screen.findByLabelText('hq.legalEntities.entities.name'), 'P');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('hq.legalEntities.entities.nameTooShort')).toBeTruthy();
  });

  it('renames with the version it read, and re-reads on a stale save', async () => {
    patch.mockRejectedValueOnce(new ApiError(409, 'stale', 'STALE_WRITE'));
    render(<HqLegalEntitiesPage />);
    // Entities render in the order the server sends them: [PT Kelola Air, PT Indowater].
    await userEvent.click((await screen.findAllByRole('button', { name: 'hq.legalEntities.entities.edit' }))[1]);
    const input = screen.getByDisplayValue('PT Indowater');
    await userEvent.clear(input);
    await userEvent.type(input, 'PT Indowater Baru');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.save' }));
    expect(patch).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/le-2',
      { name: 'PT Indowater Baru', kind: 'FRANCHISOR', seenUpdatedAt: KELOLA.updatedAt },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.common.staleWrite', 'error');
    await waitFor(() => expect(get.mock.calls.filter(([p]) => String(p).endsWith('/legal-entities')).length).toBe(2));
  });

  it('switches an entity off with a bare toggle', async () => {
    render(<HqLegalEntitiesPage />);
    await userEvent.click((await screen.findAllByRole('switch'))[0]);
    expect(patch).toHaveBeenCalledWith('/depots/api/v1/legal-entities/le-1', { active: false }, true);
  });

  it('dates the selected depots from a day, and says so when nothing changed', async () => {
    render(<HqLegalEntitiesPage />);
    const row = (await screen.findByText('JKT-01 · Depot Cikini')).closest('tr')!;
    await userEvent.click(within(row).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.selectOptions(screen.getByLabelText('hq.legalEntities.assign.entity', { selector: '#le-assign-depotIds' }), 'le-2');
    const apply = screen.getAllByRole('button', { name: /hq\.legalEntities\.assign\.apply/ })[0];
    await userEvent.click(apply);
    expect(post).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/depots',
      { depotIds: ['d-1'], legalEntityId: 'le-2', effectiveFrom: '2026-11-22' },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.legalEntities.assign.unchanged', 'info');
  });

  it('asks for rows and an entity before applying', async () => {
    render(<HqLegalEntitiesPage />);
    const apply = (await screen.findAllByRole('button', { name: /hq\.legalEntities\.assign\.apply/ }))[0];
    await userEvent.click(apply);
    expect(screen.getByText('hq.legalEntities.assign.needRows')).toBeTruthy();
    const row = screen.getByText('JKT-01 · Depot Cikini').closest('tr')!;
    await userEvent.click(within(row).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.click(apply);
    expect(screen.getByText('hq.legalEntities.assign.needEntity')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('deletes one dated point after asking', async () => {
    post.mockResolvedValue([{ depotId: 'd-1', replaced: null }]);
    render(<HqLegalEntitiesPage />);
    const row = (await screen.findByText('JKT-01 · Depot Cikini')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'hq.legalEntities.assign.history' }));
    await userEvent.click(within(row).getAllByRole('button', { name: 'hq.legalEntities.assign.remove' })[1]);
    expect(confirm).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/depots/api/v1/legal-entities/depots/p-1', true);
  });

  it('lets the superuser save only the cells that changed', async () => {
    render(<HqLegalEntitiesPage />);
    const cells = await screen.findAllByLabelText('hq.legalEntities.matrix.cell');
    // Row 0 is the fixed super admin row (two entities), then HEAD_OFFICE x 2, FINANCE x 2.
    expect((cells[0] as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(cells[2]); // HEAD_OFFICE on PT Kelola Air: revoke
    await userEvent.click(cells[5]); // FINANCE on PT Indowater: grant
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.matrix.save' }));
    expect(put).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/ai-grants',
      {
        changes: [
          { legalEntityId: 'le-1', roleKey: 'HEAD_OFFICE', granted: false },
          { legalEntityId: 'le-2', roleKey: 'FINANCE', granted: true },
        ],
      },
      true,
    );
  });

  it('shows head office the matrix read-only', async () => {
    role.current = 'HEAD_OFFICE';
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('hq.legalEntities.matrix.readOnly')).toBeTruthy();
    const cells = screen.getAllByLabelText('hq.legalEntities.matrix.cell') as HTMLInputElement[];
    expect(cells.every((c) => c.disabled)).toBe(true);
  });

  it('keeps the depots when hr-service cannot be read', async () => {
    serve({ employeesFail: true });
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('JKT-01 · Depot Cikini')).toBeTruthy();
    expect(screen.queryByText('Budi')).toBeNull();
  });
});
