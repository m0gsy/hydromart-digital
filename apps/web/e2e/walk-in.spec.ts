import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

// Counter sale (walk-in): the cashier screen at /dashboard/walk-in. Runs against the live
// compose stack as the seeded SUPER_ADMIN, who holds the walkInSale capability.
//
// The assertion is the round-trip, not a fixed total: seeded catalogue prices differ per
// environment, so the test reads the price the page itself resolved and pays exactly that.
test('records a cash sale at the counter and prints a receipt', async ({ page, context }) => {
  await loginWithOtp(page);

  // What the depot list actually answered, so "no depot" can never be reported without the
  // response that caused it. Run inside the full suite this skipped while passing on its own,
  // and a skip with no evidence is indistinguishable from a green run.
  const depotCalls: string[] = [];
  page.on('response', async (res) => {
    if (!/\/depots(\?|$)/.test(new URL(res.url()).pathname + (res.url().includes('?') ? '?' : '')))
      return;
    let count: number | string = '?';
    try {
      const body = (await res.json()) as { items?: unknown[] } | unknown[];
      count = Array.isArray(body) ? body.length : (body.items?.length ?? '?');
    } catch {
      count = 'unparseable';
    }
    depotCalls.push(`${res.request().method()} ${res.status()} n=${count} ${res.url()}`);
  });

  await page.goto('/dashboard/walk-in');

  // The screen needs a depot: the operator's own, or the switcher's for roles that are not
  // depot-locked. The seeded admin has no assigned depot, so on a runner whose depot
  // directory comes back empty the console renders its "no depot" state and there is
  // nothing to sell — an environment gap, not a product defect.
  const heading = page.getByRole('heading', { name: /Penjualan di depot/i });
  const noDepot = page.getByRole('heading', { name: /Belum ada depot/i });
  // The depot list can also fail outright — the console renders its error state, a THIRD
  // heading. Matching only the first two turned a gateway 429 into "element(s) not found",
  // which named nothing. Match it too, and fail with what the depot list actually answered.
  const depotFailed = page.getByRole('heading', {
    name: /Ada yang tidak beres|Something went wrong/i,
  });
  await expect(heading.or(noDepot).or(depotFailed).first()).toBeVisible({ timeout: 15_000 });
  if (await depotFailed.isVisible()) {
    throw new Error(
      `the depot list failed to load, so the counter never rendered. Responses:\n  ${
        depotCalls.join('\n  ') || '(no depot call was made)'
      }`,
    );
  }
  /*
   * This used to `test.skip`, and a skip reports GREEN.
   *
   * The counter sale is the only end-to-end ops flow CI runs at all, and it was allowed to
   * quietly not run whenever the depot list came back empty — which is the single most
   * likely way for the seed to regress. A suite that goes green by not testing anything is
   * worse than one that goes red: it answers the question "is the till covered?" with yes.
   *
   * `scripts/seed.mjs` creates depots before this suite, so an empty list is a broken
   * environment and CI should say so, naming what the depot call actually answered.
   */
  if (await noDepot.isVisible()) {
    throw new Error(
      `the depot list came back empty, so the counter never rendered and this flow did not run. ` +
        `Seed a depot (scripts/seed.mjs) before the suite. Responses:\n  ${
          depotCalls.join('\n  ') || '(no depot call was made)'
        }`,
    );
  }

  // No shift, no sale — the server refuses the counter outright. Opening one is part of the
  // flow now, so the test walks it rather than seeding around it.
  const openShift = page.getByRole('button', { name: /Buka shift/i });
  const shiftOpen = page.getByText(/Shift terbuka/i);
  /*
   * Decide only once the counter has SETTLED into one of its two states.
   *
   * `isVisible()` is a snapshot. Taken while the shift query is still in flight it answers
   * false, the open-shift block is skipped, and the sale then goes out with no shift behind
   * it — which is the 422 this test failed on:
   *
   *   ORDER_NO_OPEN_SHIFT — "Buka shift kasir dulu sebelum mencatat penjualan di konter."
   *
   * Waiting for either state first removes the coin flip. It does not prove this was the
   * only race here, which is why the sale failure below now names the depot on both legs.
   */
  await expect(openShift.or(shiftOpen).first()).toBeVisible({ timeout: 30_000 });
  let shiftDepot = '(shift was already open; this run did not open it)';
  if (await openShift.isVisible().catch(() => false)) {
    await page.getByLabel(/Uang kembalian awal/i).fill('200000');
    const opened = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/depots/api/v1/cashier-shifts') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await openShift.click();
    const shiftRes = await opened;
    // The depot the shift was actually opened FOR, read off the request this run made —
    // not guessed from client storage, which carries no depot at all.
    try {
      shiftDepot =
        (JSON.parse(shiftRes.request().postData() ?? '{}') as { depotId?: string }).depotId ??
        '(no depotId in the open-shift body)';
    } catch {
      shiftDepot = '(unparseable open-shift body)';
    }
    expect(shiftRes.ok(), `opening a shift answered ${shiftRes.status()}: ${await shiftRes.text()}`).toBe(
      true,
    );
  }
  await expect(page.getByText(/Shift terbuka/i)).toBeVisible({ timeout: 15_000 });

  // No products seeded for this depot → nothing to sell; that's an environment gap.
  // 30s, not 10: the depot switcher resolves the depot and THEN fetches its inventory, two round
  // trips through the gateway. Under the full serial suite that outran 10s and the test skipped
  // itself on a runner that did have products — a skip that reads as "environment gap" and hides
  // a flow nobody ran.
  // Also a failure rather than a skip now, and for the same reason as the depot check
  // above — with the added evidence that this one had ALREADY fired falsely once, on a
  // runner that did have products (see the timeout note). A skip that can be produced by a
  // slow round trip is not reporting an environment gap, it is hiding a flake.
  const increase = page.getByRole('button', { name: /Increase quantity/i }).first();
  await expect(
    increase,
    'no sellable product at this depot, so the counter sale never ran — seed depot inventory before the suite',
  ).toBeEnabled({ timeout: 30_000 });
  // C12: the total is no longer arithmetic this page does — it is a server quote, and the
  // quote is a round trip. Waiting for it is not a timing patch: it asserts the counter
  // screen actually prices from the server, which is the whole point of the change. Before
  // it lands the screen shows a placeholder, so reading immediately measured nothing.
  const quoted = page.waitForResponse(
    (r) =>
      r.url().includes('/orders/api/v1/orders/walk-in/quote') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await increase.click();
  await quoted;

  // The page shows the running total; pay it with a round note so there is change to print.
  // Read the amount NEXT TO the "Total" label — the last Rp on the page is "Kembalian", which is
  // Rp 0 until cash is entered, so `.last()` measured the change and never the total.
  const totalSpan = page
    .getByText('Total', { exact: true })
    .locator('xpath=following-sibling::span');
  // Poll rather than read once: the response landing and React painting it are two events.
  await expect(totalSpan).toHaveText(/\d/, { timeout: 20_000 });
  const totalText = (await totalSpan.innerText()).replace(/\D/g, '');
  const total = Number(totalText);
  expect(total).toBeGreaterThan(0);
  await page.getByLabel(/Uang tunai diterima/i).fill(String(total + 50_000));

  // printReceipt opens a print window; capture it so the popup does not block the run.
  const popup = context.waitForEvent('page').catch(() => null);
  const salePost = page.waitForResponse(
    (r) => r.url().includes('/orders/api/v1/orders/walk-in') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  // The sale is only half the flow: the money leg has to settle too. Asserting the confirm
  // response is how this test proves it, without hand-rolling an authenticated API call —
  // the run used to pass with the payment left PENDING and nobody the wiser.
  const paymentConfirm = page.waitForResponse(
    (r) =>
      /\/payments\/api\/v1\/payments\/[^/]+\/confirm$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /Simpan & cetak struk/i }).click();

  // Anything other than 2xx here is a defect, not an environment gap: the depot, its stock
  // and the price were all read from this same running stack moments ago.
  const posted = await salePost;
  // Name BOTH depots on failure. A shift opened for one depot and a sale posted against
  // another looks exactly like "no shift is open", and the 422 alone cannot tell the two
  // apart — so the next occurrence of this says which it was instead of needing a guess.
  const saleDepot = (() => {
    try {
      return (JSON.parse(posted.request().postData() ?? '{}') as { depotId?: string }).depotId ?? '(none)';
    } catch {
      return '(unparseable body)';
    }
  })();
  expect(
    posted.ok(),
    `walk-in POST answered ${posted.status()}: ${await posted.text()}
` +
      `  shift was opened with depot=${shiftDepot}
` +
      `  sale was posted with depot=${saleDepot}`,
  ).toBe(true);
  const order = await posted.json();
  expect(order.isWalkIn).toBe(true);
  expect(order.status).toBe('COMPLETED');
  expect(order.deliveryFee).toBe(0);

  const confirmed = await paymentConfirm;
  expect(
    confirmed.ok(),
    `payment confirm answered ${confirmed.status()}: ${await confirmed.text()}`,
  ).toBe(true);
  const payment = await confirmed.json();
  expect(payment.status).toBe('PAID');
  expect(payment.method).toBe('CASH');
  // The change printed on the struk has to be the change recorded on the payment.
  expect(payment.cashReceived).toBe(total + 50_000);
  expect(payment.changeGiven).toBe(50_000);

  const receipt = await popup;
  expect(receipt, 'the receipt window never opened').not.toBeNull();
  await expect(receipt!.getByText(/Tunai/)).toBeVisible({ timeout: 10_000 });
  await expect(receipt!.getByText(/Kembali/)).toBeVisible();
  await receipt!.close();

  // Undo the sale, then close on the float alone. This is the whole reversal proved by its
  // effect on the money: if the refund had not landed, the drawer would still expect it and
  // the close below would report a shortfall instead of balancing.
  await page.getByRole('button', { name: /Batalkan penjualan/i }).click();
  await page.getByLabel(/Alasan/i).fill('E2E: pembeli batal');
  const voided = page.waitForResponse(
    (r) => /\/orders\/api\/v1\/orders\/walk-in\/[^/]+\/void$/.test(new URL(r.url()).pathname),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /Ya, batalkan/i }).click();
  const voidRes = await voided;
  expect(voidRes.ok(), `void answered ${voidRes.status()}: ${await voidRes.text()}`).toBe(true);
  expect((await voidRes.json()).status).toBe('VOIDED');

  // The expected total is computed server-side from the payments themselves. With the sale
  // reversed the drawer is back to its float, so counting exactly that must balance — and
  // it only can if the refund really settled. A stale PAID payment would show up here as a
  // shortfall the size of the sale.
  await page.getByRole('button', { name: /Tutup shift/i }).click();
  await page.getByLabel(/Uang tunai dihitung/i).fill('200000');
  const closed = page.waitForResponse(
    (r) => /\/cashier-shifts\/[^/]+\/close$/.test(new URL(r.url()).pathname),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /Tutup & hitung selisih/i }).click();
  const closeRes = await closed;
  expect(closeRes.ok(), `closing the shift answered ${closeRes.status()}: ${await closeRes.text()}`).toBe(
    true,
  );
  const shift = await closeRes.json();
  expect(shift.status).toBe('CLOSED');
  expect(shift.expectedCash).toBe(200_000);
  expect(shift.variance).toBe(0);
});
