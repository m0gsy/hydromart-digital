'use client';

import { useState } from 'react';

import { Button, Field, FormError, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { ProspectAssignee, ProspectDetail } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

import { saveError } from './save-error';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/** "Tugaskan": the staff of the owner depot (names only), or release the prospect. */
export function AssignForm({
  row,
  onDone,
  onStale,
  onCancel,
}: {
  row: ProspectDetail;
  onDone: (row: ProspectDetail) => void;
  onStale: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const staff = useAsync(
    () => api.get<ProspectAssignee[]>(endpoints.prospects.assignees(row.ownerDepotId as string), true),
    [row.ownerDepotId],
  );
  const [pick, setPick] = useState(row.assignedToId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(assigneeId: string | null) {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.patch<ProspectDetail>(
          endpoints.prospects.assign(row.id),
          { assigneeId, seenUpdatedAt: row.updatedAt },
          true,
        ),
      );
    } catch (e) {
      const failure = saveError(e, t);
      setStale(failure.stale);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (staff.loading) return <Skeleton className="h-24" />;
  if (staff.error) return <FormError message={t('opsFix.prospects.assignForm.loadFailed')} />;
  const list = staff.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 && <p className="text-sm text-muted">{t('opsFix.prospects.assignForm.noStaff')}</p>}
      <Field label={t('opsFix.prospects.assignForm.staff')} htmlFor="prospect-assignee">
        <select
          id="prospect-assignee"
          className={SELECT}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">{t('opsFix.prospects.assignForm.pick')}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {stale ? (
          <Button onClick={onStale}>{t('opsFix.prospects.actions.reload')}</Button>
        ) : (
          <Button loading={busy} disabled={!pick} onClick={() => submit(pick)}>
            {t('opsFix.prospects.actions.save')}
          </Button>
        )}
        {row.assignedToId && !stale && (
          <Button variant="secondary" loading={busy} onClick={() => submit(null)}>
            {t('opsFix.prospects.assignForm.unassign')}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t('opsFix.prospects.actions.cancel')}
        </Button>
      </div>
    </div>
  );
}
