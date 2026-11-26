'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  FormError,
  Input,
  Skeleton,
} from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';
import { compressImage } from '@/lib/image';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';
import type { Visit, VisitItem } from '@/lib/visits';
import { dateInDaysWib, todayWib } from '@/lib/wib';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** A lost connection says so in its own words; anything else shows the server's text or the fallback. */
function offlineOr(e: unknown, offline: string, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  if (e.status === 0 && e.code !== 'CLIENT_MISSING_ROUTE_ID') return offline;
  return e.message || fallback;
}

// The server's window for a follow-up deadline: today through 90 days out.
const MAX_FOLLOW_UP_DAYS = 90;

function ItemCard({
  visitId,
  item,
  editable,
  onSaved,
}: {
  visitId: string;
  item: VisitItem;
  editable: boolean;
  onSaved: (item: VisitItem) => void;
}) {
  const { t } = useT();
  const { confirm } = useConfirm();
  const failure = (e: unknown, fallback: string) =>
    offlineOr(e, t('opsFix.visits.detail.offline'), fallback);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState(item.findingNote ?? '');
  const [due, setDue] = useState(item.followUpDueOn ?? '');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      // stale-write-ok: one supervisor answers their own open visit; a later answer replaces the earlier one on purpose.
      onSaved(await api.patch<VisitItem>(endpoints.visits.answer(visitId, item.id), body, true));
      setFinding(false);
    } catch (e) {
      setError(failure(e, t('opsFix.visits.detail.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function pass() {
    if (
      item.result === 'FINDING' &&
      !(await confirm({
        title: t('opsFix.visits.detail.replaceTitle'),
        message: t('opsFix.visits.detail.replaceBody'),
        confirmLabel: t('opsFix.visits.detail.replaceConfirm'),
        cancelLabel: t('opsFix.visits.cancel'),
        tone: 'danger',
      }))
    )
      return;
    await answer({ result: 'PASS' });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await compressImage(file);
      // The server sniffs bytes and caps at 5 MB; a PDF or a huge file fails there after the wait.
      if (blob.size > MAX_PHOTO_BYTES || !/^image\/(jpeg|png|webp)$/.test(blob.type)) {
        setError(t('opsFix.visits.detail.photoBad'));
        return;
      }
      const sent = await uploadFile<{ key: string }>(endpoints.visits.upload(visitId), blob);
      setPhotoKey(sent.key);
    } catch (e) {
      const fallback =
        e instanceof ApiError && e.status === 503
          ? t('opsFix.visits.detail.photoStorage')
          : e instanceof ApiError && e.status === 429
            ? t('opsFix.visits.detail.photoLimit')
            : t('opsFix.visits.detail.photoFailed');
      setError(failure(e, fallback));
    } finally {
      setUploading(false);
    }
  }

  function saveFinding() {
    if (note.trim().length < 3) return setError(t('opsFix.visits.detail.needNote'));
    // The server needs this visit's photo key on every finding, so an edit re-takes the photo.
    if (!photoKey) return setError(t('opsFix.visits.detail.needPhoto'));
    if (!due) return setError(t('opsFix.visits.detail.needDue'));
    void answer({ result: 'FINDING', findingNote: note.trim(), photoKey, followUpDueOn: due });
  }

  const answered = item.result !== 'PENDING';
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold">
          {item.position}. {item.text}
        </p>
        {answered && (
          <Badge tone={item.result === 'PASS' ? 'success' : 'warning'}>
            {item.result === 'PASS'
              ? t('opsFix.visits.detail.pass')
              : t('opsFix.visits.detail.finding')}
          </Badge>
        )}
      </div>
      {item.sopVersionId && (
        <Link
          href={`/hr/me/sop/detail?id=${item.sopVersionId}`}
          className="text-xs font-semibold text-brand-700"
        >
          {t('opsFix.visits.detail.sop', {
            title: item.sopTitle ?? '',
            n: item.sopVersionNo ?? '',
          })}
        </Link>
      )}
      {item.result === 'FINDING' && !finding && (
        <div className="space-y-1 text-sm">
          <p>{item.findingNote}</p>
          {item.followUpDueOn && (
            <p className="text-xs text-muted">
              {t('opsFix.visits.dueOn', { date: formatDate(item.followUpDueOn) })}
            </p>
          )}
          {item.photoUrl && (
            <a
              href={item.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-brand-700"
            >
              {t('opsFix.visits.photo')}
            </a>
          )}
        </div>
      )}
      {editable && !finding && (
        <div className="flex gap-2">
          <Button
            variant={item.result === 'PASS' ? 'primary' : 'secondary'}
            loading={busy}
            onClick={pass}
          >
            {t('opsFix.visits.detail.pass')}
          </Button>
          <Button variant="secondary" onClick={() => setFinding(true)}>
            {t('opsFix.visits.detail.finding')}
          </Button>
        </div>
      )}
      {editable && finding && (
        <div className="space-y-3">
          <Field label={t('opsFix.visits.detail.noteLabel')} htmlFor={`note-${item.id}`}>
            <textarea
              id={`note-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('opsFix.visits.detail.notePlaceholder')}
              className="w-full rounded-xl border border-app bg-[color:var(--surface)] px-3.5 py-3 text-[13px]"
            />
          </Field>
          <Field label={t('opsFix.visits.detail.photoLabel')} htmlFor={`photo-${item.id}`}>
            <Input
              id={`photo-${item.id}`}
              type="file"
              accept="image/*"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </Field>
          {uploading && (
            <p className="text-xs text-muted">{t('opsFix.visits.detail.photoUploading')}</p>
          )}
          {photoKey && !uploading && (
            <p className="text-xs font-semibold text-[color:var(--success)]">
              {t('opsFix.visits.detail.photoReady')}
            </p>
          )}
          <Field label={t('opsFix.visits.detail.dueLabel')} htmlFor={`due-${item.id}`}>
            <Input
              id={`due-${item.id}`}
              type="date"
              min={todayWib()}
              max={dateInDaysWib(MAX_FOLLOW_UP_DAYS)}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button loading={busy} disabled={uploading} onClick={saveFinding}>
              {busy ? t('opsFix.visits.detail.saving') : t('opsFix.visits.detail.saveFinding')}
            </Button>
            <Button variant="secondary" onClick={() => setFinding(false)}>
              {t('opsFix.visits.cancel')}
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}

function Body({ id }: { id: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  const [completing, setCompleting] = useState(false);
  const [blocked, setBlocked] = useState<403 | 404 | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Answers come back one at a time; keep them here instead of re-reading the whole visit (and
  // re-minting every photo link) after each one.
  const [visit, setVisit] = useState<Visit | null>(null);
  const loaded = useAsync<Visit | null>(
    () =>
      api
        .get<Visit>(endpoints.visits.one(id), true)
        .then((v) => {
          setVisit(v);
          return v;
        })
        .catch((e: unknown) => {
          // Not there, or not yours: its own state, and no retry that cannot change the answer.
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            setBlocked(e.status);
            return null;
          }
          throw e;
        }),
    [id],
  );

  const back = (
    <Link
      href="/dashboard/visits"
      className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700"
    >
      {t('opsFix.visits.detail.back')}
    </Link>
  );
  if (loaded.loading) return <Skeleton className="h-64 w-full" />;
  if (loaded.error || !visit) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState
          message={
            loaded.error
              ? t('opsFix.visits.detail.loadError')
              : t(
                  blocked === 403
                    ? 'opsFix.visits.detail.forbidden'
                    : 'opsFix.visits.detail.notFound',
                )
          }
          onRetry={loaded.error ? loaded.reload : undefined}
        />
      </div>
    );
  }

  const editable = visit.status === 'IN_PROGRESS' && can('visitConduct', customer?.role);
  const pending = visit.items.filter((i) => i.result === 'PENDING').length;

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      setVisit(await api.post<Visit>(endpoints.visits.complete(id), {}, true));
    } catch (e) {
      setError(
        offlineOr(e, t('opsFix.visits.detail.offline'), t('opsFix.visits.detail.completeFailed')),
      );
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <div>
        <h1 className="text-xl font-bold">{visit.templateName}</h1>
        <p className="text-xs text-muted">
          {formatDateTime(visit.checkInAt)}
          {visit.completedAt &&
            ` · ${t('opsFix.visits.detail.completedAt', { time: formatDateTime(visit.completedAt) })}`}
        </p>
        <p className="text-xs text-muted">
          {t('opsFix.visits.detail.progress', {
            done: visit.items.length - pending,
            total: visit.items.length,
          })}
        </p>
      </div>
      {!editable && <p className="text-xs text-muted">{t('opsFix.visits.detail.readOnly')}</p>}
      {visit.items.map((item) => (
        <ItemCard
          key={item.id}
          visitId={id}
          item={item}
          editable={editable}
          onSaved={(saved) =>
            setVisit({ ...visit, items: visit.items.map((i) => (i.id === saved.id ? saved : i)) })
          }
        />
      ))}
      {editable && (
        <div className="space-y-2">
          {pending > 0 && (
            <p className="text-sm text-muted">
              {t('opsFix.visits.detail.pending', { n: pending })}
            </p>
          )}
          <FormError message={error} />
          <Button className="w-full" loading={completing} disabled={pending > 0} onClick={complete}>
            {completing ? t('opsFix.visits.detail.completing') : t('opsFix.visits.detail.complete')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Gate({ id }: { id: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  // The visit is read with visitRead; a role without it would only meet a 403.
  if (!can('visitRead', customer?.role)) {
    return (
      <CenterState title={t('opsFix.visits.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.visits.gateBody')}
      </CenterState>
    );
  }
  return <Body id={id} />;
}

export default function VisitDetailPage() {
  const id = useQueryParam('id');
  return (
    <RequireAuth>
      <Gate id={id} />
    </RequireAuth>
  );
}
