// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RefillSplit } from '@/components/dashboard/refill-split';
import type { DepotRefillSplit } from '@/lib/types';

vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}|${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

const split = (over: Partial<DepotRefillSplit> = {}): DepotRefillSplit => ({
  refill: 0,
  partial: 0,
  beli: 0,
  notAsked: 0,
  ...over,
});

describe('RefillSplit', () => {
  it('renders nothing when no counter sale had a galon to classify', () => {
    const { container } = render(<RefillSplit split={split()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the only figure is notAsked — there is no mix to report', () => {
    const { container } = render(<RefillSplit split={split({ notAsked: 4 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the three counted buckets', () => {
    const { container } = render(<RefillSplit split={split({ refill: 5, partial: 2, beli: 3 })} />);
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('opsFix.reports.refillSplitTitle');
  });

  it('names how many sales were never asked, only when there are any', () => {
    const asked = render(<RefillSplit split={split({ refill: 1, notAsked: 0 })} />);
    expect(asked.container.textContent).not.toContain('refillNotAsked');

    const notAsked = render(<RefillSplit split={split({ refill: 1, notAsked: 3 })} />);
    expect(notAsked.container.textContent).toContain('opsFix.reports.refillNotAsked|{"n":3}');
  });
});
