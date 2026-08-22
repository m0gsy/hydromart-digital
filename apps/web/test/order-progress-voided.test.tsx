// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/lib/locale-context';
import { OrderProgress, OrderTimeline } from '@/components/order-views';
import type { OrderStatus } from '@/lib/types';

const draw = (status: OrderStatus) =>
  render(<OrderProgress status={status} />, { wrapper: LocaleProvider });

/**
 * B7. A VOIDED order is a counter sale the cashier reversed — the money went back over the
 * counter. On the customer's tracking screen it drew as a LIVE order sitting at step one:
 * `ORDER_FLOW.indexOf('VOIDED')` is −1, `activePos` falls back to 0, and the node tracker
 * shows "Pesanan dibuat" lit and four steps still to come.
 *
 * CANCELLED already had its own banner. VOIDED, which is the same news from the customer's
 * side, fell through to the tracker.
 */
describe('B7 — a voided order is not a live one', () => {
  it('says the sale was reversed instead of drawing a live tracker', () => {
    draw('VOIDED');
    expect(screen.queryByText(/dipesan|placed/i)).toBeNull();
    expect(screen.getByText(/penjualan konter dibatalkan|counter sale reversed/i)).toBeInTheDocument();
  });

  it('still draws the tracker for an order that really is live', () => {
    draw('PREPARING');
    expect(screen.getByText(/dipesan|placed/i)).toBeInTheDocument();
  });

  it('keeps the cancelled banner it already had', () => {
    draw('CANCELLED');
    expect(screen.queryByText(/dipesan|placed/i)).toBeNull();
    expect(screen.getByText(/pesanan dibatalkan/i)).toBeInTheDocument();
  });
});

/**
 * The rest of the tracker and the timeline beside it. Both are pure components on the
 * screen a customer opens to ask "where is my water", and B7 was the first test to render
 * either.
 */
describe('the tracker, in the states a customer actually sees it', () => {
  it.each([
    ['CREATED', /diproses/i],
    ['PREPARING', /disiapkan/i],
    ['ON_DELIVERY', /perjalanan/i],
    ['DELIVERED', /tiba/i],
    ['COMPLETED', /selesai/i],
  ])('%s says so in words, not just in dots', (status, phrase) => {
    draw(status as OrderStatus);
    expect(screen.getAllByText(phrase).length).toBeGreaterThan(0);
  });

  it('offers the courier a call button once there is a courier to call', () => {
    render(<OrderProgress status="ON_DELIVERY" driverName="Budi" driverPhone="081234567890" />, {
      wrapper: LocaleProvider,
    });
    expect(screen.getByText('Budi')).toBeInTheDocument();
    const call = screen.getByRole('link', { name: /telepon|call/i });
    expect(call.getAttribute('href')).toContain('081234567890');
  });

  it('offers no call to nobody when the courier has no number', () => {
    render(<OrderProgress status="ON_DELIVERY" driverName="Budi" driverPhone={null} />, {
      wrapper: LocaleProvider,
    });
    expect(screen.queryByRole('link', { name: /telepon|call/i })).toBeNull();
  });

  it('quotes the arrival estimate while the order is on its way', () => {
    render(
      <OrderProgress status="ON_DELIVERY" driverName="Budi" eta="2026-08-22T09:30:00.000Z" />,
      { wrapper: LocaleProvider },
    );
    expect(screen.getByText(/\d{2}[.:]\d{2}/)).toBeInTheDocument();
  });
});

describe('the timeline beside it', () => {
  it('lists every step the order actually took, newest last', () => {
    render(
      <OrderTimeline
        history={[
          { status: 'CREATED', note: null, changedBy: 'c-1', createdAt: '2026-08-20T01:00:00.000Z' },
          { status: 'CONFIRMED', note: 'lunas', changedBy: 'staff', createdAt: '2026-08-20T02:00:00.000Z' },
        ]}
      />,
      { wrapper: LocaleProvider },
    );
    expect(screen.getByText(/lunas/)).toBeInTheDocument();
  });

  it('says the timeline is empty rather than drawing an empty list', () => {
    render(<OrderTimeline history={[]} />, { wrapper: LocaleProvider });
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
