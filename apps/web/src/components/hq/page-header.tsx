'use client';

import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { StubBadge } from '@/lib/hq/stubs';

// Shared HQ screen header (icon + title + subtitle, trailing actions + optional
// StubBadge). Matches the inline header used across the Milestone A–C screens; kept
// as one component so the Milestone D screens stay short and consistent.
export function HqPageHeader({
  icon: Icon,
  title,
  subtitle,
  stub,
  action,
}: {
  icon: Icon;
  title: string;
  subtitle?: string;
  stub?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {(action || stub) && (
        <div className="flex items-center gap-2">
          {action}
          {stub && <StubBadge />}
        </div>
      )}
    </div>
  );
}
