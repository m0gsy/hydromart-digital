'use client';

import { useMemo, useState } from 'react';
import { Lock, Plus, UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { HuddleActionItem, HuddleAgendaItem, HuddleNote } from '@/lib/types';

/** ISO date (YYYY-MM-DD, local) of the Monday in the same week as `d`. */
function mondayOf(d: Date): string {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun … 6=Sat
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function HuddleBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const weekStart = useMemo(() => mondayOf(new Date()), []);

  const note = useAsync<HuddleNote | null>(
    () =>
      scopedId
        ? api.get<HuddleNote | null>(endpoints.huddle.get({ depotId: scopedId, weekStart }), true)
        : Promise.resolve(null),
    [scopedId, weekStart],
  );

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAgenda, setShowAgenda] = useState(false);
  const [showAction, setShowAction] = useState(false);
  const [editAttend, setEditAttend] = useState(false);

  // PUT the full note (upsert) with a partial override, then reload.
  async function save(patch: {
    attendance?: string | null;
    agenda?: HuddleAgendaItem[];
    actionItems?: HuddleActionItem[];
  }) {
    if (!scopedId) return;
    const cur = note.data;
    setBusy(true);
    setSaveError(null);
    try {
      await api.put(
        endpoints.huddle.upsert,
        {
          depotId: scopedId,
          weekStart,
          attendance: patch.attendance !== undefined ? patch.attendance : (cur?.attendance ?? null),
          agenda: patch.agenda ?? cur?.agenda ?? [],
          actionItems: patch.actionItems ?? cur?.actionItems ?? [],
        },
        true,
      );
      note.reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('dashA.huddle.saveError'));
    } finally {
      setBusy(false);
    }
  }

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const Header = (
    <div className="flex items-center gap-2">
      <UsersThree size={24} weight="fill" className="text-brand-500" />
      <div>
        <h1 className="text-2xl font-bold">{t('dashA.huddle.title')}</h1>
        {scopedDepot && (
          <p className="text-sm text-[color:var(--text-muted)]">{scopedDepot.name}</p>
        )}
      </div>
    </div>
  );

  if (ready && depots.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <CenterState title={t('dashA.huddle.noDepotTitle')} icon={<UsersThree size={40} weight="fill" />}>
          {t('dashA.huddle.noDepotBody')}
        </CenterState>
      </div>
    );
  }

  if (note.loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (note.error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <ErrorState message={note.error} onRetry={note.reload} />
      </div>
    );
  }

  const data = note.data;

  // No note for this week yet — offer to start one.
  if (!data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <CenterState
          title={t('dashA.huddle.noNoteTitle')}
          icon={<UsersThree size={40} weight="fill" />}
          action={
            <Button onClick={() => save({})} loading={busy}>
              {t('dashA.huddle.start')}
            </Button>
          }
        >
          {t('dashA.huddle.noNoteBody')}
        </CenterState>
        {saveError && (
          <p className="text-center text-sm font-medium text-red-600" role="alert">
            {saveError}
          </p>
        )}
      </div>
    );
  }

  const doneCount = data.actionItems.filter((a) => a.done).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <UsersThree size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashA.huddle.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {formatDateTime(data.heldAt)}
            {data.attendance ? ` · ${data.attendance}` : ''}
          </p>
        </div>
      </div>

      {saveError && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {saveError}
        </p>
      )}

      {/* Attendance editor */}
      {editAttend ? (
        <AttendanceForm
          initial={data.attendance ?? ''}
          busy={busy}
          onCancel={() => setEditAttend(false)}
          onSave={async (value) => {
            await save({ attendance: value || null });
            setEditAttend(false);
          }}
        />
      ) : (
        <Button variant="ghost" className="self-start" onClick={() => setEditAttend(true)} disabled={busy}>
          {data.attendance ? t('dashA.huddle.editAttendance') : t('dashA.huddle.addAttendance')}
        </Button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">{t('dashA.huddle.agendaTitle')}</h2>
        {data.agenda.length === 0 && (
          <p className="text-[12.5px] text-[color:var(--text-muted)]">{t('dashA.huddle.agendaEmpty')}</p>
        )}
        {data.agenda.map((a, i) => (
          <Card key={`${a.title}-${i}`} className="flex flex-col gap-1 p-4">
            <p className="font-semibold">{a.title}</p>
            {a.note && <p className="text-[12.5px] text-[color:var(--text-muted)]">{a.note}</p>}
          </Card>
        ))}
        {showAgenda ? (
          <AgendaForm
            busy={busy}
            onCancel={() => setShowAgenda(false)}
            onSave={async (item) => {
              await save({ agenda: [...data.agenda, item] });
              setShowAgenda(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAgenda(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-app p-3.5 text-sm font-semibold text-[color:var(--text-muted)] hover:bg-brand-50"
          >
            <Plus size={16} weight="bold" />
            {t('dashA.huddle.addAgenda')}
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">
          {t('dashA.huddle.actionHeading', { done: doneCount, total: data.actionItems.length })}
        </h2>
        {data.actionItems.length > 0 && (
          <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
            {data.actionItems.map((a, i) => (
              <button
                key={`${a.text}-${i}`}
                type="button"
                onClick={() =>
                  save({
                    actionItems: data.actionItems.map((it, idx) =>
                      idx === i ? { ...it, done: !it.done } : it,
                    ),
                  })
                }
                disabled={busy}
                className="flex items-center gap-3 p-4 text-left disabled:opacity-60"
                aria-pressed={a.done}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded border-2 ${
                    a.done ? 'border-brand-600 bg-brand-600 text-on-brand' : 'border-app'
                  }`}
                >
                  {a.done && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={`flex-1 text-sm ${a.done ? 'text-[color:var(--text-muted)] line-through' : 'font-medium'}`}>
                  {a.text}
                </span>
                <Chip tone="outline">{a.assignee}</Chip>
              </button>
            ))}
          </Card>
        )}
        {showAction ? (
          <ActionForm
            busy={busy}
            onCancel={() => setShowAction(false)}
            onSave={async (item) => {
              await save({ actionItems: [...data.actionItems, item] });
              setShowAction(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAction(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-app p-3.5 text-sm font-semibold text-[color:var(--text-muted)] hover:bg-brand-50"
          >
            <Plus size={16} weight="bold" />
            {t('dashA.huddle.addAction')}
          </button>
        )}
      </section>
    </div>
  );
}

function AttendanceForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState(initial);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label={t('dashA.huddle.attendanceLabel')} htmlFor="huddle-attendance">
        <Input
          id="huddle-attendance"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('dashA.huddle.attendancePlaceholder')}
          autoFocus
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashA.huddle.cancel')}
        </Button>
        <Button onClick={() => onSave(value.trim())} loading={busy}>
          {t('dashA.huddle.save')}
        </Button>
      </div>
    </Card>
  );
}

function AgendaForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (item: HuddleAgendaItem) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label={t('dashA.huddle.agendaTitleLabel')} htmlFor="agenda-title">
        <Input id="agenda-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label={t('dashA.huddle.agendaNoteLabel')} htmlFor="agenda-note">
        <Input id="agenda-note" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashA.huddle.cancel')}
        </Button>
        <Button
          onClick={() => title.trim() && onSave({ title: title.trim(), note: text.trim() })}
          loading={busy}
          disabled={!title.trim()}
        >
          {t('dashA.huddle.add')}
        </Button>
      </div>
    </Card>
  );
}

function ActionForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (item: HuddleActionItem) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label={t('dashA.huddle.actionLabel')} htmlFor="action-text">
        <Input id="action-text" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <Field label={t('dashA.huddle.assigneeLabel')} htmlFor="action-assignee">
        <Input id="action-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashA.huddle.cancel')}
        </Button>
        <Button
          onClick={() =>
            text.trim() && onSave({ text: text.trim(), assignee: assignee.trim(), done: false })
          }
          loading={busy}
          disabled={!text.trim()}
        >
          {t('dashA.huddle.add')}
        </Button>
      </div>
    </Card>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotHuddle', customer?.role)) {
    return (
      <CenterState title={t('dashA.huddle.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.huddle.gateBody')}
      </CenterState>
    );
  }
  return <HuddleBody />;
}

export default function HuddlePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
