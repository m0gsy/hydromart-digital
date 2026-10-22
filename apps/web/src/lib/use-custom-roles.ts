'use client';

import { useEffect, useState } from 'react';

import type { CustomRoleDef, RoleSetting } from '@hydromart/access';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { can } from '@/lib/roles';

/**
 * The active custom roles, for the screens that offer a role to pick or filter by.
 *
 * Read with `staffAdmin` (the same permission the matrix read needs); a caller without it gets
 * an empty list rather than a refused request. Failure also yields an empty list: the screen
 * then offers the built-in roles it always did, which is the safe fallback.
 */
export function useCustomRoles(): CustomRoleDef[] {
  const { customer } = useAuth();
  const [roles, setRoles] = useState<CustomRoleDef[]>([]);
  const mayRead = can('staffAdmin', customer?.role);

  useEffect(() => {
    if (!mayRead) return;
    let alive = true;
    api
      .getCached<{ customRoles?: CustomRoleDef[] }>(endpoints.auth.matrix, true)
      .then((res) => {
        if (alive) setRoles(res.customRoles ?? []);
      })
      .catch((err: unknown) => {
        // The screen still offers the built-in roles, but a custom role vanishing from a picker is
        // not something to do silently: leave a trace for whoever is looking at the console.
        console.warn('Could not load custom roles; offering built-in roles only.', err);
      });
    return () => {
      alive = false;
    };
  }, [mayRead]);

  return roles;
}

/**
 * Built-in roles a SUPER_ADMIN has switched off. The server refuses to assign them, so a picker
 * should not offer them. Same read and same permission as `useCustomRoles`.
 */
export function useDisabledRoles(): ReadonlySet<string> {
  const { customer } = useAuth();
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const mayRead = can('staffAdmin', customer?.role);

  useEffect(() => {
    if (!mayRead) return;
    let alive = true;
    api
      .getCached<{ roleSettings?: RoleSetting[] }>(endpoints.auth.matrix, true)
      .then((res) => {
        if (alive) setOff(new Set((res.roleSettings ?? []).filter((r) => r.disabled).map((r) => r.roleKey)));
      })
      .catch((err: unknown) => {
        console.warn('Could not load role settings; offering every built-in role.', err);
      });
    return () => {
      alive = false;
    };
  }, [mayRead]);

  return off;
}
