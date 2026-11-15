/** Turning raw charts into aligned daily series that the analytics engines can use. */
import { chartDates, getChart, type Chart, type Range } from './api';
import { fxSymbol } from './symbols';

export interface Daily {
  symbol: string;
  name: string;
  currency: string | null;
  dates: string[];
  /** split-adjusted close */
  close: number[];
  /** split- and dividend-adjusted close (total return) */
  adj: number[];
}

export function toDaily(chart: Chart): Daily {
  const raw = chartDates(chart);
  const dates: string[] = [];
  const close: number[] = [];
  const adj: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (dates.length && dates[dates.length - 1] === raw[i]) {
      close[close.length - 1] = chart.c[i];
      adj[adj.length - 1] = chart.adj[i];
    } else {
      dates.push(raw[i]);
      close.push(chart.c[i]);
      adj.push(chart.adj[i]);
    }
  }
  return { symbol: chart.symbol, name: chart.name, currency: chart.currency, dates, close, adj };
}

export interface Aligned {
  dates: string[];
  /** matrix[t][i]: level of series i on dates[t] */
  matrix: number[][];
  /** the series that starts last and therefore sets the common window */
  limitedBy: string | null;
}

/**
 * Put several series on one calendar. The window starts when the last series starts;
 * days when one market is closed carry its previous value forward.
 */
export function align(list: Daily[], field: 'adj' | 'close' = 'adj'): Aligned {
  const live = list.filter((s) => s.dates.length);
  if (!live.length || live.length !== list.length) return { dates: [], matrix: [], limitedBy: null };
  let start = '';
  let earliest = '9999';
  let limitedBy: string | null = null;
  for (const s of live) {
    if (s.dates[0] < earliest) earliest = s.dates[0];
    if (s.dates[0] > start) {
      start = s.dates[0];
      limitedBy = s.symbol;
    }
  }
  // only call a series "limiting" when it starts meaningfully later than the rest
  if (Date.parse(start) - Date.parse(earliest) < 20 * 86_400_000) limitedBy = null;
  const all = new Set<string>();
  for (const s of live) for (const d of s.dates) if (d >= start) all.add(d);
  const dates = [...all].sort();
  const cols = live.map((s) => {
    const out: number[] = [];
    let k = 0;
    let last = NaN;
    for (const d of dates) {
      while (k < s.dates.length && s.dates[k] <= d) last = s[field][k++];
      out.push(last);
    }
    return out;
  });
  const matrix = dates.map((_, t) => cols.map((c) => c[t]));
  return { dates, matrix, limitedBy: live.length > 1 ? limitedBy : null };
}

export type Frequency = 'daily' | 'weekly' | 'monthly';
export const PERIODS_PER_YEAR: Record<Frequency, number> = { daily: 252, weekly: 52, monthly: 12 };

/** Keep the last observation of each week or month. */
export function resample(a: Aligned, freq: Frequency): Aligned {
  if (freq === 'daily') return a;
  const key = (d: string) => {
    if (freq === 'monthly') return d.slice(0, 7);
    const t = Date.parse(d + 'T00:00:00Z');
    return String(Math.floor((t / 86_400_000 + 3) / 7)); // weeks ending Sunday
  };
  const dates: string[] = [];
  const matrix: number[][] = [];
  for (let i = 0; i < a.dates.length; i++) {
    if (i === a.dates.length - 1 || key(a.dates[i]) !== key(a.dates[i + 1])) {
      dates.push(a.dates[i]);
      matrix.push(a.matrix[i]);
    }
  }
  return { dates, matrix, limitedBy: a.limitedBy };
}

/** Period returns from an aligned level matrix: rows[t][i]. */
export function returnsMatrix(a: Aligned): number[][] {
  const out: number[][] = [];
  for (let t = 1; t < a.matrix.length; t++) out.push(a.matrix[t].map((v, i) => v / a.matrix[t - 1][i] - 1));
  return out;
}

/** Growth-of-1 index of a fixed-weight, daily-rebalanced mix of the aligned series. */
export function blend(a: Aligned, weights: number[]): number[] {
  const out = [1];
  for (let t = 1; t < a.matrix.length; t++) {
    let r = 0;
    for (let i = 0; i < weights.length; i++) r += weights[i] * (a.matrix[t][i] / a.matrix[t - 1][i] - 1);
    out.push(out[t - 1] * (1 + r));
  }
  return out;
}

/** Fetch daily history for several symbols at once. Failures are reported per symbol, never hidden. */
export async function loadSeries(symbols: string[], range: Range): Promise<{ series: Daily[]; failed: { symbol: string; error: string }[] }> {
  const unique = [...new Set(symbols)];
  const settled = await Promise.allSettled(unique.map((s) => getChart(s, range, '1d')));
  const series: Daily[] = [];
  const failed: { symbol: string; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.c.length > 1) series.push(toDaily(r.value));
    else failed.push({ symbol: unique[i], error: r.status === 'rejected' ? (r.reason as Error).message : 'No price history' });
  });
  return { series, failed };
}

/** Convert a series into another currency using daily exchange rates (last known rate carried forward). */
export function convert(series: Daily, fx: Daily, toCurrency: string): Daily {
  const close: number[] = [];
  const adj: number[] = [];
  let k = 0;
  let rate = fx.close[0];
  for (let i = 0; i < series.dates.length; i++) {
    while (k < fx.dates.length && fx.dates[k] <= series.dates[i]) rate = fx.close[k++];
    close.push(series.close[i] * rate);
    adj.push(series.adj[i] * rate);
  }
  return { ...series, currency: toCurrency, close, adj };
}

/** Load series and express every one in `currency`, fetching exchange-rate history where needed. */
export async function loadSeriesIn(symbols: string[], range: Range, currency: string) {
  const { series, failed } = await loadSeries(symbols, range);
  const needed = [...new Set(series.map((s) => s.currency).filter((c): c is string => !!c && c !== currency))];
  if (!needed.length) return { series, failed, converted: [] as string[] };
  const fx = await loadSeries(needed.map((c) => fxSymbol(c, currency)), range);
  const byCcy = new Map(needed.map((c) => [c, fx.series.find((f) => f.symbol === fxSymbol(c, currency))]));
  const out: Daily[] = [];
  for (const s of series) {
    if (!s.currency || s.currency === currency) out.push(s);
    else {
      const rate = byCcy.get(s.currency);
      if (rate) out.push(convert(s, rate, currency));
      else failed.push({ symbol: s.symbol, error: `No ${s.currency}/${currency} exchange-rate history` });
    }
  }
  return { series: out, failed, converted: needed };
}
