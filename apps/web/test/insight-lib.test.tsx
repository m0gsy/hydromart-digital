// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GaugeChart, MultiLine } from '@/components/hq/charts';
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

describe('who sees which tab', () => {
  it('opens the overview to every role that holds one of its widgets', () => {
    for (const role of [
      'SUPER_ADMIN',
      'HEAD_OFFICE',
      'DIREKTUR',
      'FINANCE',
      'MANAGER',
      'SUPERVISOR',
      'ASSISTANT_SUPERVISOR',
    ]) {
      expect(canViewInsight(role), role).toBe(true);
    }
  });

  it('opens nothing to the roles with no source behind it', () => {
    for (const role of [
      'KEPALA_DEPOT',
      'STAFF_DEPOT',
      'MARKETING',
      'HR',
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
    expect(resolveTab('KEPALA_DEPOT', 'overview')).toBeNull();
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

  it('does not keep an old answer or error when it is switched off', async () => {
    const { rerender } = render(<Probe loader={() => Promise.resolve('x')} />);
    await waitFor(() => expect(out()).toBe('data:x'));
    rerender(<Probe loader={() => Promise.resolve('x')} enabled={false} />);
    await waitFor(() => expect(out()).toBe('data:null'));
  });
});
