'use client';

import { useEffect, useState } from 'react';
import { MapPinArea } from '@phosphor-icons/react';

import { onResume } from '@/lib/app-lifecycle';
import { approximateOnly } from '@/lib/geo';
import { useT } from '@/lib/locale-context';

/**
 * Says so when this phone's app holds only "Perkiraan" (Android's approximate location).
 *
 * 2026-11-25: 44 of the 56 staff who punched that week were in that state, and with the HR fence
 * switched off nothing told them — their punches carried a point up to kilometres away, and the
 * courier shift check-in refused them at the depot door. The phone has to be switched in
 * Settings by the person holding it, so the notice names where.
 *
 * It never blocks a check-in (the server decides what a fix is worth) and never asks for a
 * permission itself: the fix's own request is the one dialog, and a second one burns the two
 * answers Android allows. It reads the permission again whenever the app comes back to the
 * front — which is what returning from Settings is — so it goes away once the switch is made.
 */
export function PreciseLocationNotice({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [approximate, setApproximate] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () => {
      void approximateOnly().then((yes) => {
        if (alive) setApproximate(yes);
      });
    };
    check();
    const stop = onResume(check);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!approximate) return null;
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 ${className}`}>
      <MapPinArea size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
      <p className="text-xs leading-snug text-amber-800">
        <span className="font-bold">{t('hrFix.preciseLocation.title')}</span>{' '}
        {t('hrFix.preciseLocation.body')}
      </p>
    </div>
  );
}
