// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, toast, download, auth } = vi.hoisted(() => ({
  auth: { role: 'SUPER_ADMIN' as string },
  get: vi.fn(),
  toast: vi.fn(),
  download: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { get, getCached: get } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: auth.role } }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/xlsx', () => ({ downloadXlsx: download }));
vi.mock('@/lib/all-depots', () => ({ fetchAllDepots: () => Promise.resolve([]) }));

import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import HqDepotsPage from '@/app/hq/depots/page';

const T = idDict.hq.depots;
const press = async () => {
  render(
    <LocaleProvider>
      <HqDepotsPage />
    </LocaleProvider>,
  );
  const button = await screen.findByRole('button', { name: T.export });
  await userEvent.click(button);
  return button;
};

describe('HQ depot export button', () => {
  beforeEach(() => {
    get.mockReset();
    toast.mockReset();
    download.mockReset();
    auth.role = 'SUPER_ADMIN';
  });
  afterEach(() => vi.clearAllMocks());

  it('downloads the file and stays quiet when everything fits', async () => {
    get.mockResolvedValue({ rows: [{ code: 'A' }], total: 1 });
    const button = await press();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![0]).toMatch(/^depot-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(toast).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('says so when the network outgrew one import file', async () => {
    get.mockResolvedValue({ rows: [{ code: 'A' }], total: 501 });
    await press();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('1'), 'error'));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('shows an error and re-enables the button when the export fails', async () => {
    get.mockRejectedValue(new Error('boom'));
    const button = await press();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(T.exportError, 'error'));
    expect(download).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it('hides the button from roles without depotAdmin', async () => {
    auth.role = 'FINANCE';
    render(
      <LocaleProvider>
        <HqDepotsPage />
      </LocaleProvider>,
    );
    await screen.findByText(T.title);
    expect(screen.queryByRole('button', { name: T.export })).toBeNull();
  });
});
