// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DonutChart, GaugeChart, HeatTable, MultiLine, wholeShares } from '@/components/hq/charts';
import { initials } from '@/components/insight/tabs/customers';
import { INSIGHT_TABS, canViewInsight, resolveTab, visibleTabs } from '@/lib/insight/access';
import { overviewSentence } from '@/lib/insight/sentences';
import { useInsightData } from '@/lib/insight/use-insight-data';

vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));

afterEach(cleanup);

describe('MultiLine', () => {
  const labels = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const series = [
    {
      label: 'Omzet',
      values: [100_000, 0, 1_400_000],
      axis: 'left' as const,
      tone: 'brand' as const,
      money: true,
    },
    { label: 'Pesanan', values: [2, 0, 7], axis: 'right' as const, tone: 'amber' as const },
  ];

  it('prints every value as text for a reader with no hover and no picture', () => {
    const { container } = render(<MultiLine labels={labels} series={series} ariaLabel="grafik" />);
    const table = container.querySelector('table.sr-only')!;
    expect(table.textContent).toContain('2026-10-02');
    // Money is compact, counts are plain, and a zero is a zero rather than a missing cell.
    expect(table.textContent).toContain('1,4jt');
    expect(table.textContent).toContain('100rb');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'grafik' })).toBeTruthy();
  });

  it('states each axis maximum so a line height means something', () => {
    const { container } = render(<MultiLine labels={labels} series={series} ariaLabel="grafik" />);
    const legend = container.querySelector('ul')!.textContent ?? '';
    expect(legend).toContain('max 1,4jt');
    expect(legend).toContain('max 7');
  });

  it('draws a single point and survives an empty series', () => {
    const one = render(
      <MultiLine labels={['2026-10']} series={[{ ...series[0]!, values: [5] }]} ariaLabel="x" />,
    );
    expect(one.container.querySelectorAll('circle')).toHaveLength(1);
    expect(one.container.querySelector('polyline')).toBeNull();
    cleanup();
    const none = render(<MultiLine labels={[]} series={[]} ariaLabel="x" />);
    expect(none.container.textContent).toBe('—');
  });

  it('puts both lines on their own scale: a flat zero series stays on the floor, not NaN', () => {
    const { container } = render(
      <MultiLine
        labels={labels}
        series={[{ label: 'Nol', values: [0, 0, 0], axis: 'left', tone: 'brand' }]}
        ariaLabel="x"
      />,
    );
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('GaugeChart', () => {
  it('shows the true percentage even past the target, and clips only the arc', () => {
    const { container } = render(<GaugeChart value={250} max={100} ariaLabel="capaian" />);
    expect(container.textContent).toContain('250%');
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('draws no progress arc at zero, and floors a negative value at zero', () => {
    const zero = render(<GaugeChart value={0} max={100} ariaLabel="x" />);
    expect(zero.container.textContent).toContain('0%');
    expect(zero.container.querySelectorAll('path')).toHaveLength(1);
    cleanup();
    const negative = render(<GaugeChart value={-50} max={100} ariaLabel="x" />);
    expect(negative.container.textContent).toContain('0%');
  });

  it('draws nothing for a target that is not positive, rather than an empty arc', () => {
    for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { container } = render(<GaugeChart value={10} max={max} ariaLabel="x" />);
      expect(container.textContent).toBe('—');
      cleanup();
    }
  });

  it('carries its meaning for a screen reader', () => {
    render(
      <GaugeChart value={50} max={100} caption="Rp 50 dari Rp 100" ariaLabel="capaian omzet" />,
    );
    expect(screen.getByRole('img', { name: 'capaian omzet' })).toBeTruthy();
    expect(screen.getByText('Rp 50 dari Rp 100')).toBeTruthy();
  });
});

describe('wholeShares', () => {
  it('adds up to exactly 100, where rounding each slice would give 99', () => {
    expect(wholeShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholeShares([1, 1, 1]).reduce((n, x) => n + x, 0)).toBe(100);
    expect(wholeShares([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it('gives a slice too small to earn a point none, and still totals 100', () => {
    const out = wholeShares([100_000, 1]);
    expect(out[1]).toBe(0);
    expect(out.reduce((n, x) => n + x, 0)).toBe(100);
  });

  it('has no shares when there is nothing to share', () => {
    expect(wholeShares([])).toEqual([]);
    expect(wholeShares([0, 0])).toEqual([0, 0]);
    expect(wholeShares([-5, 0])).toEqual([0, 0]);
  });
});

describe('DonutChart', () => {
  const money = (n: number) => 'Rp ' + n;

  it('says every slice in text: label, value and share, with the total in the middle', () => {
    const { container } = render(
      <DonutChart
        total="Total"
        format={money}
        ariaLabel="pembagian"
        segments={[
          { label: 'Galon', value: 750 },
          { label: 'Botol', value: 250 },
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Galon');
    expect(text).toContain('Rp 750');
    expect(text).toContain('75%');
    expect(text).toContain('25%');
    // The ring's middle: the sum of what is drawn.
    expect(text).toContain('Rp 1000');
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('leaves out a slice with no value, and prints "<1%" for one too small to read as a point', () => {
    const { container } = render(
      <DonutChart
        total="Total"
        ariaLabel="x"
        segments={[
          { label: 'Besar', value: 100_000 },
          { label: 'Kecil', value: 1 },
          { label: 'Nol', value: 0 },
          { label: 'Minus', value: -50 },
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('<1%');
    expect(text).not.toContain('Nol');
    expect(text).not.toContain('Minus');
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('keeps two slices that share a name instead of dropping one', () => {
    const { container } = render(
      <DonutChart
        total="Total"
        ariaLabel="x"
        segments={[
          { label: 'Galon', value: 10 },
          { label: 'Galon', value: 5 },
        ]}
      />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('draws nothing at all when no slice has a value', () => {
    for (const segments of [[], [{ label: 'a', value: 0 }]]) {
      const { container } = render(<DonutChart total="Total" ariaLabel="x" segments={segments} />);
      expect(container.textContent).toBe('—');
      cleanup();
    }
  });
});

describe('who sees which tab', () => {
  it('opens something to every role that holds one of the widgets', () => {
    for (const role of [
      'SUPER_ADMIN',
      'HEAD_OFFICE',
      'DIREKTUR',
      'FINANCE',
      'MANAGER',
      'SUPERVISOR',
      'ASSISTANT_SUPERVISOR',
      'KEPALA_DEPOT',
    ]) {
      expect(canViewInsight(role), role).toBe(true);
    }
  });

  it('gives each role only the tabs it holds a widget capability for', () => {
    const ids = (role: string) => visibleTabs(role).map((t) => t.id);
    expect(ids('HEAD_OFFICE')).toEqual(['overview', 'sales', 'operations', 'customers', 'finance']);
    // Finance reads payments and the executive numbers; it has no customer or order-report access.
    expect(ids('FINANCE')).toEqual(['overview', 'sales', 'operations', 'finance']);
    // A depot head has the day's report, its stock and its own customers here, and nothing else.
    expect(ids('KEPALA_DEPOT')).toEqual(['operations', 'customers']);
    // Marketing reads loyalty, vouchers and churn: the customers tab only.
    expect(ids('MARKETING')).toEqual(['customers']);
  });

  it('opens nothing to the roles with no source behind it', () => {
    for (const role of [
      'STAFF_DEPOT',
      'FRANCHISE_OWNER',
      'CUSTOMER',
      null,
      undefined,
      'C_unknown',
    ]) {
      expect(canViewInsight(role), String(role)).toBe(false);
      expect(visibleTabs(role)).toEqual([]);
    }
  });

  it('falls back to the first tab the role may see when asked for one it may not', () => {
    expect(resolveTab('HEAD_OFFICE', 'nope')?.id).toBe('overview');
    expect(resolveTab('HEAD_OFFICE', '')?.id).toBe('overview');
    expect(resolveTab('STAFF_DEPOT', 'overview')).toBeNull();
    expect(resolveTab('KEPALA_DEPOT', 'overview')?.id).toBe('operations');
    expect(resolveTab('MARKETING', 'finance')?.id).toBe('customers');
  });

  it('has one i18n label key per tab, under insight.tabs', () => {
    for (const tab of INSIGHT_TABS) expect(tab.labelKey).toBe(`insight.tabs.${tab.id}`);
  });
});

describe('overviewSentence', () => {
  const up = (pct: number) => ({ kind: 'up' as const, pct });
  const down = (pct: number) => ({ kind: 'down' as const, pct });
  const none = { kind: 'none' as const };
  const flat = { kind: 'flat' as const, pct: 0 as const };

  it('says nothing when either number has no base to compare with', () => {
    expect(overviewSentence(none, up(5))).toBeNull();
    expect(overviewSentence(up(5), none)).toBeNull();
  });

  it('picks the sentence that is true of both movements', () => {
    expect(overviewSentence(up(10), up(25))?.key).toBe('insight.sentence.upBoth');
    expect(overviewSentence(up(10), down(5))?.key).toBe('insight.sentence.revenueUp');
    expect(overviewSentence(up(10), flat)?.key).toBe('insight.sentence.revenueUp');
    expect(overviewSentence(down(10), down(5))?.key).toBe('insight.sentence.downBoth');
    expect(overviewSentence(down(10), up(5))?.key).toBe('insight.sentence.revenueDown');
    expect(overviewSentence(flat, up(5))?.key).toBe('insight.sentence.flat');
  });

  it('carries the percentages with a comma, one decimal', () => {
    expect(overviewSentence(up(10), up(25))?.vars).toEqual({ revenue: '10,0', orders: '25,0' });
  });
});

describe('useInsightData', () => {
  function Probe({
    loader,
    enabled = true,
    dep = 1,
  }: {
    loader: () => Promise<string>;
    enabled?: boolean;
    dep?: number;
  }) {
    const r = useInsightData(loader, [dep], enabled);
    return (
      <p data-testid="out">
        {r.loading
          ? 'loading'
          : r.forbidden
            ? 'forbidden'
            : r.error
              ? `error:${r.error}`
              : `data:${r.data}`}
      </p>
    );
  }
  const out = () => screen.getByTestId('out').textContent;

  it('tells a refusal from a failure', async () => {
    const { ApiError } = await import('@/lib/api');
    const { rerender } = render(<Probe loader={() => Promise.reject(new ApiError(403, 'no'))} />);
    await waitFor(() => expect(out()).toBe('forbidden'));
    rerender(<Probe dep={2} loader={() => Promise.reject(new ApiError(500, 'boom'))} />);
    await waitFor(() => expect(out()).toBe('error:boom'));
  });

  it('makes no request while it is not wanted', async () => {
    const loader = vi.fn(() => Promise.resolve('x'));
    render(<Probe loader={loader} enabled={false} />);
    await waitFor(() => expect(out()).toBe('data:null'));
    expect(loader).not.toHaveBeenCalled();
  });

  it('drops an answer that arrives after its inputs changed', async () => {
    let releaseFirst: (v: string) => void = () => undefined;
    const first = new Promise<string>((r) => {
      releaseFirst = r;
    });
    const { rerender } = render(<Probe loader={() => first} dep={1} />);
    rerender(<Probe loader={() => Promise.resolve('second')} dep={2} />);
    await waitFor(() => expect(out()).toBe('data:second'));
    releaseFirst('first');
    await new Promise((r) => setTimeout(r, 10));
    expect(out()).toBe('data:second');
  });

  it('drops the old answer while the new one is on its way, instead of showing it as current', async () => {
    let release: (v: string) => void = () => undefined;
    const slow = new Promise<string>((r) => {
      release = r;
    });
    const { rerender } = render(<Probe loader={() => Promise.resolve('one')} dep={1} />);
    await waitFor(() => expect(out()).toBe('data:one'));
    rerender(<Probe loader={() => slow} dep={2} />);
    await waitFor(() => expect(out()).toBe('loading'));
    release('two');
    await waitFor(() => expect(out()).toBe('data:two'));
  });

  it('does not keep an old answer or error when it is switched off', async () => {
    const { rerender } = render(<Probe loader={() => Promise.resolve('x')} />);
    await waitFor(() => expect(out()).toBe('data:x'));
    rerender(<Probe loader={() => Promise.resolve('x')} enabled={false} />);
    await waitFor(() => expect(out()).toBe('data:null'));
  });
});

describe('HeatTable', () => {
  const props = {
    columns: ['0-1 hari', '2-3 hari'],
    rowHeader: 'Metode',
    totalLabel: 'Total',
    ariaLabel: 'umur',
    format: (n: number) => 'Rp ' + n,
  };

  it('puts the number in every cell, with a dash for nothing and a total per row', () => {
    const { container } = render(
      <HeatTable
        {...props}
        rows={[
          { label: 'QRIS', values: [300, 0] },
          { label: 'Tunai', values: [100, 50] },
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Rp 300');
    expect(text).toContain('Rp 150');
    // QRIS has nothing in the second column: a dash, not a faint zero.
    const qris = [...container.querySelectorAll('tbody tr')][0]!;
    expect(qris.querySelectorAll('td')[1]?.textContent).toBe('—');
    expect(qris.querySelectorAll('td')[2]?.textContent).toBe('Rp 300');
  });

  it('shades by size but never relies on shade: the biggest cell is shaded most, a zero not at all', () => {
    const { container } = render(
      <HeatTable
        {...props}
        rows={[
          { label: 'A', values: [1000, 0] },
          { label: 'B', values: [100, 0] },
        ]}
      />,
    );
    const cell = (r: number, c: number) =>
      container.querySelectorAll('tbody tr')[r]!.querySelectorAll('td')[c] as HTMLElement;
    expect(cell(0, 0).style.background).toContain('50%');
    expect(cell(1, 0).style.background).toContain('%');
    expect(cell(1, 0).style.background).not.toContain('50%');
    expect(cell(0, 1).style.background).toBe('');
  });

  it('survives having nothing at all', () => {
    const { container } = render(<HeatTable {...props} rows={[]} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('initials', () => {
  it('keeps at most two letters, so a review is not a name tag', () => {
    expect(initials('Budi Santoso')).toBe('B. S.');
    expect(initials('  siti   nur  aini ')).toBe('S. N.');
    expect(initials('Madonna')).toBe('M.');
    expect(initials('')).toBe('');
    expect(initials(null)).toBe('');
    expect(initials(undefined)).toBe('');
  });
});
