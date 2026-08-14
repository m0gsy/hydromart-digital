'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadError,
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
  const { t } = useT();
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
        title={t('hrFix.announcements.title')}
        subtitle={t('hrFix.announcements.subtitle')}
      />

      {isAdmin && <Composer onSent={list.reload} onError={(m) => toast(m, 'error')} />}

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t('hrFix.announcements.history')}</h2>
        {list.loading && <Skeleton className="h-32" />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {list.data.rows.length === 0 && (
              <li className="py-3 text-sm text-muted">{t('hrFix.announcements.empty')}</li>
            )}
            {list.data.rows.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{a.title}</b>
                      <Badge tone={LEVEL_TONE[a.level]}>{t(ANNOUNCEMENT_LEVEL_LABEL[a.level])}</Badge>
                      {!a.publishedAt && <Badge tone="neutral">{t('hrFix.announcements.scheduled')}</Badge>}
                    </div>
                    <p className="whitespace-pre-line text-sm text-muted">{a.body}</p>
                    <p className="text-xs text-muted">
                      {a.publishedAt
                        ? `Terkirim ${fmtDate(a.publishedAt)} ke ${a.audienceSize} orang`
                        : t('hrFix.announcements.scheduledNotSent', { at: fmtDate(a.scheduledAt) })}
                      {' · '}
                      {a.targets
                        .map((tg) => t(ANNOUNCEMENT_DIMENSION_LABEL[tg.dimension]))
                        .join(', ')}
                    </p>
                  </div>
                  {a.publishedAt && (
                    <Button variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>
                      {open === a.id ? t('hrFix.announcements.close') : t('hrFix.announcements.stats')}
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
  const { t } = useT();
  const detail = useAsync<AnnouncementDetail>(
    () => api.get<AnnouncementDetail>(endpoints.hr.announcement(id), true),
    [id],
  );
  if (detail.loading) return <Skeleton className="h-8" />;
  if (!detail.data) return null;
  return (
    <p className="rounded-lg border border-app p-3 text-sm">
      {announcementReadRate(detail.data.readCount, detail.data.audienceSize, t)}
    </p>
  );
}

function Composer({ onSent, onError }: { onSent: () => void; onError: (m: string) => void }) {
  const { t } = useT();
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
      onError(t('hrFix.announcements.required'));
      return;
    }
    if (targets.some((t) => announcementTargetNeedsValue(t.dimension) && !t.value)) {
      onError(t('hrFix.announcements.targetValue'));
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
          targets: targets.map((tg) =>
            announcementTargetNeedsValue(tg.dimension)
              ? { dimension: tg.dimension, value: tg.value }
              : { dimension: tg.dimension },
          ),
        },
        true,
      );
      toast(scheduledAt ? t('hrFix.announcements.scheduledOk') : t('hrFix.announcements.sent'));
      setTitle('');
      setBody('');
      setScheduledAt('');
      setTargets([{ dimension: 'COMPANY', value: '' }]);
      onSent();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('hrFix.announcements.sendFailed'));
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
      <h2 className="text-sm font-semibold">{t('hrFix.announcements.compose')}</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('hrFix.announcements.subject')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('hrFix.announcements.body')}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hrFix.announcements.level')}>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {ANNOUNCEMENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(ANNOUNCEMENT_LEVEL_LABEL[l])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hrFix.announcements.scheduleAt')}>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('hrFix.announcements.audience')}</p>
          <p className="text-xs text-muted">
            {t('hrFix.announcements.mergedTargets')}
          </p>
          {targets.map((tg, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <select
                value={tg.dimension}
                onChange={(e) =>
                  setTarget(i, { dimension: e.target.value as AnnouncementDimension, value: '' })
                }
                className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
              >
                {ANNOUNCEMENT_DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(ANNOUNCEMENT_DIMENSION_LABEL[d])}
                  </option>
                ))}
              </select>
              {announcementTargetNeedsValue(tg.dimension) && (
                <select
                  value={tg.value}
                  onChange={(e) => setTarget(i, { value: e.target.value })}
                  className="surface-elevated min-w-48 rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  <option value="">{t('hrFix.announcements.pick')}</option>
                  {optionsFor(tg.dimension).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {/* The DEPARTMENT and EMPLOYEE options come from two lookups. An empty picker
                  is the same shape as "this company has no departments", and the announcement
                  goes out to nobody. */}
              {((tg.dimension === 'DEPARTMENT' && departments.error) ||
                (tg.dimension === 'EMPLOYEE' && employees.error)) && (
                <LoadError
                  onRetry={tg.dimension === 'DEPARTMENT' ? departments.reload : employees.reload}
                />
              )}
              {targets.length > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setTargets(targets.filter((_, j) => j !== i))}
                >
                  {t('hrFix.announcements.delete2')}
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            type="button"
            onClick={() => setTargets([...targets, { dimension: 'DEPOT', value: '' }])}
          >
            {t('hrFix.announcements.addTarget')}
          </Button>
        </div>

        <Button type="submit" loading={saving}>
          {scheduledAt ? t('hrFix.announcements.schedule') : t('hrFix.announcements.sendNow')}
        </Button>
      </form>
    </Card>
  );
}
