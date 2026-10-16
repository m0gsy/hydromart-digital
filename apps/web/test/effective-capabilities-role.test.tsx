// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCached, role } = vi.hoisted(() => ({
  getCached: vi.fn(),
  role: { current: 'KEPALA_DEPOT' },
}));

vi.mock('@/lib/api', () => ({ api: { getCached }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: role.current }, ready: true }),
}));

import { useEffectiveCapabilities } from '@/lib/use-effective-capabilities';

beforeEach(() => {
  getCached.mockReset();
  getCached.mockResolvedValue({ effective: { depotAdmin: ['SUPER_ADMIN'] } });
});

describe('useEffectiveCapabilities', () => {
  it('does not ask a role that cannot read the matrix, and keeps the compiled map', async () => {
    role.current = 'KEPALA_DEPOT';
    const { result } = renderHook(() => useEffectiveCapabilities());
    await new Promise((r) => setTimeout(r, 30));
    expect(getCached).not.toHaveBeenCalled();
    expect(result.current.depotAdmin).toContain('MANAGER');
  });

  it('reads the server matrix for a role that may, and applies its overrides', async () => {
    role.current = 'HEAD_OFFICE';
    const { result } = renderHook(() => useEffectiveCapabilities());
    await waitFor(() => expect(result.current.depotAdmin).toEqual(['SUPER_ADMIN']));
    expect(getCached).toHaveBeenCalledTimes(1);
  });
});
