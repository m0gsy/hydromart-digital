'use client';

import { useState } from 'react';
import { ListChecks } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { VisitTemplateForm } from '@/components/hq/visit-template-form';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { VisitTemplate } from '@/lib/visit-templates';

/**
 * HD-15B — the visit templates head office writes: the checklists a supervisor works through at a
 * depot. The list is `/visit-templates/manage` (retired ones included); every write replaces a
 * template's whole checklist, and a visit already made keeps the text it started with.
 */
export default function HqVisitTemplatesPage() {
  const { t } = useT();
  // undefined = closed, null = creating, a template = editing it.
  const [editing, setEditing] = useState<VisitTemplate | null | undefined>(undefined);
  const list = useAsync<VisitTemplate[]>(() => api.get(endpoints.visitTemplates.manage, true), []);
  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ListChecks}
        title={t('hq.visitTemplates.title')}
        subtitle={t('hq.visitTemplates.subtitle')}
        action={<Button onClick={() => setEditing(null)}>{t('hq.visitTemplates.add')}</Button>}
      />

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={t('hq.visitTemplates.loadError')} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.visitTemplates.empty')}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((tpl) => (
            <li key={tpl.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{tpl.name}</p>
                  <p className="text-xs text-muted">{t('hq.visitTemplates.itemCount', { n: tpl.items.length })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={tpl.active ? 'success' : 'neutral'}>
                    {tpl.active ? t('hq.visitTemplates.active') : t('hq.visitTemplates.retired')}
                  </Badge>
                  <Button variant="secondary" onClick={() => setEditing(tpl)}>
                    {t('hq.visitTemplates.edit')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined && (
        <VisitTemplateForm
          // A fresh form per template: its fields start from the row, not from the last one opened.
          key={editing?.id ?? 'new'}
          template={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
