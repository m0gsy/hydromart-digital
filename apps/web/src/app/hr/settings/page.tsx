'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/locale-context';

import { HrDepotPicker } from '@/components/hr/depot-picker';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { SettingsSchema } from '@/lib/hr';
import { isSuperAdmin } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

export default function HrSettingsPage() {
  const { t } = useT();
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

  /**
   * Typed values belong to the scope they were typed in. Switching GLOBAL→DEPOT (or to another
   * depot) used to keep them: the box still showed the old number and `save` still read it, so
   * Simpan wrote a value meant for the whole network as one depot's override. Payroll settings
   * — late fines, absence rates — with no trace of where the number came from.
   */
  useEffect(() => {
    setDrafts({});
  }, [scope, depotId]);

  async function save(key: string) {
    // Only what was actually TYPED. Falling back to the effective value made Simpan on an
    // untouched row persist the INHERITED number as an explicit override — a depot silently
    // pinned to today's global default, which then stopped following it.
    const value = drafts[key];
    if (value === undefined) {
      toast(t('hrFix.settings.noChange'), 'error');
      return;
    }
    if (scope === 'DEPOT' && !depotId) { toast(t('hrFix.settings.needDepotId'), 'error'); return; }
    try {
      await api.put(endpoints.hr.putSetting, { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key, value }, true);
      toast(t('hrFix.settings.saved'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.settings.saveFailed'), 'error');
    }
  }

  async function reset(key: string) {
    try {
      await api.del(endpoints.hr.resetSetting, { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key }, true);
      toast(t('hrFix.settingsExtra.overrideRemoved'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.settingsExtra.resetFailed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader title={t('hrFix.settings.title')} subtitle={t('hrFix.settings.subtitle')} />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">Cakupan
          <select value={scope} onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'DEPOT')} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
            <option value="GLOBAL">GLOBAL</option>
            <option value="DEPOT">DEPOT</option>
          </select>
        </label>
        {/* G-1: was `placeholder={t('hrFix.settings.depotIdHint')}`, next to a depot list this app already holds. */}
        {scope === 'DEPOT' && (
          <HrDepotPicker value={depotId} onChange={setDepotId} includeEmpty="Pilih depot…" />
        )}
      </Card>

      {scope === 'GLOBAL' && !superAdmin && <p className="text-sm text-amber-600">{t('hrFix.settings.globalOnly')}</p>}

      {loading && <Skeleton className="h-64" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.defs.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{d.label ?? d.key}</p>
                {/* The format, not only the value: "10000,15000,20000" is unguessable from an
                    empty box, and the server rejects anything else outright. */}
                {d.unit && <p className="text-xs text-muted">format: {d.unit}</p>}
                <p className="text-xs text-muted">
                  efektif: {String(data.effective[d.key] ?? '') || '(belum diisi)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* CONTROLLED, and keyed to the scope: an uncontrolled box kept the previous
                    scope's number on screen after the switch, which is half of how a GLOBAL
                    value came to be written as a DEPOT override. */}
                <Input
                  value={drafts[d.key] ?? String(data.effective[d.key] ?? '')}
                  placeholder={d.unit ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [d.key]: e.target.value }))}
                  className="w-32"
                />
                <Button variant="secondary" onClick={() => save(d.key)}>{t('hrFix.settings.save')}</Button>
                <Button variant="ghost" onClick={() => reset(d.key)}>{t('hrFix.settings.reset')}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
