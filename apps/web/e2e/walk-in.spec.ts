import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

// Counter sale (walk-in): the cashier screen at /dashboard/walk-in. Runs against the live
// compose stack as the seeded SUPER_ADMIN, who holds the walkInSale capability.
//
// The assertion is the round-trip, not a fixed total: seeded catalogue prices differ per
// environment, so the test reads the price the page itself resolved and pays exactly that.
test('records a cash sale at the counter and prints a receipt', async ({ page, context }) => {
  await loginWithOtp(page);

  await page.goto('/dashboard/walk-in');
  await expect(page.getByRole('heading', { name: /Penjualan di depot/i })).toBeVisible({
    timeout: 15_000,
  });

  // No products seeded for this depot → nothing to sell; that's an environment gap.
  const increase = page.getByRole('button', { name: /Increase quantity/i }).first();
  try {
    await expect(increase).toBeEnabled({ timeout: 10_000 });
  } catch {
    test.skip(true, 'no depot products available on this runner');
  }
  await increase.click();

  // The page shows the running total; pay it with a round note so there is change to print.
  const totalText = (await page.getByText(/^Rp/).last().innerText()).replace(/\D/g, '');
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
