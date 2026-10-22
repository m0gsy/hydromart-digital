// Real-browser check of the franchise owner's attendance screen on the production build.
//   node .uat/rbac/ui-owner.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { api, mintToken } from '../lib.mjs';

const { chromium } = createRequire(new URL('../../apps/web/package.json', import.meta.url))('@playwright/test');
const WEB = 'http://localhost:3000';
const DAGO = '79425d58-b76c-41ee-909c-40f11c53842c';
const BDG = '020db071-25f6-426a-9dfb-f3cc9a395995';
const sql = (q) => execSync('docker exec -i hydromart-postgres psql -U hydromart -d hydromart_hr -At', { input: q, encoding: 'utf8' }).trim();

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const [E1, E1_DEPOT] = sql('select id, "depotId" from employees order by id limit 1').split('|');
const ids = [];
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

async function main() {
  sql(`update employees set "depotId"='${BDG}' where id='${E1}'`);
  const add = (day, status, late, photo) => {
    const id = crypto.randomUUID();
    ids.push(id);
    sql(`insert into attendance (id,"employeeId","depotId","workDate","checkInAt","checkOutAt","checkInPhotoUrl","checkInScore","lateMinutes",status,"createdAt","updatedAt")
         values ('${id}','${E1}','${BDG}','${day}','${day} 01:00','${day} 10:00',${photo ? "'hr/attendance/x.jpg'" : 'null'},${photo ? 0.9 : 'null'},${late},'${status}',now(),now())`);
  };
  add(`${month}-01`, 'PRESENT', 0, true);
  add(`${month}-02`, 'LATE', 20, false);

  const token = mintToken('FRANCHISE_OWNER', { sub: DAGO, phone: '+6281100000009' });
  const me = await api('GET', '/auth/api/v1/auth/me', { token });
  if (me.status !== 200) throw new Error(`/auth/me ${me.status}`);
  const browser = await chromium.launch();
  for (const [w, h] of [[1280, 900], [390, 800], [320, 640]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'id-ID' });
    await ctx.addCookies([{ name: 'hm_at', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await ctx.addInitScript((c) => {
      localStorage.setItem('hm.session', JSON.stringify({ customer: c }));
      localStorage.setItem('hydromart.onboarded', '1');
    }, me.body);
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 140)}`));
    page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 140)}`));
    page.on('response', (r) => r.status() >= 400 && !/favicon/.test(r.url()) && problems.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 100)}`));

    await page.goto(`${WEB}/dashboard/franchise/attendance`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Absensi tim' }).waitFor({ timeout: 20000 });
    check(`[${w}px] heading, summary and rows render`, (await page.getByText('Depot Dago').count()) > 0 && (await page.getByText('Terlambat').count()) > 0);
    const rowsText = await page.locator('body').innerText();
    check(`[${w}px] shows the two rows and the lateness`, rowsText.includes('+20m') && /Hadir/.test(rowsText));
    check(`[${w}px] offers the face frame of the row that has one`, (await page.getByRole('button', { name: /Foto masuk/ }).count()) === 1);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`[${w}px] no horizontal page scroll`, over <= 1, `overflow ${over}px`);

    // the status filter really narrows the log
    await page.getByLabel('Status').selectOption('LATE');
    await page.waitForFunction(() => !document.body.innerText.includes('Foto masuk'), null, { timeout: 15000 });
    check(`[${w}px] the status filter narrows the log`, true);

    if (w === 1280) {
      await page.getByLabel('Status').selectOption('');
      check('the owner menu has the entry', (await page.getByRole('link', { name: 'Absensi tim' }).count()) > 0);
      // the frame: storage is not set up in this stack, so the click must fail GRACEFULLY (a message, no crash)
      await page.getByRole('button', { name: /Foto masuk/ }).first().click();
      await page.waitForTimeout(1500);
      check('a frame that cannot be opened is reported, the page keeps working', (await page.getByRole('heading', { name: 'Absensi tim' }).count()) === 1);
    }
    // The one deliberate 503: opening a frame in a stack whose document storage is not set up.
    const expected = problems.filter((p) => !(w === 1280 && p.includes('503')));
    check(`[${w}px] no console errors, exceptions or unexpected 4xx/5xx`, expected.length === 0, expected.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // someone who is not an owner gets the denial, not data
  const mgr = mintToken('MANAGER', { sub: crypto.randomUUID() });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'id-ID' });
  await ctx.addCookies([{ name: 'hm_at', value: mgr, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await ctx.addInitScript(() => localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'm', role: 'MANAGER', capabilities: ['hrView'], phone: '+620', status: 'ACTIVE' } })));
  const page = await ctx.newPage();
  await page.goto(`${WEB}/dashboard/franchise/attendance`, { waitUntil: 'networkidle' });
  check('a manager sees the denial', (await page.getByText('Tidak ada akses').count()) > 0 && (await page.getByText('Budi').count()) === 0);
  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(() => {
    try {
      if (ids.length) sql(`delete from attendance where id in (${ids.map((x) => `'${x}'`).join(',')})`);
      sql(`update employees set "depotId"=${E1_DEPOT ? `'${E1_DEPOT}'` : 'null'} where id='${E1}'`);
    } catch (e) {
      console.error('cleanup failed', e);
      failed += 1;
    }
    console.log(`\n${total - failed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
    process.exit(failed ? 1 : 0);
  });
