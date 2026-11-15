/**
 * Browser integration tests for the main user workflows.
 *
 *   npm run build && npm run preview &      # serves the production build on :4173
 *   npm run e2e                             # or: BASE=https://your-site node tests/e2e/run.cjs --live
 *
 * By default every /api/* call is answered with small synthetic fixtures (clearly fake tickers),
 * so the tests are deterministic and need no network. Pass --live to hit the real data service.
 * Needs the `playwright` package and a Chromium browser.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const LIVE = process.argv.includes('--live');
const results = [];
let failures = 0;

/* ---------- synthetic market data (fixtures) ---------- */
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const series = (start, drift, wobble, n = 520) => {
  const t = [];
  const c = [];
  let p = start;
  for (let i = n; i >= 0; i--) {
    const ts = now - i * DAY;
    const d = new Date(ts * 1000).getUTCDay();
    if (d === 0 || d === 6) continue;
    p *= 1 + drift + wobble * Math.sin(i * 0.7);
    t.push(ts);
    c.push(Number(p.toFixed(2)));
  }
  return { t, c };
};
const FIX = {
  'TESTCO.NS': { name: 'Test Company Limited', ...series(80, 0.0008, 0.01) },
  'DEMOBANK.NS': { name: 'Demo Bank Limited', ...series(400, 0.0004, 0.008) },
  '^NSEI': { name: 'NIFTY 50', ...series(20000, 0.0003, 0.005), type: 'INDEX' },
};
const priceOf = (s) => (s === 'TESTCO.NS' ? 120 : s === 'DEMOBANK.NS' ? 500 : 25000);
const chartOf = (symbol) => {
  const f = FIX[symbol];
  if (!f) return null;
  const c = [...f.c];
  c[c.length - 1] = priceOf(symbol);
  return { symbol, name: f.name, currency: 'INR', exchange: 'NSE', type: f.type || 'EQUITY', tz: 'Asia/Kolkata', gmtoffset: 19800, price: priceOf(symbol), prevClose: c[c.length - 2], dayHigh: null, dayLow: null, high52: Math.max(...c), low52: Math.min(...c), volume: 1000, marketTime: f.t[f.t.length - 1], firstTrade: f.t[0], interval: '1d', t: f.t, c, adj: c, v: c.map(() => 1000), div: [], split: [] };
};
const quoteOf = (symbol) => {
  const ch = chartOf(symbol);
  if (!ch) return null;
  return { symbol, shortName: ch.name, longName: ch.name, quoteType: ch.type, currency: 'INR', exchange: 'NSI', regularMarketPrice: ch.price, regularMarketPreviousClose: ch.price / 1.01, regularMarketChangePercent: 1, regularMarketTime: now, marketCap: 5e11, trailingPE: 20, priceToBook: 3, fiftyTwoWeekHigh: ch.high52, fiftyTwoWeekLow: ch.low52 };
};

async function mock(context) {
  if (LIVE) return;
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const op = url.pathname.split('/').pop();
    const q = url.searchParams;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (op === 'search') {
      const term = (q.get('q') || '').toLowerCase();
      const all = [
        { symbol: 'TESTCO.NS', name: 'Test Company Limited', exchange: 'NSE', exchangeCode: 'NSI', type: 'EQUITY', sector: 'Technology', industry: 'Software' },
        { symbol: 'DEMOBANK.NS', name: 'Demo Bank Limited', exchange: 'NSE', exchangeCode: 'NSI', type: 'EQUITY', sector: 'Financial Services', industry: 'Banks' },
      ];
      return json({ results: all.filter((r) => r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)) });
    }
    if (op === 'quote') return json({ quotes: (q.get('symbols') || '').split(',').map(quoteOf).filter(Boolean), asOf: Date.now() });
    if (op === 'chart') {
      const ch = chartOf(q.get('symbol'));
      return ch ? json(ch) : json({ error: 'No data found, symbol may be delisted' }, 404);
    }
    if (op === 'fundamentals') return json({ rows: (q.get('symbols') || '').split(',').map((s) => ({ symbol: s, ok: !!FIX[s], sector: s === 'DEMOBANK.NS' ? 'Financial Services' : 'Technology', industry: 'Test', marketCap: 5e11, name: FIX[s]?.name, currency: 'INR', roe: 0.2 })), asOf: Date.now() });
    if (op === 'screen') return json({ total: 2, offset: 0, quotes: ['TESTCO.NS', 'DEMOBANK.NS'].map(quoteOf), asOf: Date.now() });
    return json({ error: 'Not available in the test fixtures.' }, 404);
  });
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`  pass  ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${String(e.message || e).split('\n')[0]}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await mock(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()} :: PAGEERROR ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
  const go = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 20000 });
    await page.waitForTimeout(350);
  };
  const text = () => page.locator('main').innerText();

  await test('home page lists every tool group', async () => {
    await go('/');
    const t = await text();
    for (const g of ['Markets', 'Portfolio', 'Valuation', 'Plan', 'Learn']) expect(t.includes(g), `missing group ${g}`);
    expect((await page.locator('a.toolcard').count()) >= 20, 'expected at least 20 tool cards');
  });

  await test('SIP calculator matches the closed-form value', async () => {
    await go('/calc/invest');
    expect((await text()).includes('50.46 L'), 'expected ₹50.46 L for ₹10,000 a month, 12%, 15 years');
    const field = page.getByLabel('Invested every month');
    await field.fill('20000');
    await page.waitForTimeout(300);
    expect((await text()).includes('1.01 Cr'), 'doubling the instalment should double the result to ₹1.01 Cr');
  });

  await test('calculator inputs persist across a reload and reset works', async () => {
    await page.reload();
    await page.waitForSelector('h1');
    await page.waitForTimeout(300);
    expect((await text()).includes('1.01 Cr'), 'saved input was lost on reload');
    await page.getByRole('button', { name: 'Reset' }).first().click();
    await page.waitForTimeout(300);
    expect((await text()).includes('50.46 L'), 'reset did not restore the default');
  });

  await test('invalid input shows an error instead of a result', async () => {
    await go('/valuation/dcf');
    await page.getByLabel('Discount rate (WACC)').fill('4');
    await page.waitForTimeout(300);
    expect((await text()).includes('Terminal growth must be below the discount rate'), 'expected a validation message');
    expect(!(await text()).includes('Estimated value per share'), 'a result was shown despite invalid input');
    await page.getByRole('button', { name: 'Reset to example' }).click();
  });

  await test('income tax: ₹18.5 lakh income under the new regime', async () => {
    await go('/calc/tax');
    expect((await text()).includes('1,61,200'), 'expected total tax of ₹1,61,200');
  });

  await test('EMI calculator', async () => {
    await go('/calc/loan');
    expect((await text()).includes('43,391'), 'expected an EMI of ₹43,391 for ₹50 lakh at 8.5% over 20 years');
  });

  let portfolioUrl = '';
  await test('create a portfolio and record a purchase', async () => {
    await go('/portfolio');
    await page.getByRole('button', { name: 'New portfolio' }).click();
    await page.getByLabel('Name').fill('E2E portfolio');
    await page.getByRole('button', { name: 'Create portfolio' }).click();
    await page.waitForURL(/\/portfolio\/.+/);
    portfolioUrl = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Add your first stock' }).click();
    await page.getByLabel('Search for a stock').fill('test');
    await page.locator('.dropdown .opt', { hasText: 'TESTCO.NS' }).click();
    await page.getByLabel('Date').fill('2024-06-03');
    await page.getByLabel('Quantity').fill('10');
    await page.getByLabel(/Price per share/).fill('100');
    await page.getByRole('button', { name: 'Add to portfolio' }).click();
    await page.waitForSelector('table.tbl tbody tr');
    await page.waitForTimeout(600);
    const t = await text();
    expect(t.includes('TESTCO'), 'holding not listed');
    expect(t.includes('₹1,200'), 'expected a value of ₹1,200 (10 × ₹120)');
    expect(t.includes('+20.0%'), 'expected a 20% gain');
  });

  await test('portfolio survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('table.tbl tbody tr');
    await page.waitForTimeout(500);
    expect((await text()).includes('₹1,200'), 'portfolio was not restored from storage');
  });

  await test('selling more than is held is refused', async () => {
    await page.getByRole('button', { name: 'Sell' }).first().click();
    await page.getByLabel('Quantity').fill('50');
    await page.getByLabel(/Price per share/).fill('130');
    await page.getByRole('button', { name: 'Add to portfolio' }).click();
    await page.waitForTimeout(200);
    expect((await page.locator('.modal').innerText()).includes('you cannot sell 50'), 'oversell was not rejected');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test('CSV import validates rows and adds the good ones', async () => {
    await page.getByRole('tab', { name: 'Transactions' }).click();
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.locator('#csvtext').fill('date,type,symbol,quantity,price\n2024-07-01,buy,DEMOBANK,5,450\n2024-07-02,buy,DEMOBANK,,450\nnot-a-date,buy,DEMOBANK,1,1');
    await page.waitForTimeout(200);
    const m = await page.locator('.modal').innerText();
    expect(m.includes('1 ready') && m.includes('2 skipped'), 'expected 1 valid and 2 rejected rows');
    await page.getByRole('button', { name: /Import 1 transaction/ }).click();
    await page.waitForTimeout(400);
    expect((await text()).includes('DEMOBANK'), 'imported transaction is missing');
  });

  await test('allocation targets and rebalancing trades', async () => {
    await page.getByRole('tab', { name: 'Allocation & targets' }).click();
    await page.waitForSelector('text=Target weights');
    await page.getByRole('button', { name: 'Equal', exact: true }).click();
    await page.waitForTimeout(300);
    expect((await text()).includes('adds up'), 'equal targets should total 100%');
    await page.getByRole('tab', { name: 'Rebalance' }).click();
    await page.getByRole('button', { name: 'Buy and sell' }).click();
    await page.waitForTimeout(400);
    const t = await text();
    expect(t.includes('Trade list') && t.includes('SELL') && t.includes('BUY'), 'expected buy and sell trades');
  });

  await test('performance, risk and tax tabs render from history', async () => {
    await page.getByRole('tab', { name: 'Performance' }).click();
    await page.waitForSelector('text=Growth of 100', { timeout: 20000 });
    await page.getByRole('tab', { name: 'Risk' }).click();
    await page.waitForSelector('text=Where the risk comes from', { timeout: 20000 });
    await page.getByRole('tab', { name: 'Tax & income' }).click();
    await page.waitForSelector('text=If you sold everything today');
  });

  await test('portfolio export downloads a file', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
    expect(download.suggestedFilename().endsWith('.portfolio.json'), 'unexpected export file name');
  });

  await test('optimiser runs on the saved portfolio', async () => {
    await go(`/optimizer?portfolio=${portfolioUrl.split('/').pop()}`);
    await page.waitForSelector('text=Suggested weights', { timeout: 20000 });
    expect((await text()).includes('How fragile is the answer?'), 'robustness table missing');
  });

  await test('global search finds tools and navigates', async () => {
    await go('/');
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search everything').fill('retire');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/calc\/retire/);
  });

  await test('favourites and lesson progress are remembered', async () => {
    await page.getByRole('button', { name: /Favourite/ }).click();
    await go('/learn/why-invest');
    await page.getByRole('button', { name: 'Mark as done' }).click();
    await go('/');
    const t = await text();
    expect(t.includes('Your favourites') && t.includes('Retirement planner'), 'favourite not shown on the home page');
    expect(t.includes('1 of'), 'lesson progress not shown');
  });

  await test('unknown ticker and unknown page fail gracefully', async () => {
    await go('/stock/NOSUCH.NS');
    await page.waitForSelector('.note.err', { timeout: 15000 });
    await go('/this/does/not/exist');
    expect((await text()).includes('Page not found'), 'missing not-found page');
  });

  const ROUTES = ['/markets', '/stock', '/stock/TESTCO.NS', '/screener', '/compare', '/watchlist', '/currency', '/portfolio', '/optimizer', '/backtest', '/risk', '/simulate', '/valuation/dcf', '/valuation/models', '/valuation/models?tab=ddm', '/valuation/models?tab=capital', '/valuation/models?tab=checks', '/corporate', '/corporate?tab=breakeven', '/corporate?tab=depreciation', '/calc/invest?tab=lumpsum', '/calc/invest?tab=goal', '/calc/invest?tab=swp', '/calc/invest?tab=cagr', '/calc/invest?tab=xirr', '/calc/tax?tab=gains', '/calc/retire', '/calc/fixed-income', '/calc/fixed-income?tab=bonds', '/networth', '/learn', '/learn/mpt', '/glossary', '/settings'];
  await test(`all ${ROUTES.length} routes render without crashing`, async () => {
    for (const r of ROUTES) {
      await go(r);
      expect((await page.locator('text=This page hit an error').count()) === 0, `error boundary on ${r}`);
      expect((await page.locator('h1').innerText()).trim().length > 0, `no heading on ${r}`);
    }
  });

  await test('no console errors during the whole run', async () => {
    const real = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
    expect(real.length === 0, `${real.length} console error(s): ${real.slice(0, 3).join(' | ')}`);
  });

  await test('mobile: no sideways scrolling and the menu opens', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    await mock(m);
    const p = await m.newPage();
    for (const r of ['/', '/calc/invest', '/calc/tax', '/valuation/dcf', '/screener', '/learn/key-ratios', '/glossary', '/markets']) {
      await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('h1');
      await p.waitForTimeout(500);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over <= 1, `${r} overflows sideways by ${over}px on a phone`);
    }
    await p.getByRole('button', { name: 'Open menu' }).click();
    await p.waitForTimeout(250);
    expect(await p.locator('.sidebar a', { hasText: 'Stock screener' }).isVisible(), 'navigation drawer did not open');
    await m.close();
  });

  await browser.close();
  console.log(`\nIntegration tests against ${BASE}${LIVE ? ' (live data)' : ' (fixture data)'}\n` + results.join('\n'));
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
