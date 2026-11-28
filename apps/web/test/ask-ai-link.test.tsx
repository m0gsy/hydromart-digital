// @vitest-environment jsdom
// HD-19: "Tanya AI" for the roles the AI web's Supervisor assistant opens for.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const role = vi.hoisted(() => ({ current: 'SUPERVISOR' }));
const platform = vi.hoisted(() => ({ open: vi.fn(() => true), customer: false }));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current } }),
}));
vi.mock('@/lib/platform', () => ({
  openExternal: platform.open,
  isCustomerApp: () => platform.customer,
}));

import { AskAiDepotLink, AskAiEntry, askAiUrl } from '@/components/ask-ai-link';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = LocaleProvider;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_AI_WEB_URL', 'https://ai.example.test/');
  role.current = 'SUPERVISOR';
  platform.customer = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Tanya AI', () => {
  it.each(['ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'])(
    'shows the menu entry for %s',
    (r) => {
      role.current = r;
      render(<AskAiEntry />, { wrapper });
      expect(screen.getByText('Tanya AI').closest('a')?.getAttribute('href')).toBe(
        'https://ai.example.test/asisten/supervisor',
      );
      expect(screen.getByText(/Asisten Supervisor di web AI/)).toBeTruthy();
    },
  );

  it.each(['KEPALA_DEPOT', 'STAFF_DEPOT', 'CUSTOMER', ''])('hides it for %s', (r) => {
    role.current = r;
    render(<AskAiEntry />, { wrapper });
    render(<AskAiDepotLink depotId="d-1" />, { wrapper });
    expect(document.querySelector('a')).toBeNull();
  });

  it('hides it in the customer app and when no AI web origin is configured', () => {
    platform.customer = true;
    const { container, rerender } = render(<AskAiEntry />, { wrapper });
    expect(container.querySelector('a')).toBeNull();
    platform.customer = false;
    vi.stubEnv('NEXT_PUBLIC_AI_WEB_URL', '');
    rerender(<AskAiEntry />);
    expect(container.querySelector('a')).toBeNull();
    expect(askAiUrl('d-1')).toBeNull();
  });

  it('the depot link carries the encoded depot id', () => {
    render(<AskAiDepotLink depotId="a b/1" />, { wrapper });
    expect(screen.getByText('Tanya AI tentang depot ini').closest('a')?.getAttribute('href')).toBe(
      'https://ai.example.test/asisten/supervisor?depot=a%20b%2F1',
    );
  });

  it('opens through the external-open helper (native browser) and runs onNavigate', () => {
    const onNavigate = vi.fn();
    render(<AskAiEntry onNavigate={onNavigate} />, { wrapper });
    const a = screen.getByText('Tanya AI').closest('a')!;
    fireEvent.click(a);
    expect(platform.open).toHaveBeenCalledWith('https://ai.example.test/asisten/supervisor');
    expect(onNavigate).toHaveBeenCalled();
  });
});
