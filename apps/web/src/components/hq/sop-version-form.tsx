'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { Button, Field, Input } from '@/components/ui';
import { fetchAllDepots } from '@/lib/all-depots';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { SopDetail, SopUpload, SopVersionBody } from '@/lib/sop';
import type { DepotAdmin } from '@/lib/types';
import { useAsync } from '@/lib/use-async';
import { todayWib } from '@/lib/wib';

/**
 * HD-16 — one SOP version: a new SOP (with `sopId` unset, so it also asks for the title) or the next
 * version of an existing one. Text and/or a PDF; every depot or a chosen list. The server checks all of
 * it again — this form only keeps the obvious mistakes from costing a round trip.
 */
export function SopVersionForm({
  open,
  sopId,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Set = add a version to this SOP; unset = create a new SOP. */
  sopId?: string;
  onClose: () => void;
  onSaved: (sop: SopDetail) => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [versionTitle, setVersionTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<SopUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayWib());
  const [allDepots, setAllDepots] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The depot list is only needed once someone asks for specific depots.
  const depots = useAsync<DepotAdmin[]>(() => (open && !allDepots ? fetchAllDepots() : Promise.resolve([])), [open, allDepots]);

  const valid =
    (sopId || title.trim().length >= 3) &&
    (body.trim().length > 0 || file !== null) &&
    effectiveFrom >= todayWib() &&
    (allDepots || picked.length > 0) &&
    !uploading;

  async function pickFile(chosen: File | undefined) {
    if (!chosen) return;
    setUploading(true);
    setUploadError(null);
    try {
      setFile(await uploadFile<SopUpload>(endpoints.hr.sopUpload, chosen));
    } catch (err) {
      setFile(null);
      setUploadError(err instanceof ApiError ? err.message : t('hq.sop.form.pdfError'));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const version: SopVersionBody = {
      versionTitle: versionTitle.trim() || undefined,
      body: body.trim() || undefined,
      fileKey: file?.fileKey,
      fileName: file?.fileName,
      sizeBytes: file?.sizeBytes,
      effectiveFrom,
      allDepots,
      depotIds: allDepots ? undefined : picked,
    };
    try {
      const saved = sopId
        ? await api.post<SopDetail>(endpoints.hr.sopVersions(sopId), version, true)
        : await api.post<SopDetail>(endpoints.hr.sops, { ...version, title: title.trim() }, true);
      toast(t('hq.sop.form.saved'), 'success');
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.sop.form.saveError'));
    } finally {
      setBusy(false);
    }
  }

  const togglePicked = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={sopId ? t('hq.sop.form.versionTitle') : t('hq.sop.form.createTitle')}
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p className="text-sm text-[color:var(--danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('hq.sop.form.cancel')}
            </Button>
            <Button onClick={submit} disabled={!valid} loading={busy}>
              {t('hq.sop.form.submit')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!sopId && (
          <Field label={t('hq.sop.form.title')} htmlFor="sop-title">
            <Input id="sop-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('hq.sop.form.titlePlaceholder')} />
          </Field>
        )}
        <Field label={t('hq.sop.form.versionName')} htmlFor="sop-version-title" hint={t('hq.sop.form.versionNameHint')}>
          <Input id="sop-version-title" value={versionTitle} maxLength={200} onChange={(e) => setVersionTitle(e.target.value)} />
        </Field>
        <Field label={t('hq.sop.form.body')} htmlFor="sop-body" hint={t('hq.sop.form.bodyHint')}>
          <textarea
            id="sop-body"
            value={body}
            maxLength={50_000}
            rows={8}
            onChange={(e) => setBody(e.target.value)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
          />
        </Field>
        <Field label={t('hq.sop.form.pdf')} htmlFor="sop-pdf" error={uploadError ?? undefined}>
          <input
            id="sop-pdf"
            type="file"
            accept="application/pdf"
            onChange={(e) => void pickFile(e.target.files?.[0])}
            className="text-sm"
          />
        </Field>
        {uploading && <p className="text-xs text-muted">{t('hq.sop.form.pdfUploading')}</p>}
        {file && !uploading && <p className="text-xs text-muted">{t('hq.sop.form.pdfChosen', { name: file.fileName })}</p>}
        <Field label={t('hq.sop.form.effectiveFrom')} htmlFor="sop-effective" hint={t('hq.sop.form.effectiveHint')}>
          <Input id="sop-effective" type="date" min={todayWib()} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label={t('hq.sop.form.scope')}>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {[true, false].map((all) => (
              <button
                key={String(all)}
                type="button"
                onClick={() => setAllDepots(all)}
                aria-pressed={allDepots === all}
                className={`min-h-11 flex-1 px-4 py-1.5 transition-colors ${allDepots === all ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'}`}
              >
                {all ? t('hq.sop.form.scopeAll') : t('hq.sop.form.scopeSome')}
              </button>
            ))}
          </div>
        </Field>
        {!allDepots && (
          <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-app p-2">
            <legend className="px-1 text-sm font-medium">{t('hq.sop.form.depots')}</legend>
            {depots.error && (
              <p className="text-xs text-[color:var(--danger)]" role="alert">
                {t('hq.sop.form.depotsError')}
              </p>
            )}
            {(depots.data ?? []).map((d) => (
              <label key={d.id} className="tap-44 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(d.id)} onChange={() => togglePicked(d.id)} />
                {d.code} · {d.name}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Sheet>
  );
}
