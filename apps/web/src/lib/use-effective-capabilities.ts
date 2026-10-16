'use client';

import { useEffect, useState } from 'react';

import { CAPABILITIES, type Capability } from '@hydromart/access';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { can } from '@/lib/roles';

export type CapabilityHolders = Record<Capability, readonly string[]>;

interface MatrixResponse {
  effective?: Partial<Record<Capability, string[]>>;
}

/**
 * The capability→roles map the SERVER is enforcing right now: the compiled defaults with
 * the super admin's matrix overrides applied on top.
 *
 * Every screen that ANSWERS "who can do what" must read this rather than the compiled
 * `CAPABILITIES` import — otherwise an edit saved on /hq/access looks like it did nothing,
 * because the surrounding screens keep rendering whatever the bundle was built with. The
 * editor itself (rbac-matrix.tsx) keeps its own copy of this fetch: it needs a mutable
 * grid plus a baseline to diff against, which is a different shape from a read.
 *
 * Falls back to the compiled map when the call fails — stale beats blank.
 */
export function useEffectiveCapabilities(): CapabilityHolders {
  const [caps, setCaps] = useState<CapabilityHolders>(CAPABILITIES as CapabilityHolders);
  const { customer } = useAuth();
  // The matrix read is `staffAdmin`. A depot head opens the same "who can do what" screen and
  // got a 403 in the console for it, then silently used the compiled map — the outcome a
  // role that cannot read overrides should have, minus the refused request.
  const mayRead = can('staffAdmin', customer?.role);

  useEffect(() => {
    if (!mayRead) return;
    let alive = true;
    api
      .getCached<MatrixResponse>(endpoints.auth.matrix, true)
      .then((res) => {
        if (!alive || !res.effective) return;
        setCaps({ ...CAPABILITIES, ...res.effective } as CapabilityHolders);
      })
      .catch(() => {
        /* keep the compiled defaults already in state */
      });
    return () => {
      alive = false;
    };
  }, [mayRead]);

  return caps;
}
