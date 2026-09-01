'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { useT } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';
import { ErrorState, Skeleton } from '@/components/ui';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import type { Employee, HrPage } from '@/lib/hr';

/**
 * Pick an employee by name. §G-1, and now CA-1-17.
 *
 * Five HR screens asked a human to paste a UUID — `placeholder="UUID"`, literally — while
 * this exact picker already existed, copy-pasted four times a few files away. One
 * component, five wired fields, four copies deleted.
 *
 * It then became a `<select>` over `pageSize: 100`, and the comment above that number said
 * what the right answer was: "100 is the DTO's hard @Max — a depot past 100 active staff
 * needs a search-as-you-type picker, not a bigger page." It was correct twice over. A
 * bigger page is not reachable (the server caps at 100), and a dropdown of 300 names is not
 * a way to find a person even when it renders. So: the server filters, and this types.
 *
 * `search` is a parameter `endpoints.hr.employees` has always accepted and nothing sent.
 * Debounced at 300ms — the same interval `/hq/search` and the customer directory use — so
 * one search costs one request, not one per keystroke.
 *
 * Deliberately renders its own loading and error states rather than returning null: an
 * empty box where a picker should be is how somebody concludes the feature is broken.
 */
export function EmployeeSelect({
  value,
  onChange,
  label,
  placeholder,
  className = '',
  disabled = false,
}: {
  value: string;
  onChange: (employeeId: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const search = useDebounce(query);

  /*
   * The server does the narrowing. `pageSize: 20` is a screenful, not a ceiling on who is
   * reachable: a name that is not in the first twenty is found by typing more of it, which
   * is exactly what the 100-row list could not offer.
   */
  const employees = useAsync<HrPage<Employee>>(
    () =>
      api.getCached<HrPage<Employee>>(
        endpoints.hr.employees({
          status: 'ACTIVE',
          pageSize: 20,
          search: search.trim() || undefined,
        }),
        true,
      ),
    [search],
  );

  const rows = employees.data?.rows ?? [];
  const selected = rows.find((e) => e.id === value) ?? null;

  // Close on a click anywhere else. Without it the list stays over the next field, and on
  // a form with two pickers the second one opens under the first one's results.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (employee: Employee) => {
    onChange(employee.id);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (rows.length === 0) return;
      const next = e.key === 'ArrowDown' ? active + 1 : active - 1;
      setActive((next + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter' && open && rows[active]) {
      e.preventDefault();
      pick(rows[active]);
    }
  };

  // The picker owns the field, so a failed read has to say so here rather than leave an
  // input that silently finds nobody.
  if (employees.error && !employees.data) {
    return <ErrorState message={employees.error} onRetry={employees.reload} />;
  }

  return (
    <div ref={boxRef} className={`relative text-sm ${className}`}>
      <label className="block">
        {label ?? t('hrFix.employeeSelect.label')}
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          // Shows who is chosen when the box is idle, and what is being typed while it is
          // not — one field, never two sources of truth about the same answer.
          value={open ? query : (selected ? `${selected.employeeCode} — ${selected.fullName}` : query)}
          placeholder={placeholder ?? t('hrFix.employeeSelect.searchPlaceholder')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            // Typing over a chosen name clears the choice: leaving the old id behind while
            // the box shows a different word is how a payslip gets written for the wrong
            // person.
            if (value) onChange('');
          }}
          onKeyDown={onKeyDown}
          className="surface-elevated mt-1 block w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
        />
      </label>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="surface-elevated absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-app py-1 shadow-lg"
        >
          {employees.loading ? (
            <li className="px-3 py-2">
              <Skeleton className="h-5 w-40" />
            </li>
          ) : rows.length === 0 ? (
            // "No match" and "the read failed" are different answers, and a picker that
            // gives the first for the second is how somebody concludes a colleague has left.
            <li className="px-3 py-2 text-[13px] text-muted">
              {employees.error
                ? t('hrFix.employeeSelect.loadFailed')
                : t('hrFix.employeeSelect.noMatch')}
            </li>
          ) : (
            rows.map((e, i) => (
              <li key={e.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={e.id === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(e)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    i === active ? 'bg-brand-50 text-brand-700' : ''
                  }`}
                >
                  <span className="font-mono text-xs text-muted">{e.employeeCode}</span> {e.fullName}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
