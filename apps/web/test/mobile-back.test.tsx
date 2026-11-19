// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Mobile rule B (flow plan). A screen opened from a push or a link is the first history entry:
 * an in-page back goes to the screen's parent instead of doing nothing, and the hardware back
 * goes home instead of closing the app from anywhere.
 */
const { back, replace, where } = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  where: { path: '/driver/deliveries/detail/fail', id: 'dl-1' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, replace, push: vi.fn() }),
  usePathname: () => where.path,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => where.id }));

import { backWithoutHistory } from '@/components/native-bridge';
import { parentOf } from '@/lib/screen-chrome';
import { useBack } from '@/lib/use-back';

afterEach(() => vi.clearAllMocks());

function BackButton() {
  const goBack = useBack();
  return (
    <button type="button" onClick={goBack}>
      back
    </button>
  );
}

describe('parentOf', () => {
  it("a delivery's sub-screen goes back to that delivery", () => {
    expect(parentOf('/driver/deliveries/detail/fail/', 'dl-1')).toBe(
      '/driver/deliveries/detail?id=dl-1',
    );
  });
  it('wallet screens go to the wallet, profile screens to the profile, approvals to the queue', () => {
    expect(parentOf('/driver/settlement/history')).toBe('/driver/settlement');
    expect(parentOf('/driver/expenses')).toBe('/driver/earnings');
    expect(parentOf('/driver/help')).toBe('/driver/profile');
    expect(parentOf('/m/manager/approvals/detail')).toBe('/m/manager/approvals');
  });
  it('keeps the shop map, and falls back home', () => {
    expect(parentOf('/orders/detail')).toBe('/orders');
    expect(parentOf('/nowhere')).toBe('/');
  });
});

describe('useBack', () => {
  it('goes back when there is history', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    render(<BackButton />);
    fireEvent.click(screen.getByText('back'));
    expect(back).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it('goes to the parent, keeping the delivery, when the screen was opened first', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    render(<BackButton />);
    fireEvent.click(screen.getByText('back'));
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/driver/deliveries/detail?id=dl-1');
  });
});

describe('the hardware back with nothing behind it', () => {
  it('goes home from anywhere but home', () => {
    expect(backWithoutHistory('/driver/deliveries/detail/', '/driver')).toBe('/driver');
    expect(backWithoutHistory('/m/manager/approvals/detail', '/m/manager')).toBe('/m/manager');
  });
  it('leaves at home and on a sign-in screen', () => {
    expect(backWithoutHistory('/driver/', '/driver')).toBe('exit');
    expect(backWithoutHistory('/m/manager/login', '/products')).toBe('exit');
    expect(backWithoutHistory('/', '/products')).toBe('exit');
  });
});

describe('no plain router.back() left on the console screens', () => {
  it('the courier app and the manager approval detail use useBack', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.tsx') && readFileSync(p, 'utf8').includes('router.back()'))
          offenders.push(p);
      }
    };
    walk(join(process.cwd(), 'src/app/driver'));
    walk(join(process.cwd(), 'src/app/m'));
    expect(offenders).toEqual([]);
  });
});
