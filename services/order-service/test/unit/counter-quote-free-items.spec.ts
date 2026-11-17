import { CounterQuoteResponseDto } from '../../src/modules/dto/order.dto';

/*
 * A buy-X-get-Y unit and a bundle gift both leave the depot and both come out of stock, but
 * the till only ever showed "gratis senilai Rp X" — never what to hand over. The quote now
 * names them per product, so the cashier sees "+1 Galon · gratis" and can count it.
 */
describe('CounterQuoteResponseDto.freeItems', () => {
  const base = {
    subtotal: 32000,
    discount: 0,
    total: 32000,
    agen: false,
    catalogFallback: null,
    shippingFee: 0,
    appliedPromos: [],
    firstOrder: false,
    firstOrderCapped: false,
  };

  it('lists the price-0 rows and the gifts, summed per product', () => {
    const dto = CounterQuoteResponseDto.from({
      ...base,
      items: [
        { productId: 'galon', unitPrice: 8000, quantity: 4 },
        { productId: 'galon', unitPrice: 0, quantity: 1 },
      ],
      promoGifts: { items: [{ productId: 'tutup', quantity: 2 }, { productId: 'galon', quantity: 1 }] },
    });

    expect(dto.freeItems).toEqual([
      { productId: 'galon', quantity: 2 },
      { productId: 'tutup', quantity: 2 },
    ]);
  });

  it('is empty when nothing is given away', () => {
    const dto = CounterQuoteResponseDto.from({
      ...base,
      items: [{ productId: 'galon', unitPrice: 8000, quantity: 4 }],
      promoGifts: { items: [] },
    });

    expect(dto.freeItems).toEqual([]);
  });
});
