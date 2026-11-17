// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ role: null as string | null }));

vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.role ? { role: auth.role } : null }),
}));

import { HomeLinkButton } from '@/components/home-link';

/*
 * The error and 404 screens sent everyone to /products. Two depot staff whose Ops app hit the
 * useLocation crash pressed it and were in the customer shop (2026-11-17).
 */
describe('HomeLinkButton', () => {
  it('sends a kepala depot back to the console, not the catalogue', () => {
    auth.role = 'KEPALA_DEPOT';
    render(<HomeLinkButton />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(link.textContent).toBe('hrFix.notFound.toConsole');
  });

  it('sends a courier to the courier app', () => {
    auth.role = 'STAFF_DEPOT';
    render(<HomeLinkButton />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/driver');
  });

  it.each([['CUSTOMER'], [null]])('keeps the catalogue for %s', (role) => {
    auth.role = role;
    render(<HomeLinkButton />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/products');
    expect(link.textContent).toBe('hrFix.notFound.toCatalog');
  });
});
