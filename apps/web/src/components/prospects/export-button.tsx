'use client';

import { DownloadSimple } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button, FormError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { buildExportSheets, exportFileName, type ExportDepot, type ExportResponse } from '@/lib/prospect-export';
import { can } from '@/lib/roles';
import type { ProspectAssignee, ProspectCoverage } from '@/lib/types';
import { toWorkbookBlob } from '@/lib/xlsx';

/** The server's own cap; the banner says so when it cut the file. */
const EXPORT_MAX = 5000;
/** Coverage is read once per depot, sequentially: never more than this many calls. */
const MAX_DEPOTS = 30;

export interface ExportFilters {
  depotId?: string;
  status?: string;
  category?: string;
  kecamatanCode?: string;
  assigned?: string;
}

/**
 * Export the list's current filters as a five-sheet workbook. The server writes its audit entry before it
 * returns a single row: if that fails the call is a 503 and no file is made (nothing is downloaded).
 */
export function ExportButton({
  role,
  filters,
  depotIds,
  depotCode,
}: {
  role: string | undefined;
  filters: ExportFilters;
  /** The depots in scope, for the per-depot do-not-contact counts. */
  depotIds: string[];
  /** The selected depot's code, for the file name; null = whole network. */
  depotCode: string | null;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await api.post<ExportResponse>(endpoints.prospects.export, filters, true);
      if (response.rowCount === 0) return setNote(t('opsFix.prospectsIo.export.empty'));

      // Built first: `depots.browse` is a block-bodied builder the contract gate cannot read at a call site (the
      // map page already carries that one); the path and verb are proved by the map page's own call.
      const browse = endpoints.depots.browse({ limit: 100, includeArea: true });
      const depots = (await api.get<{ items: ExportDepot[] }>(browse, true)).items;

      // Staff names come from the assignees route (a Manage holder's); anyone unknown shows as "Staf" + last 4.
      const names = new Map<string, string>();
      if (can('b2bProspectManage', role)) {
        const owners = [...new Set(response.rows.map((r) => r.ownerDepotId).filter((d): d is string => !!d))];
        for (const id of owners.slice(0, MAX_DEPOTS)) {
          const staff = await api.get<ProspectAssignee[]>(endpoints.prospects.assignees(id), true).catch(() => []);
          for (const s of staff) names.set(s.id, s.name);
        }
      }

      const dnc: { depotId: string; count: number }[] = [];
      for (const depotId of (filters.depotId ? [filters.depotId] : depotIds).slice(0, MAX_DEPOTS)) {
        const cov = await api.get<ProspectCoverage>(endpoints.prospects.coverage(depotId), true).catch(() => null);
        dnc.push({ depotId, count: cov?.byStatus.find((s) => s.status === 'DO_NOT_CONTACT')?.total ?? 0 });
      }

      const sheets = buildExportSheets({ response, depots, names, dnc, t });
      downloadBlob(exportFileName(depotCode, response.truncated, t), await toWorkbookBlob(sheets));
      if (response.truncated) setNote(t('opsFix.prospectsIo.export.truncated', { max: EXPORT_MAX }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return setHidden(true);
      setError(
        err instanceof ApiError && err.status === 503
          ? `${err.message}. ${t('opsFix.prospectsIo.export.noFile')}`
          : t('opsFix.prospectsIo.export.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={run} loading={busy}>
        <DownloadSimple size={16} weight="bold" />
        {busy ? t('opsFix.prospectsIo.export.working') : t('opsFix.prospectsIo.tools.export')}
      </Button>
      <FormError message={error} />
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  );
}
