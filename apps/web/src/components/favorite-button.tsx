'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Heart } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';

// Wishlist toggle (gap 13d). Single-product surfaces (PDP) — reads the caller's
// favorites once on mount to seed state, then optimistically toggles via
// POST/DELETE. Guests are sent to login. ponytail: no shared context — one product,
// one read; add a FavoritesProvider only if hearts land on every grid card.
export function FavoriteButton({ productId, className = '' }: { productId: string; className?: string }) {
  const router = useRouter();
  const { customer } = useAuth();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer) return;
    let alive = true;
    api
      .get<{ productIds: string[] }>(endpoints.favorites.list, true)
      .then((r) => {
        if (alive) setOn(r.productIds.includes(productId));
      })
      .catch(() => {}); // seeding is best-effort; toggle still works
    return () => {
      alive = false;
    };
  }, [customer, productId]);

  async function toggle() {
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${productId}`)}`);
      return;
    }
    const next = !on;
    setOn(next); // optimistic
    setBusy(true);
    try {
      if (next) await api.post(endpoints.favorites.add, { productId }, true);
      else await api.del(endpoints.favorites.remove(productId), true);
    } catch {
      setOn(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? 'Hapus dari favorit' : 'Simpan ke favorit'}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50 disabled:opacity-50 ${className}`}
    >
      <Heart size={20} weight={on ? 'fill' : 'regular'} className={on ? 'text-[color:var(--danger)]' : 'text-muted'} />
    </button>
  );
}
