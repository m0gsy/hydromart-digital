// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const { downloadXlsx, downloadCsv } = vi.hoisted(() => ({
  downloadXlsx: vi.fn(),
  downloadCsv: vi.fn(),
}));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/xlsx', () => ({ downloadXlsx }));
vi.mock('@/lib/csv', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadCsv,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));

import { LocaleProvider } from '@/lib/locale-context';
import HqAuditPage from '@/app/hq/audit/page';
import HqChurnPage from '@/app/hq/churn/page';

const renderPage = (node: React.ReactElement): void => {
  render(<LocaleProvider>{node}</LocaleProvider>);
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  downloadXlsx.mockReset();
  downloadCsv.mockReset();
  toast.mockReset();
  post.mockResolvedValue({ id: 'camp-1' });
});
afterEach(() => vi.clearAllMocks());

/*
 * These two buttons said the work had happened and did nothing. A toast is the only
 * feedback either produced, so from the operator's side a re-engagement campaign that was
 * never created is indistinguishable from one that was.
 */
describe('hq/audit export', () => {
  const ENTRY = {
    id: 'a-1',
    actorName: 'Sari',
    actorEmail: 's@x.id',
    actorRole: 'SUPER_ADMIN',
    target: 'depot-1',
    action: 'depot.update',
    createdAt: new Date().toISOString(),
  };

  it('writes a real workbook from the rows on screen', async () => {
    get.mockResolvedValue({ items: [ENTRY], total: 1, page: 1, limit: 100 });
    const user = userEvent.setup();
    renderPage(<HqAuditPage />);

    await user.click(await screen.findByRole('button', { name: /Ekspor|Export/i }));

    expect(downloadXlsx).toHaveBeenCalledTimes(1);
    const [fileName, , body] = downloadXlsx.mock.calls[0] ?? [];
    expect(String(fileName)).toMatch(/\.xlsx$/);
    expect(body).toEqual([['Sari', 'SUPER_ADMIN', 'depot-1', 'depot.update', ENTRY.createdAt]]);
  });

  // An export of nothing is a file the reader has to open to discover is empty.
  it('refuses to write an empty file', async () => {
    get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    const user = userEvent.setup();
    renderPage(<HqAuditPage />);

    await user.click(await screen.findByRole('button', { name: /Ekspor|Export/i }));
    expect(downloadXlsx).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.anything(), 'error');
  });
});

describe('hq/churn re-engage', () => {
  const AT_RISK = {
    customerId: 'c-1',
    customerName: 'Bima',
    lastOrderAt: '2026-05-01T00:00:00.000Z',
    orderCount: 4,
    daysSince: 90,
    riskScore: 0.8,
    riskBand: 'HIGH',
  };

  it('creates and sends a real one-customer campaign', async () => {
    get.mockResolvedValue({ customers: [AT_RISK] });
    const user = userEvent.setup();
    renderPage(<HqChurnPage />);

    await user.click(await screen.findByRole('button', { name: /Re-engage|Hubungi/i }));

    const [createPath, createBody] = post.mock.calls[0] ?? [];
    expect(createPath).toBe('/crm/api/v1/campaigns');
    // `customerIds`, not an explicit recipient list: this screen has no phone number, and
    // the customer directory is what turns the id into a reachable one.
    expect(createBody).toMatchObject({ segment: { customerIds: ['c-1'] } });
    // A draft nobody dispatches is the same dead button one layer down.
    expect(post.mock.calls[1]?.[0]).toBe('/crm/api/v1/campaigns/camp-1/send');
  });
});
