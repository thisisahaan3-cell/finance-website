/**
 * Market-data gateway.
 *
 * Browsers cannot call Yahoo Finance directly (no CORS headers), so the site calls
 * `/api/<op>` and this module fetches the data server-side and returns a compact,
 * normalised JSON shape. It runs inside a Netlify Function in production and inside
 * a small Vite middleware during local development — same code in both places.
 *
 * Nothing here needs an API key. Yahoo's endpoints are unofficial: every operation
 * validates its inputs, fails loudly with a readable message, and never invents data.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12_000;
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

type Json = Record<string, any>;

async function http(url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new ApiError(504, 'The data provider took too long to respond. Try again.');
    throw new ApiError(502, 'Could not reach the data provider. Try again in a moment.');
  }
}

/* ---------- Yahoo session (cookie + crumb), cached while the function stays warm ---------- */

let session: { cookie: string; crumb: string; at: number } | null = null;
let sessionPromise: Promise<{ cookie: string; crumb: string; at: number }> | null = null;

function cookiesOf(res: Response): string {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function createSession() {
  let cookie = '';
  for (const url of ['https://fc.yahoo.com', 'https://finance.yahoo.com/quote/AAPL']) {
    try {
      const res = await http(url, { redirect: 'manual' }, 8000);
      cookie = cookiesOf(res);
      res.body?.cancel().catch(() => undefined);
      if (cookie) break;
    } catch {
      /* try the next source */
    }
  }
  if (!cookie) throw new ApiError(503, 'The data provider did not start a session. Try again in a minute.');
  for (const host of [HOSTS[1], HOSTS[0]]) {
    const res = await http(`${host}/v1/test/getcrumb`, { headers: { Cookie: cookie } }, 8000);
    const crumb = (await res.text()).trim();
    if (res.ok && crumb && crumb.length < 40 && !crumb.includes('<') && !crumb.includes('{')) {
      return { cookie, crumb, at: Date.now() };
    }
  }
  throw new ApiError(503, 'The data provider refused a session (it may be rate-limiting). Try again in a minute.');
}

async function getSession(force = false) {
  if (!force && session && Date.now() - session.at < 25 * 60_000) return session;
  if (!sessionPromise) {
    sessionPromise = createSession()
      .then((s) => (session = s))
      .finally(() => (sessionPromise = null));
  }
  return sessionPromise;
}

async function yahoo(path: string, opts: { auth?: boolean; body?: unknown } = {}): Promise<Json> {
  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // the third try is only for transient trouble (rate limits, timeouts, server errors), after a short pause
    if (attempt === 2) await new Promise((r) => setTimeout(r, 350));
    const host = HOSTS[attempt % HOSTS.length];
    let url = host + path;
    const headers: Record<string, string> = {};
    if (opts.auth) {
      const s = await getSession(attempt > 0);
      url += (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(s.crumb);
      headers.Cookie = s.cookie;
    }
    const init: RequestInit = { headers };
    if (opts.body !== undefined) {
      init.method = 'POST';
      init.body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    let res: Response;
    try {
      res = await http(url, init);
    } catch (e) {
      lastError = e instanceof ApiError ? e : new ApiError(502, 'Could not reach the data provider. Try again in a moment.');
      continue;
    }
    const text = await res.text();
    let json: Json | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (res.ok && json) return json;
    const described: string | undefined =
      json?.chart?.error?.description ??
      json?.quoteSummary?.error?.description ??
      json?.finance?.error?.description ??
      json?.quoteResponse?.error?.description ??
      json?.timeseries?.error?.description;
    if (res.status === 404) throw new ApiError(404, described || 'No data found for that symbol.');
    if (res.status === 400 || res.status === 422) throw new ApiError(400, described || 'The data provider rejected the request.');
    if (res.status === 429) lastError = new ApiError(429, 'The data provider is rate-limiting requests. Wait a minute and try again.');
    else if (res.status === 401 || res.status === 403) {
      session = null;
      lastError = new ApiError(503, 'The data provider session expired. Try again.');
    } else lastError = new ApiError(502, described || `The data provider returned an error (${res.status}).`);
  }
  throw lastError ?? new ApiError(502, 'The data provider returned an error.');
}

/* ---------- helpers ---------- */

const SYMBOL_RE = /^[A-Za-z0-9^.=\-_&]{1,24}$/;

function symbolOf(v: string | null): string {
  const s = (v ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new ApiError(400, 'That does not look like a valid ticker symbol.');
  return s;
}

function symbolsOf(v: string | null, max: number): string[] {
  const list = (v ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!list.length) throw new ApiError(400, 'No symbols were given.');
  if (list.length > max) throw new ApiError(400, `Too many symbols in one request (maximum ${max}).`);
  for (const s of list) if (!SYMBOL_RE.test(s)) throw new ApiError(400, `Invalid ticker symbol: ${s.slice(0, 30)}`);
  return [...new Set(list)];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const raw = (x: any): number | null => (x && typeof x === 'object' ? num(x.raw) : num(x));

/** London quotes are in pence ("GBp"); the site works in pounds so money maths stays consistent. */
function minorUnit(currency: string | undefined): { currency: string | null; div: number } {
  if (currency === 'GBp' || currency === 'GBX') return { currency: 'GBP', div: 100 };
  if (currency === 'ZAc') return { currency: 'ZAR', div: 100 };
  if (currency === 'ILA') return { currency: 'ILS', div: 100 };
  return { currency: currency ?? null, div: 1 };
}

/* ---------- operations ---------- */

const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['5m', '15m', '30m', '1h', '1d', '1wk', '1mo']);

async function opChart(q: URLSearchParams) {
  const symbol = symbolOf(q.get('symbol'));
  const interval = q.get('interval') ?? '1d';
  if (!INTERVALS.has(interval)) throw new ApiError(400, 'Unsupported interval.');
  let query = `interval=${interval}&events=div%2Csplits&includeAdjustedClose=true`;
  const p1 = q.get('p1');
  if (p1) {
    const a = Number(p1);
    const b = Number(q.get('p2') ?? Math.floor(Date.now() / 1000));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new ApiError(400, 'Invalid date range.');
    query += `&period1=${Math.floor(a)}&period2=${Math.floor(b)}`;
  } else {
    const range = q.get('range') ?? '1y';
    if (!RANGES.has(range)) throw new ApiError(400, 'Unsupported range.');
    query += `&range=${range}`;
  }
  const json = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`);
  const res = json?.chart?.result?.[0];
  if (!res?.meta) throw new ApiError(404, 'No price data found for that symbol.');
  const meta = res.meta;
  const { currency, div } = minorUnit(meta.currency);
  const sc = (x: unknown) => {
    const v = num(x);
    return v === null ? null : Math.round((v / div) * 1e4) / 1e4;
  };
  const ts: number[] = res.timestamp ?? [];
  const quote = res.indicators?.quote?.[0] ?? {};
  const adjArr: (number | null)[] = res.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];
  const wantOhlc = q.get('ohlc') === '1';
  const t: number[] = [];
  const c: number[] = [];
  const adj: number[] = [];
  const v: number[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = quote.close?.[i];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue;
    const a = adjArr[i];
    t.push(ts[i]);
    c.push(sc(close)!);
    adj.push(typeof a === 'number' && Number.isFinite(a) && a > 0 ? sc(a)! : sc(close)!);
    v.push(num(quote.volume?.[i]) ?? 0);
    if (wantOhlc) {
      o.push(sc(quote.open?.[i]) ?? sc(close)!);
      h.push(sc(quote.high?.[i]) ?? sc(close)!);
      l.push(sc(quote.low?.[i]) ?? sc(close)!);
    }
  }
  const div_: [number, number][] = Object.values(res.events?.dividends ?? {})
    .map((d: any) => [d.date as number, sc(d.amount) ?? 0] as [number, number])
    .filter((d) => d[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  const split: [number, number, number][] = Object.values(res.events?.splits ?? {})
    .map((s: any) => [s.date as number, Number(s.numerator), Number(s.denominator)] as [number, number, number])
    .filter((s) => s[1] > 0 && s[2] > 0)
    .sort((a, b) => a[0] - b[0]);
  const intraday = interval !== '1d' && interval !== '1wk' && interval !== '1mo';
  return {
    maxAge: intraday ? 60 : 300,
    body: {
      symbol: meta.symbol ?? symbol,
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol,
      currency,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
      type: meta.instrumentType ?? null,
      tz: meta.exchangeTimezoneName ?? null,
      gmtoffset: num(meta.gmtoffset) ?? 0,
      price: sc(meta.regularMarketPrice),
      prevClose: sc(meta.chartPreviousClose ?? meta.previousClose),
      dayHigh: sc(meta.regularMarketDayHigh),
      dayLow: sc(meta.regularMarketDayLow),
      high52: sc(meta.fiftyTwoWeekHigh),
      low52: sc(meta.fiftyTwoWeekLow),
      volume: num(meta.regularMarketVolume),
      marketTime: num(meta.regularMarketTime),
      firstTrade: num(meta.firstTradeDate),
      interval,
      t,
      c,
      adj,
      v,
      ...(wantOhlc ? { o, h, l } : {}),
      div: div_,
      split,
    },
  };
}

const QUOTE_FIELDS = [
  'symbol', 'shortName', 'longName', 'quoteType', 'currency', 'exchange', 'fullExchangeName', 'marketState',
  'regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent', 'regularMarketPreviousClose',
  'regularMarketOpen', 'regularMarketDayHigh', 'regularMarketDayLow', 'regularMarketVolume', 'regularMarketTime',
  'marketCap', 'trailingPE', 'forwardPE', 'priceToBook', 'epsTrailingTwelveMonths', 'epsForward', 'bookValue',
  'dividendYield', 'dividendRate', 'trailingAnnualDividendYield', 'trailingAnnualDividendRate',
  'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyTwoWeekChangePercent', 'fiftyDayAverage', 'twoHundredDayAverage',
  'averageDailyVolume3Month', 'sharesOutstanding', 'averageAnalystRating', 'exchangeDataDelayedBy',
  'financialCurrency', 'exchangeTimezoneName',
];
const PRICE_FIELDS = new Set([
  'regularMarketPrice', 'regularMarketChange', 'regularMarketPreviousClose', 'regularMarketOpen',
  'regularMarketDayHigh', 'regularMarketDayLow', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyDayAverage',
  'twoHundredDayAverage',
]);

function normaliseQuote(qt: Json): Json {
  const { currency, div } = minorUnit(qt.currency);
  const out: Json = {};
  for (const f of QUOTE_FIELDS) {
    const val = qt[f];
    if (val === undefined || val === null) continue;
    out[f] = PRICE_FIELDS.has(f) && typeof val === 'number' ? Math.round((val / div) * 1e4) / 1e4 : val;
  }
  out.currency = currency;
  if (div !== 1) out.quotedIn = qt.currency;
  return out;
}

/**
 * The provider sometimes sends no market value for a company. Where that happens, work it out as
 * latest reported shares × price (flagged `marketCapDerived`), for at most `limit` quotes per request.
 */
async function fillMarketCaps(quotes: Json[], limit = 12): Promise<void> {
  const missing = quotes.filter((q) => q.quoteType === 'EQUITY' && !num(q.marketCap) && num(q.regularMarketPrice)).slice(0, limit);
  await Promise.all(
    missing.map(async (q) => {
      const shares = num(q.sharesOutstanding) ?? (await latestShares(q.symbol));
      if (shares) {
        q.marketCap = shares * q.regularMarketPrice;
        q.marketCapDerived = true;
      }
    }),
  );
}

async function opQuote(q: URLSearchParams) {
  const symbols = symbolsOf(q.get('symbols'), 120);
  const json = await yahoo(
    `/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(',')}&fields=${QUOTE_FIELDS.join(',')}`,
    { auth: true },
  );
  const quotes: Json[] = (json?.quoteResponse?.result ?? []).map(normaliseQuote);
  await fillMarketCaps(quotes);
  return { maxAge: 60, body: { quotes, asOf: Date.now() } };
}

async function opSearch(q: URLSearchParams) {
  const term = (q.get('q') ?? '').trim().slice(0, 60);
  if (term.length < 1) throw new ApiError(400, 'Type something to search for.');
  const json = await yahoo(
    `/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false`,
  );
  const results = (json?.quotes ?? [])
    .filter((x: Json) => x.symbol && x.isYahooFinance !== false)
    .map((x: Json) => ({
      symbol: x.symbol,
      name: x.longname ?? x.shortname ?? x.symbol,
      exchange: x.exchDisp ?? x.exchange ?? '',
      exchangeCode: x.exchange ?? '',
      type: x.quoteType ?? '',
      sector: x.sectorDisp ?? x.sector ?? null,
      industry: x.industryDisp ?? x.industry ?? null,
    }));
  return { maxAge: 3600, body: { results } };
}

/** Flatten a quoteSummary module: {raw, fmt} objects become plain numbers, empty objects become null. */
function flatten(mod: Json | undefined): Json {
  const out: Json = {};
  if (!mod) return out;
  for (const [k, val] of Object.entries(mod)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) continue;
    if (typeof val === 'object') {
      if ('raw' in (val as Json)) out[k] = (val as Json).raw;
      continue;
    }
    out[k] = val;
  }
  return out;
}

const SUMMARY_PRICE_KEYS = [
  'currentPrice', 'targetHighPrice', 'targetLowPrice', 'targetMeanPrice', 'targetMedianPrice', 'previousClose', 'open',
  'dayLow', 'dayHigh', 'regularMarketPreviousClose', 'regularMarketOpen', 'regularMarketDayLow', 'regularMarketDayHigh',
  'fiftyTwoWeekLow', 'fiftyTwoWeekHigh', 'fiftyDayAverage', 'twoHundredDayAverage', 'regularMarketPrice',
  'regularMarketChange',
];

async function fetchSummary(symbol: string, modules: string): Promise<Json> {
  const json = await yahoo(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&formatted=false`, {
    auth: true,
  });
  const res = json?.quoteSummary?.result?.[0];
  if (!res) throw new ApiError(404, 'No company data found for that symbol.');
  return res;
}

/** Latest reported share count, used to work out market value when the provider omits it. */
async function latestShares(symbol: string): Promise<number | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const json = await yahoo(
      `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=quarterlyOrdinarySharesNumber,annualOrdinarySharesNumber&period1=${now - 3 * 366 * 86400}&period2=${now + 86400}&merge=false`,
    );
    let best: { date: string; value: number } | null = null;
    for (const r of json?.timeseries?.result ?? []) {
      const type: string | undefined = r?.meta?.type?.[0];
      for (const row of (type ? r[type] : null) ?? []) {
        const value = raw(row?.reportedValue);
        if (value && value > 0 && row.asOfDate && (!best || row.asOfDate > best.date)) best = { date: row.asOfDate, value };
      }
    }
    return best ? best.value : null;
  } catch {
    return null;
  }
}

async function opSummary(q: URLSearchParams) {
  const symbol = symbolOf(q.get('symbol'));
  const res = await fetchSummary(symbol, 'price,assetProfile,summaryDetail,defaultKeyStatistics,financialData,calendarEvents');
  const price = flatten(res.price);
  const detail = flatten(res.summaryDetail);
  const stats = flatten(res.defaultKeyStatistics);
  const fin = flatten(res.financialData);
  const profile = flatten(res.assetProfile);
  const { currency, div } = minorUnit(price.currency ?? detail.currency);
  if (div !== 1) {
    for (const m of [price, detail, fin]) for (const k of SUMMARY_PRICE_KEYS) if (typeof m[k] === 'number') m[k] = m[k] / div;
  }
  price.currency = currency;
  if (!num(price.marketCap) && !num(detail.marketCap) && price.quoteType === 'EQUITY' && num(price.regularMarketPrice)) {
    const shares = num(stats.sharesOutstanding) ?? num(stats.impliedSharesOutstanding) ?? (await latestShares(symbol));
    if (shares) {
      price.marketCap = shares * price.regularMarketPrice;
      price.marketCapDerived = true; // shares in issue × price, because the provider sent no figure
      stats.sharesOutstanding ??= shares;
    }
  }
  const earningsDate = res.calendarEvents?.earnings?.earningsDate?.[0];
  return {
    maxAge: 1800,
    body: {
      symbol,
      price,
      profile,
      detail,
      stats,
      fin,
      nextEarnings: raw(earningsDate),
      asOf: Date.now(),
    },
  };
}

async function opFundamentals(q: URLSearchParams) {
  const symbols = symbolsOf(q.get('symbols'), 25);
  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetchSummary(symbol, 'price,assetProfile,financialData,defaultKeyStatistics,summaryDetail');
        const fin = flatten(res.financialData);
        const price = flatten(res.price);
        const stats = flatten(res.defaultKeyStatistics);
        const detail = flatten(res.summaryDetail);
        const profile = flatten(res.assetProfile);
        const unit = minorUnit(price.currency);
        let marketCap = num(price.marketCap) ?? num(detail.marketCap);
        if (!marketCap && num(price.regularMarketPrice)) {
          const shares = num(stats.sharesOutstanding) ?? num(stats.impliedSharesOutstanding) ?? (await latestShares(symbol));
          if (shares) marketCap = (shares * price.regularMarketPrice) / unit.div;
        }
        return {
          symbol,
          ok: true,
          sector: profile.sector ?? null,
          industry: profile.industry ?? null,
          roe: num(fin.returnOnEquity),
          roa: num(fin.returnOnAssets),
          debtToEquity: num(fin.debtToEquity) === null ? null : fin.debtToEquity / 100,
          profitMargin: num(fin.profitMargins),
          operatingMargin: num(fin.operatingMargins),
          grossMargin: num(fin.grossMargins),
          ebitdaMargin: num(fin.ebitdaMargins),
          revenueGrowth: num(fin.revenueGrowth),
          earningsGrowth: num(fin.earningsGrowth),
          currentRatio: num(fin.currentRatio),
          freeCashflow: num(fin.freeCashflow),
          totalRevenue: num(fin.totalRevenue),
          evToEbitda: num(stats.enterpriseToEbitda),
          evToRevenue: num(stats.enterpriseToRevenue),
          peg: num(stats.pegRatio),
          beta: num(detail.beta) ?? num(stats.beta),
          payoutRatio: num(detail.payoutRatio),
          dividendYield: num(detail.dividendYield),
          marketCap,
          name: price.longName ?? price.shortName ?? null,
          currency: unit.currency,
          trailingPE: num(detail.trailingPE),
          priceToBook: num(stats.priceToBook),
          priceToSales: num(detail.priceToSalesTrailing12Months),
          heldByInsiders: num(stats.heldPercentInsiders),
          financialCurrency: fin.financialCurrency ?? null,
        };
      } catch (e) {
        return { symbol, ok: false, error: e instanceof ApiError ? e.message : 'Unavailable' };
      }
    }),
  );
  return { maxAge: 3600, body: { rows, asOf: Date.now() } };
}

export const STATEMENT_KEYS = [
  // income statement
  'TotalRevenue', 'CostOfRevenue', 'GrossProfit', 'OperatingIncome', 'EBIT', 'EBITDA', 'InterestExpense',
  'NetInterestIncome', 'PretaxIncome', 'TaxProvision', 'NetIncome', 'DilutedEPS', 'BasicEPS', 'DilutedAverageShares',
  'TaxRateForCalcs', 'ReconciledDepreciation',
  // balance sheet
  'TotalAssets', 'CurrentAssets', 'CashAndCashEquivalents', 'Inventory', 'AccountsReceivable', 'NetPPE',
  'TotalLiabilitiesNetMinorityInterest', 'CurrentLiabilities', 'AccountsPayable', 'TotalDebt', 'LongTermDebt', 'NetDebt',
  'StockholdersEquity', 'TotalEquityGrossMinorityInterest', 'InvestedCapital', 'WorkingCapital', 'OrdinarySharesNumber',
  // cash flow
  'OperatingCashFlow', 'InvestingCashFlow', 'FinancingCashFlow', 'CapitalExpenditure', 'FreeCashFlow',
  'CashDividendsPaid', 'RepurchaseOfCapitalStock', 'DepreciationAndAmortization',
];

function tabulate(results: Json[], prefix: string) {
  const byKey: Record<string, Record<string, number>> = {};
  const dates = new Set<string>();
  let currency: string | null = null;
  for (const r of results) {
    const type: string | undefined = r?.meta?.type?.[0];
    if (!type || !type.startsWith(prefix)) continue;
    const key = type.slice(prefix.length);
    const rows: Json[] = (r[type] ?? []).filter(Boolean);
    for (const row of rows) {
      const val = raw(row.reportedValue);
      if (val === null || !row.asOfDate) continue;
      (byKey[key] ??= {})[row.asOfDate] = val;
      dates.add(row.asOfDate);
      currency ??= row.currencyCode ?? null;
    }
  }
  const sorted = [...dates].sort();
  const items: Record<string, (number | null)[]> = {};
  for (const [key, map] of Object.entries(byKey)) items[key] = sorted.map((d) => (d in map ? map[d] : null));
  return { dates: sorted, items, currency };
}

async function opFinancials(q: URLSearchParams) {
  const symbol = symbolOf(q.get('symbol'));
  const types = [
    ...STATEMENT_KEYS.map((k) => 'annual' + k),
    ...STATEMENT_KEYS.map((k) => 'quarterly' + k),
    ...['TotalRevenue', 'NetIncome', 'EBITDA', 'OperatingIncome', 'DilutedEPS', 'OperatingCashFlow', 'FreeCashFlow', 'CapitalExpenditure'].map(
      (k) => 'trailing' + k,
    ),
  ];
  const now = Math.floor(Date.now() / 1000);
  const json = await yahoo(
    `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(
      symbol,
    )}&type=${types.join(',')}&period1=${now - 12 * 366 * 86400}&period2=${now + 86400}&merge=false`,
  );
  const results: Json[] = json?.timeseries?.result ?? [];
  const annual = tabulate(results, 'annual');
  const quarterly = tabulate(results, 'quarterly');
  const trailing = tabulate(results, 'trailing');
  if (!annual.dates.length && !quarterly.dates.length) throw new ApiError(404, 'No financial statements are available for that symbol.');
  const ttm: Record<string, number | null> = {};
  for (const [k, arr] of Object.entries(trailing.items)) ttm[k] = arr.length ? arr[arr.length - 1] : null;
  return {
    maxAge: 21600,
    body: {
      symbol,
      currency: annual.currency ?? quarterly.currency,
      annual: { dates: annual.dates, items: annual.items },
      quarterly: { dates: quarterly.dates, items: quarterly.items },
      ttm,
      ttmDate: trailing.dates.length ? trailing.dates[trailing.dates.length - 1] : null,
      asOf: Date.now(),
    },
  };
}

/* ---------- screener ---------- */

export const SCREEN_FIELDS: Record<string, string> = {
  marketCap: 'intradaymarketcap', // replaced per market in opScreen
  price: 'intradayprice',
  change: 'percentchange',
  pe: 'peratio.lasttwelvemonths',
  pb: 'pricebookratio.quarterly',
  peg: 'pegratio_5y',
  evEbitda: 'lastclosetevebitda.lasttwelvemonths',
  ps: 'lastclosemarketcaptotalrevenue.lasttwelvemonths',
  roe: 'returnonequity.lasttwelvemonths',
  roa: 'returnonassets.lasttwelvemonths',
  roce: 'returnontotalcapital.lasttwelvemonths',
  debtToEquity: 'totaldebtequity.lasttwelvemonths',
  netMargin: 'netincomemargin.lasttwelvemonths',
  ebitdaMargin: 'ebitdamargin.lasttwelvemonths',
  grossMargin: 'grossprofitmargin.lasttwelvemonths',
  revenueGrowth: 'totalrevenues1yrgrowth.lasttwelvemonths',
  epsGrowth: 'dilutedeps1yrgrowth.lasttwelvemonths',
  profitGrowth: 'netincome1yrgrowth.lasttwelvemonths',
  quarterlyRevenueGrowth: 'quarterlyrevenuegrowth.quarterly',
  dividendYield: 'forward_dividend_yield',
  beta: 'beta',
  change52w: 'fiftytwowkpercentchange',
  currentRatio: 'currentratio.lasttwelvemonths',
  interestCover: 'ebitinterestexpense.lasttwelvemonths',
  avgVolume: 'avgdailyvol3m',
  promoterHolding: 'pctheldinsider',
  institutionalHolding: 'pctheldinst',
};

const MARKETS: Record<string, { region: string; exchanges: string[] }> = {
  NSE: { region: 'in', exchanges: ['NSI'] },
  BSE: { region: 'in', exchanges: ['BSE'] },
  US: { region: 'us', exchanges: ['NMS', 'NYQ'] },
  UK: { region: 'gb', exchanges: ['LSE'] },
};

export const SECTORS = [
  'Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Consumer Defensive', 'Industrials', 'Energy',
  'Basic Materials', 'Communication Services', 'Utilities', 'Real Estate',
];

async function opScreen(q: URLSearchParams) {
  let spec: Json;
  try {
    spec = JSON.parse(q.get('q') ?? '');
  } catch {
    throw new ApiError(400, 'Invalid screener request.');
  }
  const market = MARKETS[String(spec.market)];
  if (!market) throw new ApiError(400, 'Unknown market.');
  const operands: Json[] = [{ operator: 'eq', operands: ['region', market.region] }];
  operands.push(
    market.exchanges.length === 1
      ? { operator: 'eq', operands: ['exchange', market.exchanges[0]] }
      : { operator: 'or', operands: market.exchanges.map((e) => ({ operator: 'eq', operands: ['exchange', e] })) },
  );
  const sectors: string[] = Array.isArray(spec.sectors) ? spec.sectors.filter((s: unknown) => SECTORS.includes(String(s))) : [];
  if (sectors.length === 1) operands.push({ operator: 'eq', operands: ['sector', sectors[0]] });
  else if (sectors.length > 1) operands.push({ operator: 'or', operands: sectors.map((s) => ({ operator: 'eq', operands: ['sector', s] })) });
  const industry = typeof spec.industry === 'string' ? spec.industry.trim() : '';
  if (industry) {
    if (!/^[\w &—\-,.'/()]{2,70}$/.test(industry)) throw new ApiError(400, 'Invalid industry name.');
    operands.push({ operator: 'eq', operands: ['industry', industry] });
  }
  const filters: Json[] = Array.isArray(spec.filters) ? spec.filters.slice(0, 20) : [];
  // Market value. The provider keeps two size fields and, for Indian listings, each one is missing for a
  // changing handful of large companies. Filters therefore accept a match on either field, and a listing
  // sorted by size merges the two orderings. For US and UK listings the last-close field is in each
  // company's home currency, so only the intraday field is used there.
  const CAP_A = 'intradaymarketcap';
  const CAP_B = 'lastclosemarketcap.lasttwelvemonths';
  const india = market.region === 'in';
  const condition = (field: string, min: number | null, max: number | null): Json | null =>
    min !== null && max !== null ? { operator: 'btwn', operands: [field, min, max] } : min !== null ? { operator: 'gt', operands: [field, min] } : max !== null ? { operator: 'lt', operands: [field, max] } : null;
  for (const f of filters) {
    const key = String(f.field);
    const field = SCREEN_FIELDS[key];
    if (!field) throw new ApiError(400, `Unknown filter: ${key.slice(0, 40)}`);
    const min = num(f.min);
    const max = num(f.max);
    if (min !== null && max !== null && min > max) throw new ApiError(400, 'A filter has its minimum above its maximum.');
    const one = condition(field, min, max);
    if (!one) continue;
    operands.push(key === 'marketCap' && india ? { operator: 'or', operands: [one, condition(CAP_B, min, max)] } : one);
  }
  const sortKey = spec.sort === undefined || spec.sort === null ? 'marketCap' : String(spec.sort);
  if (!SCREEN_FIELDS[sortKey]) throw new ApiError(400, 'Unknown sort field.');
  const size = Math.min(Math.max(Number(spec.size) || 50, 1), 100);
  const offset = Math.min(Math.max(Number(spec.offset) || 0, 0), 5000);
  const asc = spec.dir === 'asc';
  const run = async (sortField: string, from: number, count: number): Promise<{ total: number; quotes: Json[] }> => {
    const json = await yahoo(`/v1/finance/screener?lang=en-US&region=US&formatted=false&corsDomain=finance.yahoo.com`, {
      auth: true,
      body: { offset: from, size: count, sortField, sortType: asc ? 'ASC' : 'DESC', quoteType: 'EQUITY', query: { operator: 'and', operands }, userId: '', userIdType: 'guid' },
    });
    const res = json?.finance?.result?.[0];
    if (!res) throw new ApiError(502, json?.finance?.error?.description ?? 'The screener returned no result.');
    return { total: num(res.total) ?? 0, quotes: (res.quotes ?? []).map(normaliseQuote) };
  };

  let total: number;
  let quotes: Json[];
  if (india && sortKey === 'marketCap') {
    // Exact for the first pages (both orderings fetched from the top); deeper pages use a window with a margin.
    const exact = offset + size + 30 <= 250;
    const start = exact ? 0 : Math.max(0, offset - 30);
    const span = exact ? offset + size + 30 : Math.min(250, size + 60);
    const [a, b] = await Promise.all([run(CAP_A, start, span), run(CAP_B, start, span)]);
    const merged = new Map<string, Json>();
    for (const q of [...a.quotes, ...b.quotes]) if (!merged.has(q.symbol)) merged.set(q.symbol, q);
    const all = [...merged.values()];
    await fillMarketCaps(all, 25);
    const cap = (q: Json) => num(q.marketCap);
    all.sort((x, y) => {
      const cx = cap(x);
      const cy = cap(y);
      if (cx === null && cy === null) return 0;
      if (cx === null) return 1;
      if (cy === null) return -1;
      return asc ? cx - cy : cy - cx;
    });
    quotes = all.slice(offset - start, offset - start + size);
    total = Math.max(a.total, b.total);
  } else {
    const res = await run(SCREEN_FIELDS[sortKey], offset, size);
    quotes = res.quotes;
    total = res.total;
    await fillMarketCaps(quotes, 15);
  }
  return { maxAge: 600, body: { total, offset, quotes, asOf: Date.now() } };
}

/* ---------- router ---------- */

const OPS: Record<string, (q: URLSearchParams) => Promise<{ maxAge: number; body: unknown }>> = {
  chart: opChart,
  quote: opQuote,
  search: opSearch,
  summary: opSummary,
  fundamentals: opFundamentals,
  financials: opFinancials,
  screen: opScreen,
};

/** Web-standard request handler shared by the Netlify Function and the Vite dev server. */
export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const op = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const json = (status: number, body: unknown, maxAge = 0) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
        // cache at Netlify's edge, keyed on the full query string so each symbol and range is stored separately
        ...(maxAge > 0 ? { 'Netlify-CDN-Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}`, 'Netlify-Vary': 'query' } : {}),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  if (req.method !== 'GET') return json(405, { error: 'Only GET is supported.' });
  // This gateway exists for this site only: refuse requests that other websites make from a browser.
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json(403, { error: 'Cross-site requests are not allowed.' });
  if (op === 'health') return json(200, { ok: true, time: Date.now() });
  const fn = OPS[op];
  if (!fn) return json(404, { error: 'Unknown data operation.' });
  try {
    const { body, maxAge } = await fn(url.searchParams);
    return json(200, body, maxAge);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: e.message });
    console.error('api error', op, e);
    return json(500, { error: 'Something went wrong while fetching data.' });
  }
}
