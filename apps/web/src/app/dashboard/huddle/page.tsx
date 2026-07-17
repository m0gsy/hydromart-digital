'use client';

import { useState } from 'react';
import { Lock, Plus, UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, Chip, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Agenda = { title: string; note: string };
type Action = { id: string; text: string; assignee: string; done: boolean };

// TODO: wire to huddle backend (weekly team huddle notes + action items). Static seed.
const AGENDA: Agenda[] = [
  { title: 'Review SLA minggu lalu', note: 'On-time 94% — turun 1 poin, dominan di rute sore.' },
  { title: 'Stok galon & retur', note: 'Retur galon menumpuk di gudang, perlu jadwal ambil.' },
  { title: 'Keluhan pelanggan', note: '3 komplain pengiriman telat, semua sudah ditindaklanjuti.' },
];

const INITIAL_ACTIONS: Action[] = [
  { id: 'a1', text: 'Tambah 1 kurir slot 15.00–18.00', assignee: 'Budi', done: false },
  { id: 'a2', text: 'Jadwalkan pickup retur galon Kamis', assignee: 'Sari', done: true },
  { id: 'a3', text: 'Follow-up komplain pelanggan blok C', assignee: 'Dewi', done: false },
  { id: 'a4', text: 'Update harga air isi ulang', assignee: 'Budi', done: true },
];

const TODAY = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(
  new Date(),
);

function HuddleBody() {
  const [actions, setActions] = useState<Action[]>(INITIAL_ACTIONS);

  const toggle = (id: string) =>
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, done: !a.done } : a)));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <UsersThree size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Huddle mingguan</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{TODAY} · 8 dari 9 hadir</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">Agenda & catatan</h2>
        {AGENDA.map((a) => (
          <Card key={a.title} className="flex flex-col gap-1 p-4">
            <p className="font-semibold">{a.title}</p>
            <p className="text-[12.5px] text-[color:var(--text-muted)]">{a.note}</p>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">Action item</h2>
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              className="flex items-center gap-3 p-4 text-left"
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
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-app p-3.5 text-sm font-semibold text-[color:var(--text-muted)] hover:bg-brand-50"
        >
          <Plus size={16} weight="bold" />
          Tambah action item
        </button>
      </section>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Huddle tim mingguan hanya untuk Manajer depot.
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
