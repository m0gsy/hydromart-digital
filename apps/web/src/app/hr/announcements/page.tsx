'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import {
  ANNOUNCEMENT_DIMENSIONS,
  ANNOUNCEMENT_DIMENSION_LABEL,
  ANNOUNCEMENT_LEVELS,
  ANNOUNCEMENT_LEVEL_LABEL,
  announcementReadRate,
  announcementTargetNeedsValue,
  fmtDate,
  type Announcement,
  type AnnouncementDetail,
  type AnnouncementDimension,
  type AnnouncementLevel,
  type Department,
  type Employee,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const LEVEL_TONE: Record<AnnouncementLevel, 'neutral' | 'warning' | 'danger'> = {
  INFO: 'neutral',
  WARNING: 'warning',
  URGENT: 'danger',
};

interface TargetDraft {
  dimension: AnnouncementDimension;
  value: string;
}

export default function AnnouncementsPage() {
  const { customer } = useAuth();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const list = useAsync<{ rows: Announcement[]; total: number }>(
    () =>
      api.get<{ rows: Announcement[]; total: number }>(
        endpoints.hr.announcements({ pageSize: 50 }),
        true,
      ),
    [],
  );
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader
        title="Pengumuman"
        subtitle="Satu pesan, satu kali sampai. Target yang beririsan tidak mengirim dobel."
      />

      {isAdmin && <Composer onSent={list.reload} onError={(m) => toast(m, 'error')} />}

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Riwayat</h2>
        {list.loading && <Skeleton className="h-32" />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {list.data.rows.length === 0 && (
              <li className="py-3 text-sm text-muted">Belum ada pengumuman.</li>
            )}
            {list.data.rows.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{a.title}</b>
                      <Badge tone={LEVEL_TONE[a.level]}>{ANNOUNCEMENT_LEVEL_LABEL[a.level]}</Badge>
                      {!a.publishedAt && <Badge tone="neutral">Terjadwal</Badge>}
                    </div>
                    <p className="whitespace-pre-line text-sm text-muted">{a.body}</p>
                    <p className="text-xs text-muted">
                      {a.publishedAt
                        ? `Terkirim ${fmtDate(a.publishedAt)} ke ${a.audienceSize} orang`
                        : `Dijadwalkan ${fmtDate(a.scheduledAt)} — belum terkirim`}
                      {' · '}
                      {a.targets.map((t) => ANNOUNCEMENT_DIMENSION_LABEL[t.dimension]).join(', ')}
                    </p>
                  </div>
                  {a.publishedAt && (
                    <Button variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>
                      {open === a.id ? 'Tutup' : 'Statistik'}
                    </Button>
                  )}
                </div>
                {open === a.id && <ReadStats id={a.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReadStats({ id }: { id: string }) {
  const detail = useAsync<AnnouncementDetail>(
    () => api.get<AnnouncementDetail>(endpoints.hr.announcement(id), true),
    [id],
  );
  if (detail.loading) return <Skeleton className="h-8" />;
  if (!detail.data) return null;
  return (
    <p className="rounded-lg border border-app p-3 text-sm">
      {announcementReadRate(detail.data.readCount, detail.data.audienceSize)}
    </p>
  );
}

function Composer({ onSent, onError }: { onSent: () => void; onError: (m: string) => void }) {
  const { depots } = useDepot();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('INFO');
  const [scheduledAt, setScheduledAt] = useState('');
  const [targets, setTargets] = useState<TargetDraft[]>([{ dimension: 'COMPANY', value: '' }]);
  const [saving, setSaving] = useState(false);

  const departments = useAsync<Department[]>(
    () => api.get<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  const employees = useAsync<{ rows: Employee[] }>(
    () =>
      api.get<{ rows: Employee[] }>(
        endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 }),
        true,
      ),
    [],
  );

  // Jabatan is free text on the employee record, so the options are whatever is in use.
  const positions = Array.from(new Set((employees.data?.rows ?? []).map((e) => e.position))).sort();

  function setTarget(i: number, patch: Partial<TargetDraft>) {
    setTargets(targets.map((t, j) => (i === j ? { ...t, ...patch } : t)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      onError('Judul dan isi wajib diisi');
      return;
    }
    if (targets.some((t) => announcementTargetNeedsValue(t.dimension) && !t.value)) {
      onError('Setiap target selain "seluruh perusahaan" harus dipilih nilainya');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.createAnnouncement,
        {
          title: title.trim(),
          body: body.trim(),
          level,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          targets: targets.map((t) =>
            announcementTargetNeedsValue(t.dimension)
              ? { dimension: t.dimension, value: t.value }
              : { dimension: t.dimension },
          ),
        },
        true,
      );
      toast(scheduledAt ? 'Pengumuman dijadwalkan' : 'Pengumuman terkirim');
      setTitle('');
      setBody('');
      setScheduledAt('');
      setTargets([{ dimension: 'COMPANY', value: '' }]);
      onSent();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Gagal mengirim pengumuman');
    } finally {
      setSaving(false);
    }
  }

  function optionsFor(dimension: AnnouncementDimension): { value: string; label: string }[] {
    switch (dimension) {
      case 'DEPOT':
        return depots.map((d) => ({ value: d.id, label: d.code }));
      case 'DEPARTMENT':
        return (departments.data ?? []).map((d) => ({
          value: d.id,
          label: `${d.code} · ${d.name}`,
        }));
      case 'POSITION':
        return positions.map((p) => ({ value: p, label: p }));
      case 'EMPLOYEE':
        return (employees.data?.rows ?? []).map((e) => ({
          value: e.id,
          label: `${e.employeeCode} · ${e.fullName}`,
        }));
      default:
        return [];
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Tulis Pengumuman</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Judul">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Isi">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tingkat">
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {ANNOUNCEMENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {ANNOUNCEMENT_LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jadwalkan (kosong = kirim sekarang)">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Target audiens</p>
          <p className="text-xs text-muted">
            Beberapa target digabung. Orang yang masuk di dua target tetap menerima satu pesan.
          </p>
          {targets.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <select
                value={t.dimension}
                onChange={(e) =>
                  setTarget(i, { dimension: e.target.value as AnnouncementDimension, value: '' })
                }
                className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
              >
                {ANNOUNCEMENT_DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {ANNOUNCEMENT_DIMENSION_LABEL[d]}
                  </option>
                ))}
              </select>
              {announcementTargetNeedsValue(t.dimension) && (
                <select
                  value={t.value}
                  onChange={(e) => setTarget(i, { value: e.target.value })}
                  className="surface-elevated min-w-48 rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  <option value="">Pilih…</option>
                  {optionsFor(t.dimension).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {targets.length > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setTargets(targets.filter((_, j) => j !== i))}
                >
                  Hapus
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            type="button"
            onClick={() => setTargets([...targets, { dimension: 'DEPOT', value: '' }])}
          >
            Tambah target
          </Button>
        </div>

        <Button type="submit" loading={saving}>
          {scheduledAt ? 'Jadwalkan' : 'Kirim Sekarang'}
        </Button>
      </form>
    </Card>
  );
}
