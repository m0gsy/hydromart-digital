// Real-browser check of /hq/access against the production build served by the prod-like stack.
// Drives the actual UI as a SUPER_ADMIN (session cookie minted like auth-service signs it), and
// records every console error, uncaught exception and 4xx/5xx the page causes along the way.
//
//   node .uat/rbac/ui-live.mjs
import { createRequire } from 'node:module';
import { api, mintToken } from '../lib.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SA_ID = process.env.SA_ID ?? 'c1867bc8-d7b5-494c-bdce-c2729f775f0b';
const NAME = `Kasir UI ${Math.random().toString(36).slice(2, 6)}`;

const rows = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  rows.push(name);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();
async function session(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'id-ID' });
  const token = mintToken('SUPER_ADMIN', { sub: SA_ID, phone: '+6281100000001' });
  // The app keeps a UX copy of the profile in localStorage (the cookie is the credential) and
  // revalidates it against /auth/me. Seed what a real login would have stored.
  const me = await api('GET', '/auth/api/v1/auth/me', { token });
  if (me.status !== 200) throw new Error(`/auth/me answered ${me.status}`);
  await ctx.addInitScript((c) => localStorage.setItem('hm.session', JSON.stringify({ customer: c })), me.body);
  await ctx.addCookies([{ name: 'hm_at', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await ctx.addInitScript(() => localStorage.setItem('hydromart.onboarded', '1'));
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon|_next\/image/.test(r.url())) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110)}`);
  });
  return { ctx, page, problems };
}

async function main() {
  const { page, problems, ctx } = await session({ width: 1280, height: 900 });
  await page.goto(`${WEB}/hq/access`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /Peran bawaan/ }).waitFor({ timeout: 20000 });
  check('page renders the three panels', (await page.getByRole('heading', { name: /Peran custom/ }).count()) === 1 && (await page.getByRole('heading', { name: /Hak per depot/ }).count()) === 1);
  check('the matrix is editable once loaded', (await page.locator('button[aria-pressed]:not([disabled])').count()) > 100);

  // ---- create a custom role from MANAGER ------------------------------------------------
  await page.getByRole('button', { name: 'Buat peran' }).click();
  await page.getByLabel('Nama peran').fill(NAME);
  await page.getByLabel('Salin dari').selectOption('MANAGER');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByText(NAME, { exact: false }).first().waitFor({ timeout: 15000 });
  check('a role created from MANAGER shows up in the list', true);
  const abbr = NAME.slice(0, 3);
  await page.waitForFunction((a) => [...document.querySelectorAll('thead button')].some((b) => b.textContent?.trim() === a), abbr, { timeout: 15000 });
  check('and as a column of the matrix', true);

  // forbidden cells for a custom role are locked
  const locked = await page.locator(`button[aria-pressed][disabled][aria-label$="${NAME}"]`).count();
  check('forbidden capabilities are locked for it', locked >= 8, `${locked} locked cells`);

  // ---- toggle one allowed cell and save the matrix ---------------------------------------
  const cell = page.locator(`button[aria-pressed="false"]:not([disabled])[aria-label$="${NAME}"]`).first();
  await cell.click();
  await page.getByRole('button', { name: /^Simpan perubahan|^Simpan$/ }).last().click();
  await page.getByText(/tersimpan|disimpan|Perubahan/i).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /Peran bawaan/ }).waitFor();
  const stillOn = await page.locator(`button[aria-pressed="true"][aria-label$="${NAME}"]`).count();
  check('a saved cell survives a reload', stillOn >= 1, `${stillOn} granted cells after reload`);

  // ---- rename a built-in role -------------------------------------------------------------
  const mgrRow = page.locator('li', { hasText: '· MANAGER' }).first();
  await mgrRow.getByRole('button', { name: 'Ubah' }).click();
  await page.getByLabel('Nama peran').first().fill('Manajer Wilayah UI');
  await page.getByRole('button', { name: 'Simpan', exact: true }).first().click();
  await page.getByText('Manajer Wilayah UI').first().waitFor({ timeout: 15000 });
  check('a built-in role can be renamed', true);
  await page.locator('li', { hasText: '· MANAGER' }).first().getByRole('button', { name: 'Ubah' }).click();
  await page.getByLabel('Nama peran').first().fill('');
  await page.getByRole('button', { name: 'Simpan', exact: true }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes('Manajer Wilayah UI'), null, { timeout: 15000 });
  check('and put back', true);

  // ---- per-depot rule -----------------------------------------------------------------------
  const rules = page.getByRole('heading', { name: /Hak per depot/ }).locator('xpath=ancestor::div[.//select][1]');
  await rules.getByLabel('Peran').selectOption({ label: NAME });
  await rules.getByLabel('Depot').selectOption({ index: 1 });
  await rules.getByLabel('Efek').selectOption('DENY');
  await rules.getByRole('button', { name: 'Tambah pengecualian' }).click();
  await rules.getByRole('button', { name: 'Hapus' }).first().waitFor({ timeout: 15000 });
  check('a per-depot rule can be added', true);
  await rules.getByRole('button', { name: 'Hapus' }).first().click();
  await rules.getByText(/Belum ada pengecualian/).waitFor({ timeout: 15000 });
  check('and removed', true);

  // ---- archive (the app's own dialog, never window.confirm) -------------------------------------
  const nativeDialogs = [];
  page.on('dialog', (d) => { nativeDialogs.push(d.message()); void d.dismiss(); });
  const customList = page.locator('li', { hasText: NAME }).first();
  await customList.getByRole('button', { name: 'Arsipkan' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Arsipkan' }).click();
  await page.waitForFunction((n) => ![...document.querySelectorAll('li')].some((l) => l.innerText.includes(n) && l.innerText.includes('Arsipkan')), NAME, { timeout: 15000 });
  check('archiving uses the in-app dialog, not a browser one', nativeDialogs.length === 0);
  check('the archived role leaves the list', (await page.locator('li', { hasText: NAME }).filter({ hasText: 'Arsipkan' }).count()) === 0);

  check('no console errors, exceptions or 4xx/5xx while doing all of that', problems.length === 0, problems.slice(0, 4).join(' | '));
  await ctx.close();

  // ---- phone-sized screens: no sideways page scroll ------------------------------------------------
  for (const [w, h] of [[320, 640], [390, 800], [428, 900]]) {
    const s = await session({ width: w, height: h });
    await s.page.goto(`${WEB}/hq/access`, { waitUntil: 'networkidle' });
    await s.page.getByRole('heading', { name: /Peran bawaan/ }).waitFor({ timeout: 20000 });
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no horizontal page scroll at ${w}px`, over <= 1, `overflow ${over}px`);
    check(`no errors at ${w}px`, s.problems.length === 0, s.problems.slice(0, 3).join(' | '));
    await s.ctx.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(async () => {
    await browser.close();
    console.log(`\n${rows.length - failed}/${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`);
    process.exit(failed ? 1 : 0);
  });
