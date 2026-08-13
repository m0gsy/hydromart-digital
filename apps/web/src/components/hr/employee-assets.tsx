'use client';

import { Badge, Card, LinkButton, LoadError, Money, Skeleton } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ASSET_STATUS_LABEL, ASSET_TYPE_LABEL, type EmployeeAsset } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

/**
 * What this person is holding right now. Handing over and taking back happens on /hr/assets,
 * where the movement log lives — an asset is depot property, not an employee attribute.
 */
export function EmployeeAssets({ employeeId }: { employeeId: string }) {
  const { t } = useT();
  const assets = useAsync<{ rows: EmployeeAsset[]; total: number }>(
    () =>
      api.get<{ rows: EmployeeAsset[]; total: number }>(
        endpoints.hr.assets({ holderId: employeeId, pageSize: 100 }),
        true,
      ),
    [employeeId],
  );
  const rows = assets.data?.rows ?? [];

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Aset Dipegang</h2>
        <LinkButton href="/hr/assets" variant="ghost">
          Kelola aset
        </LinkButton>
      </div>
      {assets.loading ? (
        <Skeleton className="h-16" />
      ) : assets.error ? (
        // Held company assets decide what an exit interview asks for.
        <LoadError onRetry={assets.reload} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada aset perusahaan yang dipegang.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <b>{a.code}</b>
                  <Badge tone="warning">{t(ASSET_STATUS_LABEL[a.status])}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {t(ASSET_TYPE_LABEL[a.type])} · {a.name}
                  {a.serialNo ? ` · SN ${a.serialNo}` : ''}
                </p>
              </div>
              {a.value && (
                <span className="shrink-0 text-sm text-muted">
                  <Money amount={Number(a.value)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
