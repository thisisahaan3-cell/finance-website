/**
 * Browser client for the market-data gateway (/api/*), with a two-level cache:
 * memory for the session and IndexedDB across sessions. Every result carries the
 * time it was fetched so pages can show how fresh the data is.
 */

export interface Chart {
  symbol: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  type: string | null;
  tz: string | null;
  gmtoffset: number;
  price: number | null;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52: number | null;
  low52: number | null;
  volume: number | null;
  marketTime: number | null;
  firstTrade: number | null;
  interval: string;
  t: number[];
  c: number[];
  adj: number[];
  v: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  div: [number, number][];
  split: [number, number, number][];
  fetchedAt: number;
}

export interface Quote {
  symbol: string;
  shortName?: string;
  longName?: string;
  quoteType?: string;
  currency?: string | null;
  exchange?: string;
  fullExchangeName?: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  epsTrailingTwelveMonths?: number;
  epsForward?: number;
  bookValue?: number;
  /** percent, e.g. 1.25 = 1.25% */
  dividendYield?: number;
  dividendRate?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  /** percent */
  fiftyTwoWeekChangePercent?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  averageDailyVolume3Month?: number;
  sharesOutstanding?: number;
  averageAnalystRating?: string;
  exchangeDataDelayedBy?: number;
  financialCurrency?: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  exchangeCode: string;
  type: string;
  sector: string | null;
  industry: string | null;
}

type Dict = Record<string, any>;

export interface Summary {
  symbol: string;
  price: Dict;
  profile: Dict;
  detail: Dict;
  stats: Dict;
  fin: Dict;
  nextEarnings: number | null;
  asOf: number;
}

export interface StatementTable {
  dates: string[];
  items: Record<string, (number | null)[]>;
}

export interface Financials {
  symbol: string;
  currency: string | null;
  annual: StatementTable;
  quarterly: StatementTable;
  ttm: Record<string, number | null>;
  ttmDate: string | null;
  asOf: number;
}

export interface Fundamentals {
  symbol: string;
  ok: boolean;
  error?: string;
  sector?: string | null;
  industry?: string | null;
  roe?: number | null;
  roa?: number | null;
  debtToEquity?: number | null;
  profitMargin?: number | null;
  operatingMargin?: number | null;
  grossMargin?: number | null;
  ebitdaMargin?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  currentRatio?: number | null;
  freeCashflow?: number | null;
  totalRevenue?: number | null;
  evToEbitda?: number | null;
  evToRevenue?: number | null;
  peg?: number | null;
  beta?: number | null;
  payoutRatio?: number | null;
  dividendYield?: number | null;
  marketCap?: number | null;
  trailingPE?: number | null;
  priceToBook?: number | null;
  priceToSales?: number | null;
  heldByInsiders?: number | null;
  financialCurrency?: string | null;
  name?: string | null;
  currency?: string | null;
}

export interface ScreenSpec {
  market: 'NSE' | 'BSE' | 'US' | 'UK';
  sectors?: string[];
  filters?: { field: string; min?: number | null; max?: number | null }[];
  sort?: string;
  dir?: 'asc' | 'desc';
  offset?: number;
  size?: number;
}

export interface ScreenResult {
  total: number;
  offset: number;
  quotes: Quote[];
  asOf: number;
}

export class DataError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ---------- cache ---------- */

interface Entry {
  at: number;
  data: unknown;
}
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

const DB_NAME = 'artha-cache';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function dbGet(key: string): Promise<Entry | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Entry) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbSet(key: string, entry: Entry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key);
  } catch {
    /* storage full or unavailable: the memory cache still works */
  }
}

/** Remove all cached market data (Settings → Clear cached data). */
export async function clearCache(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const MIN = 60_000;

async function request<T>(path: string, ttl: number, opts: { force?: boolean } = {}): Promise<T & { fetchedAt: number }> {
  const now = Date.now();
  const stamp = (e: Entry) => ({ ...(e.data as object), fetchedAt: e.at }) as T & { fetchedAt: number };
  if (!opts.force) {
    const hit = memory.get(path);
    if (hit && now - hit.at < ttl) return stamp(hit);
    const stored = await dbGet(path);
    if (stored && now - stored.at < ttl) {
      memory.set(path, stored);
      return stamp(stored);
    }
  }
  const running = inflight.get(path);
  if (running) return running as Promise<T & { fetchedAt: number }>;
  const job = (async () => {
    let res: Response;
    try {
      res = await fetch('/api/' + path, { headers: { Accept: 'application/json' } });
    } catch {
      const stale = memory.get(path) ?? (await dbGet(path));
      if (stale) return stamp(stale); // offline: show the last saved copy rather than nothing
      throw new DataError(0, 'Could not reach the data service. Check your internet connection and try again.');
    }
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body) throw new DataError(res.status, body?.error ?? `The data service returned an error (${res.status}).`);
    const entry = { at: Date.now(), data: body };
    memory.set(path, entry);
    void dbSet(path, entry);
    return stamp(entry);
  })();
  inflight.set(path, job);
  try {
    return (await job) as T & { fetchedAt: number };
  } finally {
    inflight.delete(path);
  }
}

/* ---------- operations ---------- */

export type Range = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'ytd' | 'max';

export function getChart(symbol: string, range: Range = '1y', interval = '1d', force = false): Promise<Chart> {
  const intraday = interval !== '1d' && interval !== '1wk' && interval !== '1mo';
  return request<Chart>(`chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`, intraday ? 2 * MIN : 15 * MIN, { force });
}

/** Closing price on (or the last trading day before) an ISO date, in the listing's own currency. Null when unavailable. */
export async function getCloseOn(symbol: string, iso: string): Promise<number | null> {
  const day = Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);
  if (!Number.isFinite(day)) return null;
  try {
    const chart = await request<Chart>(`chart?symbol=${encodeURIComponent(symbol)}&interval=1d&p1=${day - 10 * 86400}&p2=${day + 2 * 86400}`, 30 * 24 * 60 * MIN);
    const dates = chartDates(chart);
    let found: number | null = null;
    for (let i = 0; i < dates.length; i++) if (dates[i] <= iso) found = chart.c[i];
    return found;
  } catch {
    return null;
  }
}

export async function getQuotes(symbols: string[], force = false): Promise<{ quotes: Record<string, Quote>; fetchedAt: number }> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const out: Record<string, Quote> = {};
  let fetchedAt = Date.now();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await request<{ quotes: Quote[] }>(`quote?symbols=${batch.map(encodeURIComponent).join(',')}`, 2 * MIN, { force });
    for (const q of res.quotes) out[q.symbol] = q;
    fetchedAt = Math.min(fetchedAt, res.fetchedAt);
  }
  return { quotes: out, fetchedAt };
}

export async function searchSymbols(q: string): Promise<SearchResult[]> {
  const term = q.trim();
  if (!term) return [];
  return (await request<{ results: SearchResult[] }>(`search?q=${encodeURIComponent(term)}`, 24 * 60 * MIN)).results;
}

export const getSummary = (symbol: string, force = false): Promise<Summary & { fetchedAt: number }> =>
  request<Summary>(`summary?symbol=${encodeURIComponent(symbol)}`, 6 * 60 * MIN, { force });

export const getFinancials = (symbol: string, force = false): Promise<Financials & { fetchedAt: number }> =>
  request<Financials>(`financials?symbol=${encodeURIComponent(symbol)}`, 24 * 60 * MIN, { force });

export async function getFundamentals(symbols: string[]): Promise<Record<string, Fundamentals>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const out: Record<string, Fundamentals> = {};
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20).sort();
    jobs.push(
      request<{ rows: Fundamentals[] }>(`fundamentals?symbols=${batch.map(encodeURIComponent).join(',')}`, 12 * 60 * MIN).then((res) => {
        for (const row of res.rows) out[row.symbol] = row;
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}

export const screen = (spec: ScreenSpec, force = false): Promise<ScreenResult & { fetchedAt: number }> =>
  request<ScreenResult>(`screen?q=${encodeURIComponent(JSON.stringify(spec))}`, 10 * MIN, { force });

/* ---------- helpers on chart data ---------- */

/** Exchange-local ISO date for each bar. */
export function chartDates(chart: Pick<Chart, 't' | 'gmtoffset'>): string[] {
  return chart.t.map((t) => new Date((t + chart.gmtoffset) * 1000).toISOString().slice(0, 10));
}

/** Latest price with change against the previous session's close, from daily bars. */
export function lastChange(chart: Chart): { price: number | null; prev: number | null; change: number | null; changePct: number | null } {
  const n = chart.c.length;
  const price = chart.price ?? (n ? chart.c[n - 1] : null);
  if (price === null || n < 2) return { price, prev: null, change: null, changePct: null };
  const dates = chartDates(chart);
  const marketDate = chart.marketTime ? new Date((chart.marketTime + chart.gmtoffset) * 1000).toISOString().slice(0, 10) : dates[n - 1];
  // if the final bar is the current session, the previous close is the bar before it
  const prev = dates[n - 1] >= marketDate ? chart.c[n - 2] : chart.c[n - 1];
  return { price, prev, change: price - prev, changePct: prev > 0 ? price / prev - 1 : null };
}
