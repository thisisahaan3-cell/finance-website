/** Glue between saved portfolios and live market data. */
import { getCloseOn, getFundamentals, getQuotes, type Quote } from './data/api';
import { fxSymbol } from './data/symbols';
import type { Daily } from './data/series';
import { buildLedger, valuePortfolio, type Ledger, type PriceInfo, type Txn, type Valuation } from './finance/portfolio';
import { todayIso } from './format';
import { getState, rememberMeta, uid, type Portfolio } from './store';

export interface Live {
  ledger: Ledger;
  valuation: Valuation;
  quotes: Record<string, Quote>;
  /** portfolio currency per 1 unit of each foreign currency */
  fx: Record<string, number>;
  fetchedAt: number;
  /** symbols whose live price could not be fetched */
  missing: string[];
}

/** Value a portfolio with live prices, converting foreign holdings at today's exchange rate. */
export async function loadLive(p: Portfolio, force = false): Promise<Live> {
  const ledger = buildLedger(p.txns);
  const symbols = Object.values(ledger.holdings).filter((h) => h.qty > 1e-9).map((h) => h.symbol);
  if (!symbols.length) return { ledger, valuation: valuePortfolio(ledger, {}, p.cash, todayIso()), quotes: {}, fx: {}, fetchedAt: Date.now(), missing: [] };
  const { quotes, fetchedAt } = await getQuotes(symbols, force);
  const foreign = [...new Set(Object.values(quotes).map((q) => q.currency).filter((c): c is string => !!c && c !== p.currency))];
  const fx: Record<string, number> = {};
  if (foreign.length) {
    const res = await getQuotes(foreign.map((c) => fxSymbol(c, p.currency)), force);
    for (const c of foreign) {
      const rate = res.quotes[fxSymbol(c, p.currency)]?.regularMarketPrice;
      if (rate && rate > 0) fx[c] = rate;
    }
  }
  const prices: Record<string, PriceInfo> = {};
  const missing: string[] = [];
  for (const s of symbols) {
    const q = quotes[s];
    const rate = !q?.currency || q.currency === p.currency ? 1 : fx[q.currency];
    if (q && q.regularMarketPrice && q.regularMarketPrice > 0 && rate) {
      prices[s] = { price: q.regularMarketPrice, prevClose: q.regularMarketPreviousClose ?? null, fx: rate };
      rememberMeta(s, { name: q.longName ?? q.shortName ?? s, currency: q.currency ?? null, marketCap: q.marketCap ?? null, type: q.quoteType ?? null });
    } else missing.push(s);
  }
  return { ledger, valuation: valuePortfolio(ledger, prices, p.cash, todayIso()), quotes, fx, fetchedAt, missing };
}

/** Fill in sector, industry and market cap for symbols we have not classified yet (cached for reuse). */
export async function ensureClassified(symbols: string[]): Promise<void> {
  const meta = getState().symbolMeta;
  const need = symbols.filter((s) => {
    const m = meta[s];
    if (m?.type && m.type !== 'EQUITY') return false;
    return !m?.sector || !m.marketCap;
  });
  if (!need.length) return;
  try {
    const rows = await getFundamentals(need);
    for (const s of need) {
      const r = rows[s];
      if (r?.ok) rememberMeta(s, { name: r.name ?? meta[s]?.name ?? s, sector: r.sector ?? null, industry: r.industry ?? null, marketCap: r.marketCap ?? null, currency: r.currency ?? meta[s]?.currency ?? null });
    }
  } catch {
    /* classification is a nicety; holdings still work without it */
  }
}

/** Exchange-traded and index funds: the provider often labels Indian ETFs as plain equities, so the name is checked too. */
export const isFund = (symbol: string): boolean => {
  const m = getState().symbolMeta[symbol];
  if (!m) return false;
  if (m.type === 'ETF' || m.type === 'MUTUALFUND') return true;
  return !m.sector && /\b(ETF|BEES|FUND|INDEX)\b|BeES/i.test(m.name ?? '');
};

export const sectorOf = (symbol: string): string => {
  const m = getState().symbolMeta[symbol];
  if (m?.sector) return m.sector;
  if (isFund(symbol)) return 'ETF / fund';
  if (m?.type && m.type !== 'EQUITY') return 'Other';
  return 'Unclassified';
};

export const nameOf = (symbol: string): string => getState().symbolMeta[symbol]?.name ?? symbol;

/** Exchange rate (portfolio currency per unit of `ccy`) on a past date; null if unavailable. */
export async function fxOn(ccy: string, portfolioCcy: string, iso: string): Promise<number | null> {
  if (ccy === portfolioCcy) return 1;
  return getCloseOn(fxSymbol(ccy, portfolioCcy), iso);
}

/** Pick a chart range long enough to cover everything since `iso`. */
export function rangeSince(iso: string): '1y' | '2y' | '5y' | '10y' | 'max' {
  const years = (Date.now() - Date.parse(iso + 'T00:00:00Z')) / (365.25 * 86_400_000);
  return years < 0.9 ? '1y' : years < 1.9 ? '2y' : years < 4.9 ? '5y' : years < 9.9 ? '10y' : 'max';
}

/** One shared calendar from `from` onwards with each symbol's close carried forward (NaN before its first print). */
export function calendarPrices(series: Daily[], from: string): { dates: string[]; prices: Record<string, number[]> } {
  const all = new Set<string>();
  for (const s of series) for (const d of s.dates) if (d >= from) all.add(d);
  const dates = [...all].sort();
  const prices: Record<string, number[]> = {};
  for (const s of series) {
    const out: number[] = [];
    let k = 0;
    let last = NaN;
    for (const d of dates) {
      while (k < s.dates.length && s.dates[k] <= d) last = s.close[k++];
      out.push(last);
    }
    prices[s.symbol] = out;
  }
  return { dates, prices };
}

const isoDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * A ready-made example portfolio so a newcomer can explore every tab at once.
 * The trades are hypothetical, but each is priced at the stock's real closing price on its trade date.
 */
export async function buildSampleTxns(): Promise<Txn[]> {
  const plan: [string, number, number][] = [
    ['RELIANCE.NS', 20, 540],
    ['HDFCBANK.NS', 30, 540],
    ['TCS.NS', 8, 540],
    ['INFY.NS', 25, 400],
    ['ITC.NS', 100, 400],
    ['LT.NS', 10, 400],
    ['SUNPHARMA.NS', 20, 250],
    ['BHARTIARTL.NS', 20, 250],
    ['NIFTYBEES.NS', 150, 250],
    ['HDFCBANK.NS', 15, 120],
  ];
  const txns: Txn[] = [];
  await Promise.all(
    plan.map(async ([symbol, qty, daysAgo]) => {
      const date = isoDaysAgo(daysAgo);
      const price = await getCloseOn(symbol, date);
      if (price && price > 0) txns.push({ id: uid(), date, type: 'buy', symbol, qty, price, fees: 0, fx: 1, note: 'Example trade' });
    }),
  );
  return txns.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Default listing suffix for a bare ticker typed into an Indian portfolio. */
export function normaliseSymbol(raw: string, currency: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return s;
  if (s.includes('.') || s.startsWith('^') || s.includes('=')) return s;
  return currency === 'INR' ? s + '.NS' : s;
}
