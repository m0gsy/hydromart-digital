// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DepotMap } from '@/components/dashboard/depot-map';
import type { DepotAdmin } from '@/lib/types';

vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

const depot = (id: string, code: string, city: string, lat: number, lng: number, active = true) =>
  ({ id, code, name: `Depot ${code}`, city, lat, lng, active }) as unknown as DepotAdmin;

const BKS1 = depot('1', 'BKS-01', 'Bekasi', -6.2349, 106.9896);
const BKS2 = depot('2', 'BKS-02', 'Bekasi', -6.2401, 107.0012, false);
const MLG = depot('3', 'MLG-01', 'Malang', -7.9666, 112.6326);

describe('DepotMap', () => {
  it('says so when no depot has coordinates', () => {
    render(<DepotMap depots={[{ ...BKS1, lat: NaN }]} onSelect={vi.fn()} />);
    expect(screen.getByText('hrFix.depotMap.empty')).toBeTruthy();
  });

  it('draws each far-apart depot as its own dot with its code, and selects it on click', () => {
    const onSelect = vi.fn();
    render(<DepotMap depots={[BKS1, MLG]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('MLG-01'));
    expect(onSelect).toHaveBeenCalledWith(MLG);
    expect(screen.getByText('BKS-01')).toBeTruthy();
  });

  it('merges close depots into one counted bubble named for their city', () => {
    render(<DepotMap depots={[BKS1, BKS2, MLG]} onSelect={vi.fn()} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Bekasi')).toBeTruthy();
    expect(screen.queryByText('BKS-01')).toBeNull();
  });

  it('names a bubble by its count when the depots span more than one city', () => {
    const near = depot('4', 'BKS-03', 'Jakarta Timur', -6.2351, 106.9899);
    render(<DepotMap depots={[BKS1, near, MLG]} onSelect={vi.fn()} />);
    expect(screen.getByText('hrFix.depotMap.count:{"n":2}')).toBeTruthy();
  });

  it('zooms into a bubble to pull its depots apart, and back out again', () => {
    const onSelect = vi.fn();
    render(<DepotMap depots={[BKS1, BKS2, MLG]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('2'));

    // Re-fitted to just the two Bekasi depots: both are dots with their own code now.
    expect(screen.getByText('BKS-01')).toBeTruthy();
    expect(screen.getByText('BKS-02')).toBeTruthy();
    expect(screen.queryByText('MLG-01')).toBeNull();
    fireEvent.click(screen.getByText('BKS-02'));
    expect(onSelect).toHaveBeenCalledWith(BKS2);

    fireEvent.click(screen.getByText('hrFix.depotMap.all'));
    expect(screen.getByText('MLG-01')).toBeTruthy();
    expect(screen.queryByText('hrFix.depotMap.all')).toBeNull();
  });

  it('lists depots that share a spot, since no zoom can pull them apart', () => {
    const onSelect = vi.fn();
    const a = depot('5', 'AAA', 'Bekasi', -6.2, 106.9);
    const b = depot('6', 'BBB', 'Bekasi', -6.2, 106.9);
    render(<DepotMap depots={[a, b, MLG]} onSelect={onSelect} />);
    expect(screen.queryByText('hrFix.depotMap.stacked:{"n":2}')).toBeNull();

    fireEvent.click(screen.getByText('2'));
    expect(screen.getByText('hrFix.depotMap.stacked:{"n":2}')).toBeTruthy();
    fireEvent.click(screen.getByText('Depot BBB'));
    expect(onSelect).toHaveBeenCalledWith(b);
  });

  it('keeps the zoom across a reload that swaps the depot objects', () => {
    const { rerender } = render(<DepotMap depots={[BKS1, BKS2, MLG]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('2'));
    rerender(<DepotMap depots={[{ ...BKS1 }, { ...BKS2 }, { ...MLG }]} onSelect={vi.fn()} />);
    expect(screen.getByText('BKS-01')).toBeTruthy();
    expect(screen.queryByText('MLG-01')).toBeNull();
  });

  it('falls back to the whole map when every zoomed depot has gone', () => {
    const { rerender } = render(<DepotMap depots={[BKS1, BKS2, MLG]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('2'));
    rerender(<DepotMap depots={[MLG]} onSelect={vi.fn()} />);
    expect(screen.getByText('MLG-01')).toBeTruthy();
    expect(screen.queryByText('hrFix.depotMap.all')).toBeNull();
  });
});
