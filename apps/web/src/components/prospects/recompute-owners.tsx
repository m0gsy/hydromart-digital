'use client';

import { useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { Button, FormError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

interface RecomputeResult {
  checked: number;
  changed: number;
  nowOnMap: number;
}

/** HQ's monthly refresh of system-placed owner depots, with the counts the server returns. */
export function RecomputeOwners() {
  const { t } = useT();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const ok = await confirm({
      title: t('opsFix.prospectsIo.tools.recomputeTitle'),
      message: t('opsFix.prospectsIo.tools.recomputeBody'),
      confirmLabel: t('opsFix.prospectsIo.tools.recomputeConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<RecomputeResult>(endpoints.prospects.recomputeOwners, {}, true);
      setResult(t('opsFix.prospectsIo.tools.recomputeDone', { ...r }));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        t(
          status === 403
            ? 'opsFix.prospectsIo.tools.recomputeForbidden'
            : status === 503
              ? 'opsFix.prospectsIo.tools.recomputeUnavailable'
              : 'opsFix.prospectsIo.tools.recomputeFailed',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={run} loading={busy}>
        {t('opsFix.prospectsIo.tools.recompute')}
      </Button>
      <FormError message={error} />
      {result && (
        <p role="status" className="text-xs text-muted">
          {result}
        </p>
      )}
    </div>
  );
}
