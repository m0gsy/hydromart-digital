/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* "Masuk dengan kode SMS" asks before it gives up a session that a fingerprint or PIN opens. */
vi.setConfig({ testTimeout: 30_000 });

const store = vi.hoisted(() => ({
  clearTokens: vi.fn(),
  hasTokens: vi.fn(() => true),
  retryUnlock: vi.fn(async () => {}),
}));
vi.mock('@/lib/token-store', () => store);
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: null }) }));

import { KeepSessionConfirm } from '@/components/keep-session-confirm';
import LockScreen from '@/components/session-lock-screen';
import { LocaleProvider } from '@/lib/locale-context';

function mount() {
  const props = { busy: false, setBusy: vi.fn(), onUnlocked: vi.fn(), onGuest: vi.fn() };
  render(
    <LocaleProvider>
      <LockScreen {...props} />
    </LocaleProvider>,
  );
  return props;
}

beforeEach(() => {
  localStorage.clear();
  Object.values(store).forEach((m) => m.mockClear());
});
afterEach(cleanup);

describe('lock screen: SMS confirm', () => {
  it('the SMS button asks first and gives nothing up', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Masuk dengan kode SMS' }));
    expect(screen.getByText('Sesi kamu masih tersimpan')).toBeTruthy();
    expect(store.clearTokens).not.toHaveBeenCalled();
    expect(localStorage.getItem('hm_session_drop')).toBeNull();
  });

  it('"Tetap pakai kode SMS" clears the tokens and writes lock_sms', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Masuk dengan kode SMS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tetap pakai kode SMS' }));
    expect(store.clearTokens).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('hm_session_drop')).toBe('lock_sms');
  });

  it('"Buka sesi" in the confirm opens the session instead', async () => {
    const props = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Masuk dengan kode SMS' }));
    const buttons = screen.getAllByRole('button', { name: 'Buka sesi' });
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]!);
    });
    expect(store.retryUnlock).toHaveBeenCalledTimes(1);
    expect(store.clearTokens).not.toHaveBeenCalled();
    expect(props.onUnlocked).toHaveBeenCalled();
  });
});

describe('the confirm inside the login form', () => {
  it('never submits the form around it, and lands focus on "Buka sesi"', () => {
    const submitted = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    const onOpen = vi.fn();
    const onSkip = vi.fn();
    render(
      <LocaleProvider>
        <form onSubmit={submitted}>
          <KeepSessionConfirm onOpen={onOpen} onSkip={onSkip} />
        </form>
      </LocaleProvider>,
    );
    const open = screen.getByRole('button', { name: 'Buka sesi' });
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Tetap pakai kode SMS' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
  });
});
