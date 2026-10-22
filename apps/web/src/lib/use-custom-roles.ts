'use client';

import { useEffect, useState } from 'react';

import type { CustomRoleDef } from '@hydromart/access';
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
      .catch(() => {
        /* keep the built-in list */
      });
    return () => {
      alive = false;
    };
  }, [mayRead]);

  return roles;
}
