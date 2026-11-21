'use client';

import { useState } from 'react';
import { Buildings, Storefront } from '@phosphor-icons/react';

import { OwnersEditor } from '@/components/hq/owners-editor';
import { Button, Card, RadioCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { ownerRowsFromDepot, toOwnershipPayload } from '@/lib/depots';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin } from '@/lib/types';

/**
 * Head office's form for who owns a depot: its type, its owners and their shares, and nothing
 * else. It saves through `PUT …/owners` (depotLifecycle). The full edit form saves through the
 * manager's PATCH, which head office may not send, so this was the change it could not make.
 */
export function DepotOwnersForm({
  depot,
  onDone,
  onCancel,
}: {
  depot: DepotAdmin;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [ownershipType, setOwnershipType] = useState(depot.ownershipType);
  const [owners, setOwners] = useState(() => ownerRowsFromDepot(depot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = toOwnershipPayload(ownershipType, owners, t);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(
        endpoints.depots.owners(depot.id),
        { ...parsed.value, seenUpdatedAt: depot.updatedAt },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.depots.form.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{t('hq.depotDetail.ownersTitle', { name: depot.name })}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <RadioCard selected={ownershipType === 'HKP'} onSelect={() => setOwnershipType('HKP')}>
          <Buildings size={22} weight="fill" className="text-brand-600" />
          <span className="text-sm font-semibold">{t('hq.depots.form.central')}</span>
        </RadioCard>
        <RadioCard
          selected={ownershipType === 'WARALABA'}
          onSelect={() => setOwnershipType('WARALABA')}
        >
          <Storefront size={22} weight="fill" className="text-brand-600" />
          <span className="text-sm font-semibold">{t('hq.depots.form.franchise')}</span>
        </RadioCard>
      </div>
      {ownershipType === 'WARALABA' && (
        <OwnersEditor value={owners} onChange={setOwners} idPrefix="d-owners" />
      )}
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('hq.depots.form.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('hq.depots.form.save')}
        </Button>
      </div>
    </Card>
  );
}
