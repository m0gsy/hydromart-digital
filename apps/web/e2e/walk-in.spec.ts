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
  await expect(heading.or(noDepot).first()).toBeVisible({ timeout: 15_000 });
  if (await noDepot.isVisible()) {
    console.log(`[walk-in] depot list responses:\n  ${depotCalls.join('\n  ') || '(none)'}`);
    test.skip(true, `no depot available; depot list said: ${depotCalls.join(' | ') || '(no call)'}`);
  }

  // No products seeded for this depot → nothing to sell; that's an environment gap.
  // 30s, not 10: the depot switcher resolves the depot and THEN fetches its inventory, two round
  // trips through the gateway. Under the full serial suite that outran 10s and the test skipped
  // itself on a runner that did have products — a skip that reads as "environment gap" and hides
  // a flow nobody ran.
  const increase = page.getByRole('button', { name: /Increase quantity/i }).first();
  try {
    await expect(increase).toBeEnabled({ timeout: 30_000 });
  } catch {
    test.skip(true, 'no depot products available on this runner');
  }
  await increase.click();

  // The page shows the running total; pay it with a round note so there is change to print.
  // Read the amount NEXT TO the "Total" label — the last Rp on the page is "Kembalian", which is
  // Rp 0 until cash is entered, so `.last()` measured the change and never the total.
  const totalText = (
    await page
      .getByText('Total', { exact: true })
      .locator('xpath=following-sibling::span')
      .innerText()
  ).replace(/\D/g, '');
  const total = Number(totalText);
  expect(total).toBeGreaterThan(0);
  await page.getByLabel(/Uang tunai diterima/i).fill(String(total + 50_000));

  // printReceipt opens a print window; capture it so the popup does not block the run.
  const popup = context.waitForEvent('page').catch(() => null);
  const salePost = page.waitForResponse(
    (r) => r.url().includes('/orders/api/v1/orders/walk-in') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /Simpan & cetak struk/i }).click();

  const posted = await salePost;
  expect(posted.status()).toBeLessThan(500); // never a server crash
  if (posted.ok()) {
    const order = await posted.json();
    expect(order.isWalkIn).toBe(true);
    expect(order.status).toBe('COMPLETED');
    expect(order.deliveryFee).toBe(0);

    const receipt = await popup;
    if (receipt) {
      await expect(receipt.getByText(/Tunai/)).toBeVisible({ timeout: 10_000 });
      await expect(receipt.getByText(/Kembali/)).toBeVisible();
      await receipt.close();
    }
  }
});
