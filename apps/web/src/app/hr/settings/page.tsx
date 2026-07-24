'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { SettingsSchema } from '@/lib/hr';
import { isSuperAdmin } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

export default function HrSettingsPage() {
  const { customer } = useAuth();
  const { toast } = useToast();
  const superAdmin = isSuperAdmin(customer?.role);
  const [scope, setScope] = useState<'GLOBAL' | 'DEPOT'>('GLOBAL');
  const [depotId, setDepotId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const effDepot = scope === 'DEPOT' && depotId ? depotId : undefined;
  const { data, error, loading, reload } = useAsync<SettingsSchema>(
    () => api.get<SettingsSchema>(endpoints.hr.settingsSchema(effDepot), true),
    [effDepot],
  );

  async function save(key: string) {
    const value = drafts[key] ?? String(data?.effective[key] ?? '');
    if (scope === 'DEPOT' && !depotId) { toast('Isi depotId untuk override DEPOT', 'error'); return; }
    try {
      await api.put(endpoints.hr.putSetting, { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key, value }, true);
      toast('Tersimpan');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error');
    }
  }

  async function reset(key: string) {
    try {
      await api.del(endpoints.hr.resetSetting, { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key }, true);
      toast('Override dihapus');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal reset', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader title="Konfigurasi Gaji" subtitle="Default GLOBAL (SUPER_ADMIN) atau override per depot" />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">Cakupan
          <select value={scope} onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'DEPOT')} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
            <option value="GLOBAL">GLOBAL</option>
            <option value="DEPOT">DEPOT</option>
          </select>
        </label>
        {scope === 'DEPOT' && <label className="text-sm">Depot ID<Input value={depotId} onChange={(e) => setDepotId(e.target.value)} placeholder="UUID depot" className="w-64" /></label>}
      </Card>

      {scope === 'GLOBAL' && !superAdmin && <p className="text-sm text-amber-600">Hanya SUPER_ADMIN yang dapat mengubah default GLOBAL.</p>}

      {loading && <Skeleton className="h-64" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.defs.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{d.label ?? d.key}</p>
                <p className="text-xs text-muted">efektif: {String(data.effective[d.key])}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={String(data.effective[d.key] ?? '')}
                  onChange={(e) => setDrafts((p) => ({ ...p, [d.key]: e.target.value }))}
                  className="w-32"
                />
                <Button variant="secondary" onClick={() => save(d.key)}>Simpan</Button>
                <Button variant="ghost" onClick={() => reset(d.key)}>Reset</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
