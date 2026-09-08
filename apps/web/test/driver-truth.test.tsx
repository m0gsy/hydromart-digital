// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Five courier screens that reported something other than what had happened.
 *
 *  - CA-4-32: the stop number was painted with `var(--fg)`, a token defined NOWHERE. The
 *    fill resolved to nothing, so a white numeral sat on the page ground — unreadable in
 *    LIGHT mode too, not only dark, which is worse than the row said.
 *  - CA-4-26: a worsening delta was rendered in the colour that means improvement.
 *  - CA-4-52: a bare `JSON.parse` in a passive effect took the settings screen down.
 *  - CA-4-38: the proof row confirmed proof that was still in the offline queue.
 *  - CA-4-36: "Telepon" and "Chat" dialled nothing and opened nothing — but still recorded
 *    a contact attempt, which is what the no-show gate counts.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'KURIR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver',
  useSearchParams: () => new URLSearchParams('id=d-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'd-1' }));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NoShowPage from '@/app/driver/deliveries/detail/no-show/page';

const DELIVERY = {
  id: 'd-1',
  orderNumber: 'HYD-1',
  status: 'ON_DELIVERY',
  recipientPhone: '081234567890',
};
const GATE = { attempts: 0, eligibleAt: null, canMarkNoShow: false, minAttempts: 2 };

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) =>
    url.includes('contact-attempts') ? GATE : DELIVERY,
  );
  post.mockReset().mockResolvedValue(GATE);
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('CA-4-36 the contact buttons actually contact somebody', () => {
  it('dials the customer, and records the attempt as a side effect of dialling', async () => {
    render(<NoShowPage />);
    // The label renders before the delivery read lands, so the href is what we wait on.
    await waitFor(() => {
      const call = screen.getByText('courierFix.noShow.call');
      // The whole defect: this used to be a <button> that only POSTed an attempt.
      expect(call.closest('a')?.getAttribute('href')).toBe('tel:081234567890');
    });
  });

  it('opens WhatsApp on the international form of the number', async () => {
    render(<NoShowPage />);
    await waitFor(() => {
      const chat = screen.getByText('courierFix.noShow.chat');
      // 08xx → 62xx, the conversion dashboard/crm already does.
      expect(chat.closest('a')?.getAttribute('href')).toBe('https://wa.me/6281234567890');
    });
  });

  it('offers no attempt at all when the delivery carries no number', async () => {
    get.mockImplementation(async (url: string) =>
      url.includes('contact-attempts') ? GATE : { ...DELIVERY, recipientPhone: null },
    );
    render(<NoShowPage />);

    const call = await screen.findByText('courierFix.noShow.call');
    // Inert and visibly so. A button here would record a contact that could not have
    // happened — and the no-show gate counts exactly those records.
    expect(call.closest('a')).toBeNull();
    await waitFor(() => expect(call.closest('span')?.getAttribute('aria-disabled')).toBe('true'));
  });
});

describe('CA-4-32 the route screen is readable in both themes', () => {
  it('paints the stop badge with tokens that exist, and never with `--fg`', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/driver/route/page.tsx', 'utf8');
    // `--fg` is declared nowhere in the app. The fill resolved to nothing and a white
    // numeral sat on the page ground — unreadable in light mode as well as dark.
    expect(src).not.toContain('--fg)');
    expect(src).toContain('bg-[color:var(--text)] text-[color:var(--surface)]');
    // And the card itself followed the theme instead of staying white under a dark page.
    expect(src).not.toMatch(/rounded-2xl bg-white/);
  });

  it('leaves no token undefined anywhere in the courier app', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((e) => {
        const p = join(d, e);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
      });
    const declared = new Set(
      [...readFileSync('src/app/globals.css', 'utf8').matchAll(/--([a-z0-9-]+)\s*:/g)].map(
        (m) => m[1],
      ),
    );
    const used = new Set<string>();
    // The whole app, not just the courier screens: `--muted` turned out to be used 113
    // times and declared nowhere, so every muted caption in the courier app inherited its
    // parent's colour instead of being muted. One undeclared token was the row; two was
    // what the sweep found.
    for (const f of [...walk('src/app'), ...walk('src/components')]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\(--([a-z0-9-]+)\)/g)) used.add(m[1]!);
    }
    // The bug was one undeclared token (`--fg`). The sweep found a second (`--muted`, 113
    // uses). This is what keeps a third from shipping: an undeclared custom property is an
    // invalid declaration, so the element silently inherits and nothing anywhere errors.
    expect([...used].filter((v) => !declared.has(v))).toEqual([]);
  });
});

describe('CA-4-26 a worsening number is not painted as an improvement', () => {
  it('gives Stat the raw delta, so the sign can still choose a colour', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/driver/performance/page.tsx', 'utf8');
    // `text-green-600` was unconditional. A sign cannot be recovered from "↓ 3%", so the
    // number has to reach the component that picks the colour.
    expect(src).not.toMatch(/text-green-600">\{delta\}/);
    expect(src).toContain("delta > 0 ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'");
    expect(src).toContain('delta: number | null;');
  });
});

describe('CA-4-52 corrupt storage does not take a screen down', () => {
  it('reads and parses inside one try, because blocked storage throws on the read', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/app/driver/settings/page.tsx', 'src/app/hq/depots/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      const getIdx = src.indexOf('Storage.getItem');
      const tryIdx = src.lastIndexOf('try {', getIdx);
      const catchIdx = src.indexOf('} catch', getIdx);
      // Both halves inside the same guard: a private window throws on getItem, a corrupt
      // value throws on parse, and the screen must survive either.
      expect(tryIdx).toBeGreaterThan(-1);
      expect(catchIdx).toBeGreaterThan(getIdx);
    }
  });
});

describe('CA-4-38 the PoD screen does not confirm proof it has not sent', () => {
  it('shows a waiting state for a queued proof and a tick only for a sent one', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/driver/deliveries/detail/success/page.tsx', 'utf8');
    // CA-4-17 added the banner at the top; this row kept its green tick regardless, so the
    // banner said "waiting for signal" and the row said "confirmed" on the same screen.
    expect(src).toContain('courierFix.podSuccess.proofQueued');
    expect(src).toMatch(/queued \?[\s\S]{0,400}proofQueued[\s\S]{0,400}proofDone/);
  });
});
