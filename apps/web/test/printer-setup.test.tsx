/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrinterSetup } from '@/components/dashboard/printer-setup';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const printer: Record<string, ReturnType<typeof vi.fn>> = {};
let saved: { id: string; name: string } | null = null;

function install(overrides: Record<string, () => unknown> = {}) {
  const defaults: Record<string, () => unknown> = {
    getDefaultPrinter: () => ({ profile: saved }),
    requestPermissions: () => ({ bluetoothScan: 'granted', bluetoothConnect: 'granted' }),
    discoverPrinters: () => ({
      printers: [{ id: 'bt:1', name: 'RPP02N', transport: 'bluetooth' }],
    }),
    connectPrinter: () => ({ connected: true, paper: { widthMm: 58 } }),
    printText: () => ({}),
    removePrinter: () => undefined,
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    printer[k] = vi.fn(async () => v());
  }
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: { ThermalPrinter: printer },
  };
}

const draw = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <PrinterSetup open onClose={() => {}} />
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  saved = null;
  window.localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('PrinterSetup on the Android app', () => {
  it('finds a printer, saves it, and takes the paper width the printer reports', async () => {
    install();
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cari printer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pakai' }));

    await waitFor(() =>
      expect(printer.connectPrinter).toHaveBeenCalledWith({
        printerId: 'bt:1',
        setAsDefault: true,
      }),
    );
    await waitFor(() => expect(window.localStorage.getItem('hm.printer.paperMm')).toBe('58'));
    expect(await screen.findByText('Printer tersimpan.')).toBeTruthy();
  });

  it('says so when the scan finds nothing', async () => {
    install({ discoverPrinters: () => ({ printers: [] }) });
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cari printer' }));
    expect(await screen.findByText(/Tidak ada printer ditemukan/)).toBeTruthy();
  });

  it('does not scan when Bluetooth permission was refused', async () => {
    install({
      requestPermissions: () => ({ bluetoothScan: 'denied', bluetoothConnect: 'denied' }),
    });
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cari printer' }));
    expect(await screen.findByText(/Izin Bluetooth belum diberikan/)).toBeTruthy();
    expect(printer.discoverPrinters).not.toHaveBeenCalled();
  });

  it('names the reason when the printer cannot be reached', async () => {
    install({
      connectPrinter: () => {
        throw Object.assign(new Error('x'), { code: 'PAIRING_REQUIRED' });
      },
    });
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cari printer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pakai' }));
    expect(await screen.findByText(/Printer belum dipasangkan/)).toBeTruthy();
  });

  it('tests, then forgets, the saved printer', async () => {
    saved = { id: 'bt:1', name: 'RPP02N' };
    install();
    draw();

    expect(await screen.findByText('RPP02N')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Uji cetak' }));
    await waitFor(() => expect(printer.printText).toHaveBeenCalled());
    expect(await screen.findByText('Uji cetak terkirim.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lepas printer' }));
    await waitFor(() => expect(printer.removePrinter).toHaveBeenCalledWith({ printerId: 'bt:1' }));
    expect(await screen.findByText('Belum ada printer tersimpan. Struk dibagikan sebagai file.'));
  });

  it('remembers the paper width the cashier picks', async () => {
    install();
    draw();

    fireEvent.click(await screen.findByRole('radio', { name: '80 mm' }));
    expect(window.localStorage.getItem('hm.printer.paperMm')).toBe('80');
  });
});
