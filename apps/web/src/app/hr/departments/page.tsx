'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { type Department } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

export default function DepartmentsPage() {
  const { customer } = useAuth();
  const { depots } = useDepot();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const departments = useAsync<Department[]>(
    () => api.get<Department[]>(endpoints.hr.departments(), true),
    [],
  );

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [depotId, setDepotId] = useState('');

  function fail(e: unknown) {
    toast(e instanceof ApiError ? e.message : 'Gagal', 'error');
  }

  async function add() {
    if (!code.trim() || !name.trim()) {
      toast('Isi kode & nama', 'error');
      return;
    }
    try {
      await api.post(
        endpoints.hr.createDepartment,
        { code: code.trim(), name: name.trim(), ...(depotId ? { depotId } : {}) },
        true,
      );
      toast('Departemen ditambahkan');
      setCode('');
      setName('');
      departments.reload();
    } catch (e) {
      fail(e);
    }
  }

  async function toggle(d: Department) {
    try {
      await api.patch(endpoints.hr.updateDepartment(d.id), { active: !d.active }, true);
      toast(d.active ? 'Dinonaktifkan' : 'Diaktifkan');
      departments.reload();
    } catch (e) {
      fail(e);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(endpoints.hr.deleteDepartment(id), true);
      toast('Dihapus');
      departments.reload();
    } catch (e) {
      fail(e);
    }
  }

  const depotName = (id: string | null) =>
    id ? (depots.find((d) => d.id === id)?.code ?? 'depot') : 'semua depot';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader
        title="Departemen"
        subtitle="Unit kerja karyawan. Tanpa depot = berlaku lintas depot (Keuangan, HR)."
      />

      <Card className="space-y-3 p-5">
        {departments.loading && <Skeleton className="h-24" />}
        {departments.error && (
          <ErrorState message={departments.error} onRetry={departments.reload} />
        )}
        {departments.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {departments.data.length === 0 && (
              <li className="py-2 text-sm text-muted">
                Belum ada departemen — karyawan tampil “Belum diatur”.
              </li>
            )}
            {departments.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <b>{d.code}</b> · {d.name} · {depotName(d.depotId)}
                  {d.active ? '' : ' (nonaktif)'}
                </span>
                {isAdmin && (
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => toggle(d)}>
                      {d.active ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                    <Button variant="ghost" onClick={() => remove(d.id)}>
                      Hapus
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-app pt-3">
            <label className="text-sm">
              Kode
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="FIN"
                className="w-28"
              />
            </label>
            <label className="text-sm">
              Nama
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Keuangan" />
            </label>
            <label className="text-sm">
              Depot
              <select
                value={depotId}
                onChange={(e) => setDepotId(e.target.value)}
                className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
              >
                <option value="">Semua depot</option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={add}>Tambah</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
