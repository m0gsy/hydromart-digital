'use client';

import { useRef, useState } from 'react';

import { ExternalLink } from '@/components/external-link';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Skeleton } from '@/components/ui';
import { ApiError, api, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  fmtDate,
  fmtFileSize,
  type EmployeeDocument,
  type EmployeeDocumentType,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

/**
 * Personal file: KTP, KK, contract… Uploading the same type again does not overwrite the old
 * file — it files a new version and marks the previous one superseded, so the history of what
 * HR held stays readable.
 */
export function EmployeeDocuments({
  employeeId,
  isAdmin,
}: {
  employeeId: string;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<EmployeeDocumentType>('KTP');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const documents = useAsync<EmployeeDocument[]>(
    () => api.get<EmployeeDocument[]>(endpoints.hr.employeeDocuments(employeeId), true),
    [employeeId],
  );

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr('Pilih file dulu.');
    setSaving(true);
    try {
      await uploadFile(endpoints.hr.uploadEmployeeDocument, file, {
        employeeId,
        type,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      toast('Dokumen tersimpan');
      if (fileRef.current) fileRef.current.value = '';
      setExpiresAt('');
      documents.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal mengunggah dokumen.');
    } finally {
      setSaving(false);
    }
  }

  const rows = documents.data ?? [];

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Dokumen</h2>
      <p className="text-xs text-muted">
        Unggah ulang jenis yang sama akan membuat versi baru; versi lama tetap tersimpan.
      </p>

      {documents.loading ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="divide-y divide-[color:var(--border)]">
          {rows.length === 0 && <p className="text-sm text-muted">Belum ada dokumen.</p>}
          {rows.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{DOCUMENT_TYPE_LABEL[d.type]}</span>
                  <Badge tone={d.supersededById ? 'neutral' : 'success'}>
                    {d.supersededById ? `v${d.version} (diganti)` : `v${d.version}`}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  {fmtFileSize(d.sizeBytes)} · diunggah {fmtDate(d.createdAt)}
                  {d.expiresAt ? ` · berlaku s/d ${fmtDate(d.expiresAt)}` : ''}
                </p>
              </div>
              <ExternalLink
                href={d.fileUrl}
                className="shrink-0 text-sm font-semibold text-brand-700 hover:underline"
              >
                Lihat
              </ExternalLink>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={upload}
          className="grid gap-3 border-t border-[color:var(--border)] pt-4 sm:grid-cols-2"
        >
          <Field label="Jenis dokumen">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EmployeeDocumentType)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Berlaku sampai (opsional)">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            />
          </Field>
          <Field label="File (JPG/PNG/WebP/PDF, maks 5MB)">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="w-full text-sm"
            />
          </Field>
          {err && (
            <p className="col-span-full text-sm font-medium text-red-600" role="alert">
              {err}
            </p>
          )}
          <div className="col-span-full">
            <Button type="submit" loading={saving}>
              Unggah Dokumen
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
