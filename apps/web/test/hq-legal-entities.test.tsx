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
const INDO = {
  id: 'le-2',
  name: 'PT Indowater',
  kind: 'FRANCHISOR',
  active: true,
  updatedAt: '2026-11-22T02:00:00.000Z',
  aiReadRoles: [] as string[],
};
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
  { depotId: 'd-2', code: 'JKT-02', name: 'Depot Tutup', ownershipType: 'WARALABA', active: false, points: [] },
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

type Served = { entities?: unknown[]; depots?: unknown[]; failDir?: boolean; failEmployees?: boolean };
let served: Served = {};
function serve(next: Served = {}) {
  served = next;
  get.mockImplementation((path: string) => {
    if (path.endsWith('/legal-entities')) {
      return served.failDir
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ entities: served.entities ?? [KELOLA, INDO], roles: ROLES });
    }
    if (path.endsWith('/legal-entities/depots')) return Promise.resolve(served.depots ?? DEPOTS);
    if (path.endsWith('/employee-legal-entities')) {
      return served.failEmployees ? Promise.reject(new Error('down')) : Promise.resolve(EMPLOYEES);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}
const directoryReads = () => get.mock.calls.filter(([p]) => String(p).endsWith('/legal-entities')).length;
const depotReads = () => get.mock.calls.filter(([p]) => String(p).endsWith('/legal-entities/depots')).length;

describe('pointOn / nextPoint', () => {
  const points = DEPOTS[0]!.points;
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

  const depotRow = async () => (await screen.findByText('JKT-01 · Depot Cikini')).closest('tr')!;
  const depotPanel = () => screen.getByRole('region', { name: 'hq.legalEntities.assign.depots.title' });
  const depotEntity = () => screen.getByLabelText('hq.legalEntities.assign.entity', { selector: '#le-assign-depotIds' });

  it('shows each depot on the entity in force today, the dated change, and hides closed ones', async () => {
    render(<HqLegalEntitiesPage />);
    const row = await depotRow();
    expect(within(row).getByText('PT Kelola Air')).toBeTruthy();
    expect(within(row).getByText('hq.legalEntities.assign.scheduled')).toBeTruthy();
    expect(within(row).getByText('hq.depots.ownership.central')).toBeTruthy();
    expect(screen.queryByText('JKT-02 · Depot Tutup')).toBeNull();
    await userEvent.click(within(depotPanel()).getByLabelText('hq.legalEntities.assign.depots.showInactive'));
    expect(screen.getByText('JKT-02 · Depot Tutup')).toBeTruthy();
    // The raw code still finds it, beside the translated label.
    const search = within(depotPanel()).getByLabelText('hq.legalEntities.assign.depots.search');
    await userEvent.type(search, 'waralaba');
    expect(screen.queryByText('JKT-01 · Depot Cikini')).toBeNull();
    expect(screen.getByText('JKT-02 · Depot Tutup')).toBeTruthy();
    await userEvent.type(search, 'zzz');
    expect(within(depotPanel()).getByText('hq.legalEntities.assign.depots.noRows')).toBeTruthy();
  });

  it('names the depot each employee works at', async () => {
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('HR-0001 · Kasir · JKT-01')).toBeTruthy();
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

  it('sends the version the edit form was opened on, even after a reload brings a newer one', async () => {
    render(<HqLegalEntitiesPage />);
    // Entities render in the order the server sends them: [PT Kelola Air, PT Indowater].
    await userEvent.click((await screen.findAllByRole('button', { name: 'hq.legalEntities.entities.editing' }))[1]!);
    // Someone else renames it; a reload (here: adding another entity) brings that copy in.
    serve({ entities: [KELOLA, { ...INDO, name: 'PT Indowater Lain', updatedAt: '2026-11-22T03:00:00.000Z' }] });
    await userEvent.type(screen.getByLabelText('hq.legalEntities.entities.name', { selector: '#le-new-name' }), 'PT Baru');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    await waitFor(() => expect(directoryReads()).toBe(2));
    expect(await screen.findByText('hq.legalEntities.entities.changedElsewhere')).toBeTruthy();
    patch.mockRejectedValueOnce(new ApiError(409, 'stale', 'STALE_WRITE'));
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.save' }));
    expect(patch).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/le-2',
      { name: 'PT Indowater', kind: 'FRANCHISOR', seenUpdatedAt: INDO.updatedAt },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.common.staleWrite', 'error');
    await waitFor(() => expect(directoryReads()).toBe(3));
  });

  it('asks before switching an entity off, and sends a bare toggle', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<HqLegalEntitiesPage />);
    const off = (await screen.findAllByRole('switch'))[0]!;
    await userEvent.click(off);
    expect(confirm).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    await userEvent.click(off);
    expect(patch).toHaveBeenCalledWith('/depots/api/v1/legal-entities/le-1', { active: false }, true);
  });

  it('dates the selected depots from a day, and says so when nothing changed', async () => {
    render(<HqLegalEntitiesPage />);
    await userEvent.click(within(await depotRow()).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.selectOptions(depotEntity(), 'le-2');
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/depots',
      { depotIds: ['d-1'], legalEntityId: 'le-2', effectiveFrom: '2026-11-22', seen: [] },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.legalEntities.assign.unchanged', 'info');
  });

  it('tells the server what it showed for that day, and re-reads when the day changed meanwhile', async () => {
    post.mockRejectedValueOnce(new ApiError(409, 'stale', 'STALE_WRITE'));
    render(<HqLegalEntitiesPage />);
    await userEvent.click(within(await depotRow()).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.selectOptions(depotEntity(), 'le-2');
    const from = screen.getByLabelText('hq.legalEntities.assign.from', { selector: '#le-from-depotIds' });
    await userEvent.clear(from);
    await userEvent.type(from, '2026-01-01');
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' }));
    expect(post).toHaveBeenCalledWith(
      '/depots/api/v1/legal-entities/depots',
      { depotIds: ['d-1'], legalEntityId: 'le-2', effectiveFrom: '2026-01-01', seen: [{ id: 'd-1', legalEntityId: 'le-1' }] },
      true,
    );
    expect(await within(depotPanel()).findByText('hq.common.staleWrite')).toBeTruthy();
    await waitFor(() => expect(depotReads()).toBe(2));
    // Only that list: the directory and the employees are not read again for a depot write.
    expect(directoryReads()).toBe(1);
  });

  it('dates employees through hr-service', async () => {
    post.mockResolvedValue([{ employeeId: 'e-1', replaced: null }]);
    render(<HqLegalEntitiesPage />);
    const row = (await screen.findByText('Budi')).closest('tr')!;
    await userEvent.click(within(row).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.selectOptions(
      screen.getByLabelText('hq.legalEntities.assign.entity', { selector: '#le-assign-employeeIds' }),
      'le-1',
    );
    const panel = screen.getByRole('region', { name: 'hq.legalEntities.assign.employees.title' });
    await userEvent.click(within(panel).getByRole('button', { name: 'hq.legalEntities.assign.employees.apply' }));
    expect(post).toHaveBeenCalledWith(
      '/employees/api/v1/employee-legal-entities',
      { employeeIds: ['e-1'], legalEntityId: 'le-1', effectiveFrom: '2026-11-22', seen: [] },
      true,
    );
    expect(toast).toHaveBeenCalledWith('hq.legalEntities.assign.applied', 'success');
  });

  it('confirms before applying to selected rows the filter hides', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<HqLegalEntitiesPage />);
    await userEvent.click(within(await depotRow()).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.type(within(depotPanel()).getByLabelText('hq.legalEntities.assign.depots.search'), 'zzz');
    expect(within(depotPanel()).getByText('hq.legalEntities.assign.selectedHidden')).toBeTruthy();
    await userEvent.selectOptions(depotEntity(), 'le-2');
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'hq.legalEntities.assign.applyHiddenTitle' }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.clearSelection' }));
    expect(within(depotPanel()).queryByText('hq.legalEntities.assign.selectedHidden')).toBeNull();
  });

  it('sends a selection larger than one request takes in batches', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      depotId: `d-${i}`,
      code: `D-${String(i).padStart(3, '0')}`,
      name: 'Depot',
      ownershipType: 'HKP',
      active: true,
      points: [],
    }));
    serve({ depots: many });
    post.mockImplementation((_url: string, body: { depotIds: string[] }) =>
      Promise.resolve(body.depotIds.map((depotId) => ({ depotId, replaced: null }))),
    );
    render(<HqLegalEntitiesPage />);
    await screen.findByText('D-000 · Depot');
    await userEvent.click(within(depotPanel()).getByLabelText('hq.legalEntities.assign.depots.selectAll'));
    await userEvent.selectOptions(depotEntity(), 'le-1');
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls.map(([, body]) => (body as { depotIds: string[] }).depotIds.length)).toEqual([200, 200, 50]);
  }, 30_000);

  it('asks for rows and an entity before applying, and drops a picked entity once it is switched off', async () => {
    render(<HqLegalEntitiesPage />);
    await depotRow();
    const apply = () =>
      within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' });
    await userEvent.click(apply());
    expect(screen.getByText('hq.legalEntities.assign.needRows')).toBeTruthy();
    await userEvent.click(within(await depotRow()).getByLabelText('hq.legalEntities.assign.selectRow'));
    await userEvent.selectOptions(depotEntity(), 'le-2');
    // PT Indowater is switched off (here or elsewhere) and the screen reads it again.
    serve({ entities: [KELOLA, { ...INDO, active: false }] });
    await userEvent.click((await screen.findAllByRole('switch'))[1]!);
    await waitFor(() => expect(directoryReads()).toBe(2));
    await waitFor(() => expect((depotEntity() as HTMLSelectElement).value).toBe(''));
    await userEvent.click(apply());
    expect(screen.getByText('hq.legalEntities.assign.needEntity')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('deletes one dated point after asking, and reads the list again even when it was already gone', async () => {
    del.mockRejectedValueOnce(new ApiError(404, 'gone', 'DEPOT_LEGAL_ENTITY_POINT_NOT_FOUND'));
    render(<HqLegalEntitiesPage />);
    const row = await depotRow();
    await userEvent.click(within(row).getByRole('button', { name: 'hq.legalEntities.assign.history' }));
    expect(
      within(row).getByRole('button', { name: 'hq.legalEntities.assign.hideHistory' }).getAttribute('aria-expanded'),
    ).toBe('true');
    await userEvent.click(within(row).getAllByRole('button', { name: 'hq.legalEntities.assign.removeOne' })[1]!);
    expect(confirm).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/depots/api/v1/legal-entities/depots/p-1?legalEntityId=le-1', true);
    expect(toast).toHaveBeenCalledWith('gone', 'error');
    await waitFor(() => expect(depotReads()).toBe(2));
  });

  it('lets the superuser save only the cells that changed, and keeps them across a reload', async () => {
    render(<HqLegalEntitiesPage />);
    const cells = await screen.findAllByLabelText('hq.legalEntities.matrix.cell');
    // Row 0 is the fixed super admin row (two entities), then HEAD_OFFICE x 2, FINANCE x 2.
    expect((cells[0] as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(cells[2]!); // HEAD_OFFICE on PT Kelola Air: revoke
    await userEvent.click(cells[5]!); // FINANCE on PT Indowater: grant
    // Something else on the page reloads the directory; the two edits survive it.
    await userEvent.type(screen.getByLabelText('hq.legalEntities.entities.name', { selector: '#le-new-name' }), 'PT Baru');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    await waitFor(() => expect(directoryReads()).toBe(2));
    expect(screen.getByText('hq.legalEntities.matrix.dirty')).toBeTruthy();
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
    await waitFor(() => expect(screen.queryByText('hq.legalEntities.matrix.dirty')).toBeNull());
  });

  it('drops an edit the reload made true already', async () => {
    render(<HqLegalEntitiesPage />);
    const cells = await screen.findAllByLabelText('hq.legalEntities.matrix.cell');
    await userEvent.click(cells[5]!); // FINANCE on PT Indowater: grant
    expect(screen.getByText('hq.legalEntities.matrix.dirty')).toBeTruthy();
    serve({ entities: [KELOLA, { ...INDO, aiReadRoles: ['FINANCE'] }] });
    await userEvent.type(screen.getByLabelText('hq.legalEntities.entities.name', { selector: '#le-new-name' }), 'PT Baru');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    await waitFor(() => expect(directoryReads()).toBe(2));
    await waitFor(() => expect(screen.queryByText('hq.legalEntities.matrix.dirty')).toBeNull());
    // Somebody revokes it again later; the old tick must not come back as a change to save.
    serve({ entities: [KELOLA, INDO] });
    await userEvent.type(screen.getByLabelText('hq.legalEntities.entities.name', { selector: '#le-new-name' }), 'PT Dua');
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.entities.add' }));
    await waitFor(() => expect(directoryReads()).toBe(3));
    expect(screen.queryByText('hq.legalEntities.matrix.dirty')).toBeNull();
    expect((screen.getAllByLabelText('hq.legalEntities.matrix.cell')[5] as HTMLInputElement).checked).toBe(false);
  });

  it('shows head office the matrix read-only', async () => {
    role.current = 'HEAD_OFFICE';
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('hq.legalEntities.matrix.readOnly')).toBeTruthy();
    const cells = screen.getAllByLabelText('hq.legalEntities.matrix.cell') as HTMLInputElement[];
    expect(cells.every((c) => c.disabled)).toBe(true);
  });

  it('keeps the depots when hr-service cannot be read, and names what failed', async () => {
    serve({ failEmployees: true });
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('JKT-01 · Depot Cikini')).toBeTruthy();
    expect(screen.getByText('hq.legalEntities.loadErrorEmployees')).toBeTruthy();
    expect(screen.queryByText('Budi')).toBeNull();
  });

  it('shows the page error when the directory cannot be read', async () => {
    serve({ failDir: true });
    render(<HqLegalEntitiesPage />);
    expect(await screen.findByText('hq.legalEntities.loadError')).toBeTruthy();
  });

  it('keeps the copy on screen when a refresh fails, says so until a reload works', async () => {
    render(<HqLegalEntitiesPage />);
    await depotRow();
    expect(await screen.findByText('Budi')).toBeTruthy();
    serve({ failDir: true });
    await userEvent.click((await screen.findAllByRole('switch'))[1]!);
    expect(await screen.findByText('hq.legalEntities.reloadFailed')).toBeTruthy();
    expect(screen.getByText('JKT-01 · Depot Cikini')).toBeTruthy();
    expect(screen.getByText('PT Kelola Air')).toBeTruthy();
    serve();
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.reload' }));
    await waitFor(() => expect(screen.queryByText('hq.legalEntities.reloadFailed')).toBeNull());
  });

  it('lets only the newest refresh land, and a matrix save retire one still out', async () => {
    render(<HqLegalEntitiesPage />);
    await depotRow();
    // A refresh of the directory goes out (a toggle) and is held; the matrix is saved meanwhile.
    let release: (v: unknown) => void = () => undefined;
    get.mockImplementation((path: string) =>
      path.endsWith('/legal-entities')
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve(path.endsWith('/legal-entities/depots') ? DEPOTS : EMPLOYEES),
    );
    await userEvent.click((await screen.findAllByRole('switch'))[1]!);
    put.mockResolvedValueOnce({ entities: [KELOLA, { ...INDO, aiReadRoles: ['FINANCE'] }], roles: ROLES });
    const cells = screen.getAllByLabelText('hq.legalEntities.matrix.cell') as HTMLInputElement[];
    await userEvent.click(cells[5]!);
    await userEvent.click(screen.getByRole('button', { name: 'hq.legalEntities.matrix.save' }));
    await waitFor(() => expect((screen.getAllByLabelText('hq.legalEntities.matrix.cell')[5] as HTMLInputElement).checked).toBe(true));
    // The older read arrives after the save, with the grants as they were before it: ignored.
    release({ entities: [KELOLA, INDO], roles: ROLES });
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getAllByLabelText('hq.legalEntities.matrix.cell')[5] as HTMLInputElement).checked).toBe(true);
  });

  it('reports a batch that fails partway, says how many landed, and reads the list again', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      depotId: `d-${i}`,
      code: `D-${String(i).padStart(3, '0')}`,
      name: 'Depot',
      ownershipType: 'HKP',
      active: true,
      points: [],
    }));
    serve({ depots: many });
    post
      .mockImplementationOnce((_url: string, body: { depotIds: string[] }) =>
        Promise.resolve(body.depotIds.map((depotId) => ({ depotId, replaced: null }))),
      )
      .mockRejectedValueOnce(new ApiError(503, 'depot-service is down', 'UNAVAILABLE'));
    render(<HqLegalEntitiesPage />);
    await screen.findByText('D-000 · Depot');
    await userEvent.click(within(depotPanel()).getByLabelText('hq.legalEntities.assign.depots.selectAll'));
    await userEvent.selectOptions(depotEntity(), 'le-1');
    await userEvent.click(within(depotPanel()).getByRole('button', { name: 'hq.legalEntities.assign.depots.apply' }));
    expect(await within(depotPanel()).findByText('depot-service is down')).toBeTruthy();
    expect(toast).toHaveBeenCalledWith('hq.legalEntities.assign.applied', 'success');
    expect(post).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(depotReads()).toBe(2));
  }, 30_000);
});
