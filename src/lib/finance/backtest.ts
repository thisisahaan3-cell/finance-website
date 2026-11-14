/**
 * Portfolio backtesting on historical total-return price levels, plus the performance
 * statistics shared by the backtester, stock research and the portfolio studio.
 */
import { annualVol, drawdown, downsideDeviation, mean } from './stats';
import { xirr, type DatedFlow } from './tvm';

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(iso + 'T00:00:00Z');

export interface Performance {
  start: string;
  end: string;
  years: number;
  totalReturn: number;
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  drawdownPeak: string;
  drawdownTrough: string;
  drawdownRecovery: string | null;
  calmar: number;
  bestYear: { year: number; ret: number } | null;
  worstYear: { year: number; ret: number } | null;
  yearly: { year: number; ret: number; partial: boolean }[];
  positiveMonths: number;
  periodsPerYear: number;
}

/** Calendar-year returns of a level series. A year is `partial` when the data does not cover all of it. */
export function yearlyReturns(dates: string[], levels: number[]): { year: number; ret: number; partial: boolean }[] {
  const out: { year: number; ret: number; partial: boolean }[] = [];
  if (dates.length < 2) return out;
  let startLevel = levels[0];
  let year = Number(dates[0].slice(0, 4));
  const firstYear = year;
  for (let i = 1; i < dates.length; i++) {
    const y = Number(dates[i].slice(0, 4));
    if (y !== year) {
      out.push({ year, ret: levels[i - 1] / startLevel - 1, partial: year === firstYear && dates[0].slice(5) > '01-10' });
      startLevel = levels[i - 1];
      year = y;
    }
  }
  const lastDate = dates[dates.length - 1];
  out.push({
    year,
    ret: levels[levels.length - 1] / startLevel - 1,
    partial: lastDate.slice(5) < '12-20' || (year === firstYear && dates[0].slice(5) > '01-10'),
  });
  return out;
}

/** Month-end returns of a level series, keyed "YYYY-MM". */
export function monthlyReturns(dates: string[], levels: number[]): { month: string; ret: number }[] {
  const out: { month: string; ret: number }[] = [];
  if (dates.length < 2) return out;
  let startLevel = levels[0];
  let month = dates[0].slice(0, 7);
  for (let i = 1; i < dates.length; i++) {
    const m = dates[i].slice(0, 7);
    if (m !== month) {
      out.push({ month, ret: levels[i - 1] / startLevel - 1 });
      startLevel = levels[i - 1];
      month = m;
    }
  }
  out.push({ month, ret: levels[levels.length - 1] / startLevel - 1 });
  return out;
}

/** Risk and return statistics for a level series (prices, NAV or growth of ₹1). `rf` is an annual rate. */
export function performance(dates: string[], levels: number[], rf = 0): Performance | null {
  const n = Math.min(dates.length, levels.length);
  if (n < 3 || !(levels[0] > 0)) return null;
  const years = (toMs(dates[n - 1]) - toMs(dates[0])) / (365.25 * DAY);
  if (!(years > 0)) return null;
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(levels[i] / levels[i - 1] - 1);
  const periods = Math.max(1, Math.round(rets.length / years));
  const totalReturn = levels[n - 1] / levels[0] - 1;
  const cagr = Math.pow(levels[n - 1] / levels[0], 1 / years) - 1;
  const vol = annualVol(rets, periods);
  const excess = mean(rets) * periods - rf;
  const dd = drawdown(levels.slice(0, n));
  const downside = downsideDeviation(rets, periods, rf / periods);
  const yearly = yearlyReturns(dates.slice(0, n), levels.slice(0, n));
  const full = yearly.filter((y) => !y.partial);
  const monthly = monthlyReturns(dates.slice(0, n), levels.slice(0, n));
  const pick = (cmp: (a: number, b: number) => boolean) =>
    full.length ? full.reduce((best, y) => (cmp(y.ret, best.ret) ? y : best), full[0]) : null;
  return {
    start: dates[0],
    end: dates[n - 1],
    years,
    totalReturn,
    cagr,
    volatility: vol,
    sharpe: vol > 0 ? excess / vol : NaN,
    sortino: downside > 0 ? excess / downside : NaN,
    maxDrawdown: dd.maxDrawdown,
    drawdownPeak: dates[dd.peakIndex],
    drawdownTrough: dates[dd.troughIndex],
    drawdownRecovery: dd.recoveryIndex === null ? null : dates[dd.recoveryIndex],
    calmar: dd.maxDrawdown < 0 ? cagr / -dd.maxDrawdown : NaN,
    bestYear: pick((a, b) => a > b),
    worstYear: pick((a, b) => a < b),
    yearly,
    positiveMonths: monthly.length ? monthly.filter((m) => m.ret > 0).length / monthly.length : NaN,
    periodsPerYear: periods,
  };
}

/** Annualised return over every rolling window of `windowYears`. */
export function rollingReturns(dates: string[], levels: number[], windowYears: number): { date: string; ret: number }[] {
  const out: { date: string; ret: number }[] = [];
  const span = windowYears * 365.25 * DAY;
  let j = 0;
  for (let i = 0; i < dates.length; i++) {
    const t = toMs(dates[i]);
    while (j < i && t - toMs(dates[j + 1]) >= span) j++;
    if (t - toMs(dates[j]) >= span - 4 * DAY && levels[j] > 0) {
      const yrs = (t - toMs(dates[j])) / (365.25 * DAY);
      out.push({ date: dates[i], ret: Math.pow(levels[i] / levels[j], 1 / yrs) - 1 });
    }
  }
  return out;
}

export type RebalanceRule = 'none' | 'monthly' | 'quarterly' | 'yearly' | 'threshold';

export interface BacktestInput {
  /** ISO dates, ascending */
  dates: string[];
  /** prices[t][i]: total-return level of asset i on date t (no gaps) */
  prices: number[][];
  /** target weights, summing to 1 */
  weights: number[];
  initial: number;
  /** added on the first trading day of every month after the start */
  monthlyContribution?: number;
  rebalance: RebalanceRule;
  /** for 'threshold': rebalance when any weight drifts this far (absolute) from target */
  threshold?: number;
  /** trading cost in basis points of the value traded (brokerage, taxes, impact) */
  costBps?: number;
}

export interface BacktestResult {
  dates: string[];
  /** portfolio value in currency, including contributions */
  value: number[];
  /** cumulative money put in */
  invested: number[];
  /** time-weighted growth of 1 (contributions do not distort it) */
  nav: number[];
  finalWeights: number[];
  rebalances: number;
  totalCosts: number;
  /** money-weighted annual return, meaningful when there are contributions */
  xirr: number | null;
  performance: Performance | null;
}

export function backtest(input: BacktestInput, rf = 0): BacktestResult {
  const { dates, prices, weights } = input;
  const T = dates.length;
  const N = weights.length;
  if (T < 2) throw new Error('Not enough price history to run a backtest.');
  const wSum = weights.reduce((s, v) => s + v, 0);
  if (Math.abs(wSum - 1) > 1e-6) throw new Error('Weights must add up to 100%.');
  const c = (input.costBps ?? 0) / 10_000;
  const contribution = input.monthlyContribution ?? 0;
  const threshold = input.threshold ?? 0.05;

  const h = weights.map((w) => input.initial * w * (1 - c));
  let totalCosts = input.initial * c;
  const value: number[] = [h.reduce((s, v) => s + v, 0)];
  const invested: number[] = [input.initial];
  const nav: number[] = [1 - c];
  const flows: DatedFlow[] = [{ date: dates[0], amount: -input.initial }];
  let rebalances = 0;

  for (let t = 1; t < T; t++) {
    let before = 0;
    let after = 0;
    for (let i = 0; i < N; i++) {
      before += h[i];
      h[i] *= prices[t][i] / prices[t - 1][i];
      after += h[i];
    }
    let level = nav[t - 1] * (before > 0 ? after / before : 1);
    let v = after;
    let put = invested[t - 1];

    const newMonth = dates[t].slice(0, 7) !== dates[t - 1].slice(0, 7);
    if (newMonth && contribution > 0) {
      const cost = contribution * c;
      for (let i = 0; i < N; i++) h[i] += (contribution - cost) * weights[i];
      level *= (v + contribution - cost) / (v + contribution);
      v += contribution - cost;
      put += contribution;
      totalCosts += cost;
      flows.push({ date: dates[t], amount: -contribution });
    }

    let due = false;
    if (input.rebalance === 'monthly') due = newMonth;
    else if (input.rebalance === 'quarterly') due = newMonth && (Number(dates[t].slice(5, 7)) - 1) % 3 === 0;
    else if (input.rebalance === 'yearly') due = dates[t].slice(0, 4) !== dates[t - 1].slice(0, 4);
    else if (input.rebalance === 'threshold') due = v > 0 && h.some((hv, i) => Math.abs(hv / v - weights[i]) > threshold);
    if (due && v > 0) {
      let traded = 0;
      for (let i = 0; i < N; i++) traded += Math.abs(v * weights[i] - h[i]);
      if (traded > v * 1e-9) {
        const cost = traded * c;
        const net = v - cost;
        for (let i = 0; i < N; i++) h[i] = net * weights[i];
        level *= net / v;
        v = net;
        totalCosts += cost;
        rebalances++;
      }
    }
    value.push(v);
    invested.push(put);
    nav.push(level);
  }

  const finalValue = value[T - 1];
  flows.push({ date: dates[T - 1], amount: finalValue });
  return {
    dates,
    value,
    invested,
    nav,
    finalWeights: h.map((hv) => (finalValue > 0 ? hv / finalValue : 0)),
    rebalances,
    totalCosts,
    xirr: xirr(flows).rate,
    performance: performance(dates, nav, rf),
  };
}
