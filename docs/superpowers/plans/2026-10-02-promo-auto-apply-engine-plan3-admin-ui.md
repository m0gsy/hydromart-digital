# Mesin Promo Auto-Apply — Plan 3: Admin UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HQ and depot staff a screen to create/edit/delete `PromoRule` rows — before
this plan, the only way to create one is a direct `POST /promotions/promo-rules` call
(Plan 1's Swagger doc or curl). Two pages: `/hq/promo-rules` (network-wide, every depot
visible) and `/dashboard/promo-rules` (scoped to the depot console's selected depot).

**Architecture:** Both pages follow this repo's established CRUD-page shape exactly — the
same one `/hq/promotions` and `/dashboard/promotions` already use (list + inline editor
card, `useAsync` for the list fetch, `api.get/post/patch/del` against a hand-maintained
`endpoints.ts`, `useT()` for every string). No new component patterns, no new state
library, no new picker component — `productId`/`categoryId`/`depotId` are plain UUID text
inputs for fase 1 (a dedicated product/category picker is a polish item, explicitly out of
scope here, same as how `voucherCode`/`imageUrl` are plain text inputs on the Promotion
editor this mirrors).

**Tech Stack:** Next.js (App Router, client components), the existing `@/components/ui`
kit (`Card`, `Field`, `Input`, `Button`, `Badge`, etc.), `@hydromart/access`'s capability
check already wired through this repo's nav/guard conventions.

## Global Constraints

- Every user-facing string goes through `useT()` / the `id`/`en` dictionaries — this repo's
  `check-i18n` CI gate fails a build with a hardcoded string. Add both languages for every
  new key, in the same task that introduces the string.
- `categoryId` is accepted on the form (it is a real column, Plan 1 built it) but a banner
  note under the field says it will not match at checkout yet, matching Plan 2's stated
  scope limitation — do not silently hide the field, state the limitation in the UI copy
  instead (same honesty standard as the plan's own docs).
- API base paths: promo-service is reached through the gateway at `/vouchers/api/v1/...`
  (gateway route-prefix `vouchers` → `PROMO_SERVICE_URL`, see
  `services/gateway-service/src/config/gateway-config.service.ts:27` and the existing
  `promotions.*` entries in `apps/web/src/lib/endpoints/shop.ts`) — NOT `/promotions/api/v1`.
  Every new endpoint in this plan uses that prefix.
- Both pages gate on the `promoRuleRead`/`promoRuleWrite` capabilities added in Plan 1 — HQ
  via `hq-nav.ts`'s `cap` field (same mechanism `promotionRead` already uses), dashboard via
  a `can()`-wrapped predicate in `roles.ts` (same mechanism `canViewCampaigns` already uses).
- **CORRECTION (2026-10-04), before any task below is executed:** a Plan 1 fix batch (after
  this plan's text was originally written) added an optimistic-concurrency guard to
  `PromoRuleService.update()` — every `PATCH` now REQUIRES a `seenUpdatedAt` field matching
  the row's current `updatedAt`, or the server throws `StaleWriteError` (confirmed by reading
  `promo-rule.service.ts`'s real `update()` and `assertFresh()` in `packages/platform` — there
  is no decision-only-patch exemption for this entity, unlike `Promotion`'s toggle). Without
  this field, EVERY edit through this plan's admin UI would fail every time, not just on a
  real conflict. `/hq/promotions`' own editor (this plan's explicit template) already solves
  the identical requirement for `Promotion` — mirror it exactly: `PromoRulePayload` gains
  `seenUpdatedAt?: string` (Task 1), and Task 4/5's `RuleEditor.submit()` sends
  `{ ...payload, seenUpdatedAt: rule.updatedAt }` on the `PATCH` call only (never on `POST`
  create, which has no existing row to be stale against) — copy
  `apps/web/src/app/hq/promotions/page.tsx`'s own `submit()` (around line 86-98) for the
  exact shape.

---

### Task 1: Types + endpoints

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/endpoints/shop.ts`

**Interfaces:**
- Produces (consumed by Tasks 4-5):
  - `interface PromoRule` (mirrors Plan 1's `PromoRuleResponseDto` exactly)
  - `interface PromoRulePayload` (create/update body)
  - `endpoints.promoRules.{manage,create,detail,remove}` — note there is no `.list` public
    endpoint (unlike `promotions.list`); `PromoRule` has no customer-facing read, only
    admin.

- [ ] **Step 1: Add the types**

In `apps/web/src/lib/types.ts`, add this block right after the existing `Promotion`/
`PromotionPayload`/`PromotionAnalytics` interfaces (so it sits beside its nearest relative):

```typescript
export type PromoRuleKind = 'SPECIAL_PRICE' | 'BUY_X_GET_Y' | 'SHIPPING_DISCOUNT';
export type PromoRuleChannel = 'APP' | 'COUNTER';

export interface PromoRule {
  id: string;
  name: string;
  kind: PromoRuleKind;
  depotId: string | null;
  productId: string | null;
  categoryId: string | null;
  specialPrice: number | null;
  buyQty: number | null;
  getQty: number | null;
  shippingFeeOverride: number | null;
  validFrom: string | null;
  validUntil: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  minQty: number;
  maxQty: number | null;
  channels: PromoRuleChannel[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromoRulePayload {
  name: string;
  kind: PromoRuleKind;
  depotId?: string | null;
  productId?: string | null;
  categoryId?: string | null;
  specialPrice?: number | null;
  buyQty?: number | null;
  getQty?: number | null;
  shippingFeeOverride?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  minQty?: number;
  maxQty?: number | null;
  channels?: PromoRuleChannel[];
  active?: boolean;
  /** CA-2-53: sent only on PATCH, equal to the row's `updatedAt` as last read — the server
   *  rejects the write (409) if the row moved since. Never sent on create. */
  seenUpdatedAt?: string;
}
```

- [ ] **Step 2: Add the endpoints**

In `apps/web/src/lib/endpoints/shop.ts`, find the `promotions: { ... }` block (it ends with
`uploadImage: '/vouchers/api/v1/promotions/upload-image',\n  },`) and add a sibling block
right after its closing `},`:

```typescript
  promoRules: {
    // Item 5 fase 1. No public list — this is admin-only (promoRuleRead/promoRuleWrite).
    manage: '/vouchers/api/v1/promotions/promo-rules',
    create: '/vouchers/api/v1/promotions/promo-rules',
    detail: (id: string) => `/vouchers/api/v1/promotions/promo-rules/${id}`,
  },
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web
npx tsc --noEmit -p .
```

Expected: exits 0 (these are pure additions, nothing references them yet).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/endpoints/shop.ts
git commit -m "feat(web): PromoRule types + endpoints (item 5 fase 1)"
```

---

### Task 2: i18n — HQ and dashboard dictionaries, `id` and `en`

**Files:**
- Modify: `apps/web/src/lib/dictionaries/id/hq.ts`
- Modify: `apps/web/src/lib/dictionaries/en/hq.ts`
- Modify: `apps/web/src/lib/dictionaries/id/dashboard.ts`
- Modify: `apps/web/src/lib/dictionaries/en/dashboard.ts`

**Interfaces:**
- Produces (consumed by Tasks 3-5): translation keys `hq.nav.promoRules`,
  `hq.promoRules.*`, `dashboard.nav.promoRules`, `dashboard.promoRules.*` — same key shape
  in both languages, so `useT()` never falls through to a missing-key placeholder.

- [ ] **Step 1: `id/hq.ts` — nav label + page strings**

Find the `nav:` object's `promotions: 'Promosi & banner',` line and add directly below it:

```typescript
    promoRules: 'Aturan promo',
```

Find the top-level `promotions: { ... }` block (page strings, starts `title: 'Promosi &
banner',`) and add a sibling block right after its closing `},`:

```typescript
  promoRules: {
    title: 'Aturan promo',
    subtitle: 'Promo otomatis saat checkout — jadwal, produk, kelipatan',
    newRule: '＋ Aturan baru',
    active: 'Aktif',
    inactive: 'Nonaktif',
    empty: 'Belum ada aturan promo. Buat yang pertama.',
    editorNew: 'Aturan promo baru',
    editorEdit: 'Edit aturan promo',
    save: 'Simpan',
    create: 'Buat',
    cancel: 'Batal',
    edit: 'Edit',
    remove: 'Hapus',
    needName: 'Nama wajib diisi.',
    saveError: 'Gagal menyimpan aturan promo.',
    fields: {
      name: 'Nama',
      kind: 'Jenis',
      kindSpecialPrice: 'Harga khusus (SPECIAL_PRICE)',
      kindBogo: 'Beli X dapat Y (BUY_X_GET_Y)',
      kindShipping: 'Potongan ongkir (SHIPPING_DISCOUNT)',
      depotId: 'Depot (ID)',
      depotIdHint: 'Kosongkan untuk berlaku network-wide (semua depot).',
      productId: 'Produk (ID)',
      categoryId: 'Kategori (ID)',
      categoryIdHint: 'Belum berlaku saat checkout di fase ini — gunakan Produk (ID) dulu.',
      specialPrice: 'Harga baru (Rp per unit)',
      buyQty: 'Beli (qty)',
      getQty: 'Gratis (qty)',
      shippingFeeOverride: 'Ongkir baru (Rp per galon)',
      validFrom: 'Mulai',
      validUntil: 'Berakhir',
      daysOfWeek: 'Hari',
      startTime: 'Jam mulai',
      endTime: 'Jam berakhir',
      minQty: 'Qty minimum',
      maxQty: 'Qty maksimum',
      channels: 'Channel',
      channelApp: 'Aplikasi',
      channelCounter: 'Kasir',
      active: 'Aktif',
    },
    days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  },
```

- [ ] **Step 2: `en/hq.ts` — same keys, English copy**

Find the same two spots in `apps/web/src/lib/dictionaries/en/hq.ts` and add the mirrored
entries:

```typescript
    promoRules: 'Promo rules',
```

```typescript
  promoRules: {
    title: 'Promo rules',
    subtitle: 'Auto-apply promos at checkout — schedule, products, multiples',
    newRule: '＋ New rule',
    active: 'Active',
    inactive: 'Inactive',
    empty: 'No promo rules yet. Create the first one.',
    editorNew: 'New promo rule',
    editorEdit: 'Edit promo rule',
    save: 'Save',
    create: 'Create',
    cancel: 'Cancel',
    edit: 'Edit',
    remove: 'Remove',
    needName: 'Name is required.',
    saveError: 'Could not save the promo rule.',
    fields: {
      name: 'Name',
      kind: 'Kind',
      kindSpecialPrice: 'Special price (SPECIAL_PRICE)',
      kindBogo: 'Buy X get Y (BUY_X_GET_Y)',
      kindShipping: 'Shipping discount (SHIPPING_DISCOUNT)',
      depotId: 'Depot (ID)',
      depotIdHint: 'Leave blank for network-wide (all depots).',
      productId: 'Product (ID)',
      categoryId: 'Category (ID)',
      categoryIdHint: "Does not match at checkout yet this phase — use Product (ID) for now.",
      specialPrice: 'New price (Rp per unit)',
      buyQty: 'Buy (qty)',
      getQty: 'Free (qty)',
      shippingFeeOverride: 'New shipping fee (Rp per galon)',
      validFrom: 'Starts',
      validUntil: 'Ends',
      daysOfWeek: 'Days',
      startTime: 'Start time',
      endTime: 'End time',
      minQty: 'Min qty',
      maxQty: 'Max qty',
      channels: 'Channels',
      channelApp: 'App',
      channelCounter: 'Counter',
      active: 'Active',
    },
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
```

- [ ] **Step 3: `id/dashboard.ts` and `en/dashboard.ts`**

Find the nav entry for `promo:` (used by `ops-rail.tsx`'s `labelKey: 'promo'` for
`/dashboard/promotions`) in `id/dashboard.ts`, and add directly below it:

```typescript
    promoRules: 'Aturan promo',
```

And the English equivalent in `en/dashboard.ts`:

```typescript
    promoRules: 'Promo rules',
```

Then add a page-strings block to `id/dashboard.ts` — same shape as Step 1's `hq.promoRules`
block above, under a top-level `promoRules: { ... }` key, with identical field keys (copy
Step 1's block verbatim; depot-scoped behaviour is a prop on the page component, Task 5,
not a different dictionary shape). Add the English mirror to `en/dashboard.ts` the same way
(copy Step 2's block verbatim).

- [ ] **Step 4: Run the i18n gate**

```bash
cd apps/web
node ../../scripts/check-i18n.mjs 2>/dev/null || node scripts/check-i18n.mjs
```

(Run whichever path resolves — check `package.json`'s `check-i18n` script for the exact
invocation this repo uses, e.g. `npm run check-i18n`.)

Expected: exits 0 — every key exists in both languages, nothing hardcoded yet since no page
uses these keys until Tasks 4-5.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/dictionaries
git commit -m "feat(web): i18n strings for promo-rules admin UI (id + en)"
```

---

### Task 3: Nav wiring — HQ rail and dashboard ops rail

**Files:**
- Modify: `apps/web/src/lib/hq-nav.ts`
- Modify: `apps/web/src/components/hq/hq-rail.tsx`
- Modify: `apps/web/src/lib/roles.ts`
- Modify: `apps/web/src/components/dashboard/ops-rail.tsx`

**Interfaces:**
- Consumes: `promoRuleRead` capability (Plan 1).
- Produces: `canManagePromoRules` predicate (consumed by Task 3 Step 4 and nowhere else in
  this plan, but it is the reusable check any future dashboard screen for this feature
  would also use).

- [ ] **Step 1: HQ nav entry**

In `apps/web/src/lib/hq-nav.ts`, find the line
`{ href: '/hq/promotions', labelKey: 'promotions', cap: 'promotionRead' },` and add directly
after it:

```typescript
      { href: '/hq/promo-rules', labelKey: 'promoRules', cap: 'promoRuleRead' },
```

- [ ] **Step 2: HQ rail icon**

In `apps/web/src/components/hq/hq-rail.tsx`, find `'/hq/promotions': ImageIcon,` in the
`HQ_ICONS` map and add directly after it (reuse an icon already imported in this file —
`Tag` is already imported for `/hq/pricing` per this file's existing icon set; confirm by
checking this file's import list, and if `Tag` is not already imported, import it from
`@phosphor-icons/react` alongside the other icon imports at the top of the file):

```typescript
  '/hq/promo-rules': Tag,
```

- [ ] **Step 3: Dashboard predicate**

In `apps/web/src/lib/roles.ts`, find `export const canViewCampaigns = (role: string | null
| undefined) => can('campaignRead', role);` and add directly after it:

```typescript
export const canManagePromoRules = (role: string | null | undefined) =>
  can('promoRuleRead', role);
```

- [ ] **Step 4: Dashboard nav entry**

In `apps/web/src/components/dashboard/ops-rail.tsx`:
1. Add `canManagePromoRules` to the existing import from `'@/lib/roles'` (alongside
   `canViewCampaigns`).
2. Find `{ href: '/dashboard/promotions', labelKey: 'promo', icon: Megaphone, show:
   canViewCampaigns },` and add directly after it:

```typescript
      { href: '/dashboard/promo-rules', labelKey: 'promoRules', icon: Tag, show: canManagePromoRules },
```

If `Tag` is not already imported in this file from `@phosphor-icons/react`, add it to the
existing icon import line.

- [ ] **Step 5: Typecheck**

```bash
cd apps/web
npx tsc --noEmit -p .
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/hq-nav.ts apps/web/src/components/hq/hq-rail.tsx apps/web/src/lib/roles.ts apps/web/src/components/dashboard/ops-rail.tsx
git commit -m "feat(web): nav entries for promo-rules in HQ + dashboard consoles"
```

---

### Task 4: `/hq/promo-rules` page

**Files:**
- Create: `apps/web/src/app/hq/promo-rules/page.tsx`

**Interfaces:**
- Consumes: `PromoRule`/`PromoRulePayload` (Task 1), `endpoints.promoRules.*` (Task 1),
  `hq.promoRules.*` strings (Task 2).

- [ ] **Step 1: Write the page**

Create `apps/web/src/app/hq/promo-rules/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { PromoRule, PromoRuleChannel, PromoRuleKind, PromoRulePayload } from '@/lib/types';

interface RuleForm {
  name: string;
  kind: PromoRuleKind;
  depotId: string;
  productId: string;
  categoryId: string;
  specialPrice: string;
  buyQty: string;
  getQty: string;
  shippingFeeOverride: string;
  validFrom: string;
  validUntil: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  minQty: string;
  maxQty: string;
  channels: PromoRuleChannel[];
  active: boolean;
}

const EMPTY: RuleForm = {
  name: '', kind: 'SPECIAL_PRICE', depotId: '', productId: '', categoryId: '',
  specialPrice: '', buyQty: '', getQty: '', shippingFeeOverride: '',
  validFrom: '', validUntil: '', daysOfWeek: [], startTime: '', endTime: '',
  minQty: '1', maxQty: '', channels: [], active: true,
};

function formFrom(r: PromoRule): RuleForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return {
    name: r.name, kind: r.kind, depotId: r.depotId ?? '', productId: r.productId ?? '',
    categoryId: r.categoryId ?? '',
    specialPrice: r.specialPrice != null ? String(r.specialPrice) : '',
    buyQty: r.buyQty != null ? String(r.buyQty) : '',
    getQty: r.getQty != null ? String(r.getQty) : '',
    shippingFeeOverride: r.shippingFeeOverride != null ? String(r.shippingFeeOverride) : '',
    validFrom: day(r.validFrom), validUntil: day(r.validUntil),
    daysOfWeek: r.daysOfWeek, startTime: r.startTime ?? '', endTime: r.endTime ?? '',
    minQty: String(r.minQty), maxQty: r.maxQty != null ? String(r.maxQty) : '',
    channels: r.channels, active: r.active,
  };
}

function toPayload(f: RuleForm): PromoRulePayload {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  const numOrNull = (s: string) => (s.trim() ? Number(s) : null);
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  return {
    name: f.name.trim(),
    kind: f.kind,
    depotId: orNull(f.depotId),
    productId: orNull(f.productId),
    categoryId: orNull(f.categoryId),
    specialPrice: f.kind === 'SPECIAL_PRICE' ? numOrNull(f.specialPrice) : null,
    buyQty: f.kind === 'BUY_X_GET_Y' ? numOrNull(f.buyQty) : null,
    getQty: f.kind === 'BUY_X_GET_Y' ? numOrNull(f.getQty) : null,
    shippingFeeOverride: f.kind === 'SHIPPING_DISCOUNT' ? numOrNull(f.shippingFeeOverride) : null,
    validFrom: dateOrNull(f.validFrom),
    validUntil: dateOrNull(f.validUntil),
    daysOfWeek: f.daysOfWeek,
    startTime: orNull(f.startTime),
    endTime: orNull(f.endTime),
    minQty: Number(f.minQty) || 1,
    maxQty: numOrNull(f.maxQty),
    channels: f.channels,
    active: f.active,
  };
}

function KindFields({ form, set }: { form: RuleForm; set: (k: keyof RuleForm) => (e: { target: { value: string } }) => void }) {
  const { t } = useT();
  if (form.kind === 'SPECIAL_PRICE') {
    return (
      <Field label={t('hq.promoRules.fields.specialPrice')}>
        <Input type="number" value={form.specialPrice} onChange={set('specialPrice')} />
      </Field>
    );
  }
  if (form.kind === 'BUY_X_GET_Y') {
    return (
      <>
        <Field label={t('hq.promoRules.fields.buyQty')}>
          <Input type="number" value={form.buyQty} onChange={set('buyQty')} />
        </Field>
        <Field label={t('hq.promoRules.fields.getQty')}>
          <Input type="number" value={form.getQty} onChange={set('getQty')} />
        </Field>
      </>
    );
  }
  return (
    <Field label={t('hq.promoRules.fields.shippingFeeOverride')}>
      <Input type="number" value={form.shippingFeeOverride} onChange={set('shippingFeeOverride')} />
    </Field>
  );
}

function RuleEditor({ rule, onDone, onCancel }: { rule: PromoRule | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState<RuleForm>(rule ? formFrom(rule) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dayLabels = t('hq.promoRules.days') as unknown as string[];

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day) ? f.daysOfWeek.filter((d) => d !== day) : [...f.daysOfWeek, day],
    }));
  }

  function toggleChannel(channel: PromoRuleChannel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(channel) ? f.channels.filter((c) => c !== channel) : [...f.channels, channel],
    }));
  }

  async function submit() {
    if (!form.name.trim()) {
      setError(t('hq.promoRules.needName'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(form);
      if (rule) {
        await api.patch(
          endpoints.promoRules.detail(rule.id),
          // CA-2-53: the version this edit started from; the server refuses (409) if it moved.
          { ...payload, seenUpdatedAt: rule.updatedAt },
          true,
        );
      } else {
        await api.post(endpoints.promoRules.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.promoRules.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{rule ? t('hq.promoRules.editorEdit') : t('hq.promoRules.editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hq.promoRules.fields.name')}>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <Field label={t('hq.promoRules.fields.kind')}>
          <select
            className="w-full rounded-lg border border-app bg-surface px-3 py-2.5 text-sm"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PromoRuleKind }))}
          >
            <option value="SPECIAL_PRICE">{t('hq.promoRules.fields.kindSpecialPrice')}</option>
            <option value="BUY_X_GET_Y">{t('hq.promoRules.fields.kindBogo')}</option>
            <option value="SHIPPING_DISCOUNT">{t('hq.promoRules.fields.kindShipping')}</option>
          </select>
        </Field>
        <Field label={t('hq.promoRules.fields.depotId')} hint={t('hq.promoRules.fields.depotIdHint')}>
          <Input value={form.depotId} onChange={set('depotId')} />
        </Field>
        <Field label={t('hq.promoRules.fields.productId')}>
          <Input value={form.productId} onChange={set('productId')} />
        </Field>
        <Field label={t('hq.promoRules.fields.categoryId')} hint={t('hq.promoRules.fields.categoryIdHint')}>
          <Input value={form.categoryId} onChange={set('categoryId')} />
        </Field>
        <KindFields form={form} set={set} />
        <Field label={t('hq.promoRules.fields.validFrom')}>
          <Input type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('hq.promoRules.fields.validUntil')}>
          <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
        <Field label={t('hq.promoRules.fields.startTime')}>
          <Input type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label={t('hq.promoRules.fields.endTime')}>
          <Input type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        <Field label={t('hq.promoRules.fields.minQty')}>
          <Input type="number" value={form.minQty} onChange={set('minQty')} />
        </Field>
        <Field label={t('hq.promoRules.fields.maxQty')}>
          <Input type="number" value={form.maxQty} onChange={set('maxQty')} />
        </Field>
        <Field label={t('hq.promoRules.fields.daysOfWeek')}>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((label, day) => (
              <label key={day} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('hq.promoRules.fields.channels')}>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('APP')} onChange={() => toggleChannel('APP')} />
              {t('hq.promoRules.fields.channelApp')}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('COUNTER')} onChange={() => toggleChannel('COUNTER')} />
              {t('hq.promoRules.fields.channelCounter')}
            </label>
          </div>
        </Field>
        {rule && (
          <Field label={t('hq.promoRules.fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {t('hq.promoRules.fields.active')}
            </label>
          </Field>
        )}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {rule ? t('hq.promoRules.save') : t('hq.promoRules.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('hq.promoRules.cancel')}
        </Button>
      </div>
    </Card>
  );
}

export default function HqPromoRulesPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [editing, setEditing] = useState<PromoRule | null | undefined>(undefined);
  const { data, error, loading, reload } = useAsync<PromoRule[]>(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
  );

  async function remove(id: string) {
    try {
      await api.del(endpoints.promoRules.detail(id), true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hq.common.actionFailed'), 'error');
    }
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={TagIcon}
        title={t('hq.promoRules.title')}
        subtitle={t('hq.promoRules.subtitle')}
        action={
          <>
            {editing === undefined && <Button onClick={() => setEditing(null)}>{t('hq.promoRules.newRule')}</Button>}
          </>
        }
      />

      {editing !== undefined && (
        <RuleEditor
          rule={editing}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <CenterState icon={<TagIcon size={48} weight="thin" />} title={t('hq.promoRules.empty')} />
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{r.name}</span>
                  <Badge tone="neutral">{r.kind}</Badge>
                  <Badge tone={r.active ? 'success' : 'neutral'}>
                    {r.active ? t('hq.promoRules.active') : t('hq.promoRules.inactive')}
                  </Badge>
                </span>
                <span className="truncate text-sm text-muted">
                  {r.depotId ?? 'network-wide'} · {r.productId ?? r.categoryId ?? 'semua produk'}
                </span>
              </div>
              <Button variant="ghost" onClick={() => setEditing(r)}>
                {t('hq.promoRules.edit')}
              </Button>
              <Button variant="danger" onClick={() => remove(r.id)}>
                {t('hq.promoRules.remove')}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web
npx tsc --noEmit -p .
```

Expected: exits 0. If `Field`'s `hint` prop, `Badge`'s `tone` values, or `HqPageHeader`'s
prop names differ from what this step assumes, fix them to match
`apps/web/src/app/hq/promotions/page.tsx`'s actual usage (read that file's current imports
and prop usage again if the compiler disagrees — it is this page's direct template).

- [ ] **Step 3: Run the i18n gate**

```bash
npm run check-i18n
```

Expected: exits 0 — every `t('hq.promoRules....')` call in this file resolves in both `id`
and `en` (added in Task 2).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/hq/promo-rules/page.tsx
git commit -m "feat(web): /hq/promo-rules admin page"
```

---

### Task 5: `/dashboard/promo-rules` page

**Files:**
- Create: `apps/web/src/app/dashboard/promo-rules/page.tsx`

**Interfaces:**
- Consumes: everything from Task 4's page (same component shape), plus this console's
  active-depot context. Check how a sibling depot-scoped page (`/dashboard/promotions` or
  `/dashboard/pricing`) reads the currently-selected depot — this repo's dashboard console
  keeps it in a shared context/hook (the same one that rendered "Depot Hydromart Galaxy
  Bekasi · konteks aktif" in the sidebar during this session's browser-verify). Import and
  use that same hook; do not invent a second way to read the active depot.

- [ ] **Step 1: The active-depot hook (already confirmed, 2026-10-04 — no need to re-search)**

This plan originally left this as a live-file grep for the implementer. It has since been
confirmed directly against the real code: the hook is `useDepot()`, imported from
`@/lib/depot-context` (NOT `useActiveDepot` — that name does not exist anywhere in this
codebase). It returns a `DepotContextValue` with (among other fields) `selectedId: string |
null` — exactly the plain id this task needs, already resolved to `depots[0]?.id` as a
fallback when nothing is explicitly selected (read `depot-context.tsx`'s `selectedId`
logic if you want the fallback's full reasoning; you don't need to re-derive it). Every
reference to `useActiveDepot()` and `{ id: string | null }` in Step 2 below means
`useDepot()` and `.selectedId` — the code block has already been corrected to use the real
names.

- [ ] **Step 2: Write the page**

Create `apps/web/src/app/dashboard/promo-rules/page.tsx` as a copy of Task 4's
`apps/web/src/app/hq/promo-rules/page.tsx` with these differences (apply them to the copy):

1. Every `t('hq.promoRules...')` call becomes `t('dashboard.promoRules...')` (the strings
   from Task 2 Step 3 use the identical key shape under a different root).
2. Every `t('hq.common.actionFailed')` becomes `t('dashboard.common.actionFailed')` — check
   this key exists in `dashboard.ts` the same way it does in `hq.ts`; if the exact key name
   differs, use whatever this console's existing pages (`/dashboard/promotions`) already
   call for the same purpose.
3. Import `useDepot` from `'@/lib/depot-context'` and read `const { selectedId: activeDepotId } = useDepot();` at the top of `DashboardPromoRulesPage` (the renamed `HqPromoRulesPage`).
4. The `RuleEditor`'s `depotId` field becomes **read-only, pre-filled with the active
   depot's id** (a depot-console user creates rules scoped to their own depot only — Plan 1's
   `promoRuleWrite` capability for `KEPALA_DEPOT` was granted on exactly this assumption, see
   Plan 1 Task 5 Step 1's capability comment). Replace the `depotId` `Field`/`Input` pair
   with:

```tsx
        <Field label={t('dashboard.promoRules.fields.depotId')}>
          <Input value={activeDepotId ?? ''} disabled />
        </Field>
```

   and in `EMPTY`/`formFrom`/`toPayload`, replace every use of `form.depotId` with the
   active depot id directly rather than a form field — `toPayload` takes the active depot
   id as a second argument: `toPayload(form: RuleForm, depotId: string | null):
   PromoRulePayload`, and both call sites (`submit()` in `RuleEditor`) pass it through from
   a new `depotId` prop the page passes down to `<RuleEditor depotId={activeDepotId} ... />`.
5. The list endpoint call stays `endpoints.promoRules.manage` (unchanged — the backend
   already scopes the response by the caller's `depotScopeIds`, see Plan 1 Task 5's
   `list()` controller method; a depot-scoped caller only ever receives their own
   network-wide-visible + own-depot rows, no client-side filtering needed here).
6. Rename the default export to `DashboardPromoRulesPage`.

- [ ] **Step 3: Typecheck**

```bash
cd apps/web
npx tsc --noEmit -p .
```

Expected: exits 0.

- [ ] **Step 4: Run the i18n gate**

```bash
npm run check-i18n
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/promo-rules/page.tsx
git commit -m "feat(web): /dashboard/promo-rules admin page (depot-scoped)"
```

---

### Task 6: Full build + manual browser-verify

**Files:** none (verification only).

- [ ] **Step 1: Full web build**

```bash
cd apps/web
npm run build
```

Expected: exits 0 — confirms no route conflicts, no missing i18n keys the dev-mode
typecheck might have missed, no bundle-size regression the repo's own ratchets would catch.

- [ ] **Step 2: Repo-wide gates**

```bash
cd ../..
node scripts/check-i18n.mjs
node scripts/check-console-gates.mjs
```

(Use whichever exact invocation `package.json`'s `check-i18n`/`check-console-gates` scripts
show — these are the same two gates every prior PR in this plan's lineage (#608, #609) had
to pass.)

Expected: both exit 0.

- [ ] **Step 3: Manual browser-verify (deploy first, same as Plan 1/2's own precedent)**

This plan's commits are not live until deployed — same situation Plan 1/2 document for
their own backend pieces. Once deployed:

1. Log in to `/hq` as a `promoRuleWrite`-capable role (MARKETING/MANAGER/SUPER_ADMIN).
2. Open `/hq/promo-rules`, create one rule of each `kind` (SPECIAL_PRICE, BUY_X_GET_Y,
   SHIPPING_DISCOUNT), confirm each saves and the conditional fields show/hide correctly.
3. Log in to `/dashboard` as a `KEPALA_DEPOT`, open `/dashboard/promo-rules`, confirm the
   depot field is pre-filled and read-only, create a rule, confirm it appears in `/hq/promo-rules`'s
   list too (network-visible admin read) scoped correctly.
4. Delete the test rules created in steps 2-3.

---

## Self-Review Notes (already applied above)

- **Spec coverage:** types/endpoints (Task 1), i18n both languages both consoles (Task 2),
  nav wiring both consoles incl. capability gating (Task 3), HQ page with all 3 kind's
  conditional fields + schedule + channel + depot/product/category inputs (Task 4),
  dashboard depot-scoped variant (Task 5), build+gates+manual verify (Task 6). A
  product/category PICKER component (vs. plain UUID text input) is explicitly out of scope,
  stated as a deliberate simplification in the plan header, not a silent gap.
- **Placeholder scan:** Task 5 Steps 1-2 point at a live hook this plan has not independently
  verified the name of (the session's research budget was already very high by this plan),
  with an explicit instruction for what to search for and what to do with what is found —
  flagged the same way Plan 2's Task 3 Step 2 flags its one live-file-dependent step, not
  left as a bare "wire it up".
- **Type consistency:** `PromoRule`/`PromoRuleKind`/`PromoRuleChannel`/`PromoRulePayload`
  (Task 1) match Plan 1's `PromoRuleResponseDto`/DTOs field-for-field; `hq.promoRules.*` /
  `dashboard.promoRules.*` key shapes (Task 2) match every `t('...')` call in Tasks 4-5.
