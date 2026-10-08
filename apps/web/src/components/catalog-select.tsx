'use client';

import type { ReactNode } from 'react';

import { api } from '@/lib/api';
import { fetchAllDepots } from '@/lib/all-depots';
import { endpoints } from '@/lib/endpoints';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { useAsync } from '@/lib/use-async';
import type { Category, DepotAdmin, Product } from '@/lib/types';

/*
 * Pick a product, category or depot from the real list instead of pasting a 36-character id.
 *
 * A mistyped id does not error: the rule or voucher saves against something that does not
 * exist and simply never applies, so the promo the operator thinks is running is not running
 * (the same defect CA-2-64 fixed on the pricing screen). The lists are read in full via
 * `fetchAllPages`, never a silent first page.
 *
 * If the list cannot be loaded the select still shows the CURRENT value as an option, so an
 * edit never blanks a saved id by accident.
 */
const SELECT_CLASS =
  'w-full rounded-lg border border-app bg-surface px-3 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

interface Option {
  id: string;
  label: string;
}

function OptionSelect({
  id,
  value,
  onChange,
  emptyLabel,
  options,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel: ReactNode;
  options: Option[];
}) {
  const known = options.some((o) => o.id === value);
  return (
    <select id={id} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface PickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Label of the "none" row (e.g. "Semua produk"). */
  emptyLabel: ReactNode;
}

/** The whole catalogue (never a silent first page), for pickers and for tools that need prices. */
export function useProductList() {
  return useAsync<Product[]>(
    () => fetchAllPages<Product>(({ page, limit }) => api.get(endpoints.products.browse({ page, limit }))),
    [],
  );
}

export function ProductSelect(props: PickerProps) {
  const { data } = useProductList();
  return <OptionSelect {...props} options={(data ?? []).map((p) => ({ id: p.id, label: p.name }))} />;
}

export function CategorySelect(props: PickerProps) {
  const { data } = useAsync<Category[]>(() => api.get<Category[]>(endpoints.products.categories), []);
  return <OptionSelect {...props} options={(data ?? []).map((c) => ({ id: c.id, label: c.name }))} />;
}

export function DepotSelect(props: PickerProps) {
  const { data } = useAsync<DepotAdmin[]>(() => fetchAllDepots(), []);
  return <OptionSelect {...props} options={(data ?? []).map((d) => ({ id: d.id, label: d.name }))} />;
}
