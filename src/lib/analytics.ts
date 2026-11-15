/** Shared recipe: load a basket of symbols (plus a benchmark), align it, and compute risk and return statistics. */
import type { Range } from './data/api';
import { align, blend, loadSeriesIn, type Aligned, type Daily } from './data/series';
import { performance, type Performance } from './finance/backtest';
import { diversificationRatio, riskContributions } from './finance/optimize';
import { correlationFromCov, covarianceMatrix, historicalVar, regress, tracking, type Regression, type VarResult } from './finance/stats';

export interface Basket {
  symbols: string[];
  names: string[];
  /** aligned total-return levels: one column per symbol, then the benchmark (if any) as the last column */
  aligned: Aligned;
  hasBenchmark: boolean;
  benchmark: string | null;
  failed: { symbol: string; error: string }[];
  /** currencies that were converted into the base currency */
  converted: string[];
}

export async function loadBasket(symbols: string[], range: Range, currency: string, benchmark?: string | null): Promise<Basket> {
  const want = benchmark && !symbols.includes(benchmark) ? [...symbols, benchmark] : symbols;
  const { series, failed, converted } = await loadSeriesIn(want, range, currency);
  const bySymbol = new Map(series.map((s) => [s.symbol, s]));
  const okSymbols = symbols.filter((s) => bySymbol.has(s));
  const bench = benchmark ? bySymbol.get(benchmark) : undefined;
  const cols: Daily[] = okSymbols.map((s) => bySymbol.get(s)!);
  const useBench = !!bench && !symbols.includes(benchmark!);
  if (useBench) cols.push(bench!);
  return {
    symbols: okSymbols,
    names: okSymbols.map((s) => bySymbol.get(s)!.name),
    aligned: align(cols, 'adj'),
    hasBenchmark: useBench,
    benchmark: bench ? benchmark! : null,
    failed: failed.filter((f) => symbols.includes(f.symbol) || f.symbol === benchmark),
    converted,
  };
}

export interface BasketStats {
  dates: string[];
  /** growth of 1 for the weighted mix (rebalanced to the weights every day) */
  index: number[];
  benchIndex: number[] | null;
  perf: Performance | null;
  benchPerf: Performance | null;
  regression: Regression | null;
  tracking: { trackingError: number; informationRatio: number } | null;
  var95: VarResult | null;
  var99: VarResult | null;
  /** annualised covariance and correlation between the assets */
  cov: number[][];
  corr: number[][];
  riskShare: number[];
  diversification: number;
  /** annualised volatility of each asset on its own */
  assetVol: number[];
  returns: number[];
  observations: number;
}

/** Statistics of a fixed-weight mix. `weights` are normalised to sum to 1. */
export function basketStats(b: Basket, weights: number[], rf: number): BasketStats | null {
  const n = b.symbols.length;
  const T = b.aligned.dates.length;
  if (!n || T < 30) return null;
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return null;
  const w = weights.map((x) => x / sum);
  const assetsOnly: Aligned = { dates: b.aligned.dates, matrix: b.aligned.matrix.map((row) => row.slice(0, n)), limitedBy: b.aligned.limitedBy };
  const index = blend(assetsOnly, w);
  const returns: number[] = [];
  for (let t = 1; t < T; t++) returns.push(index[t] / index[t - 1] - 1);
  const rows: number[][] = [];
  for (let t = 1; t < T; t++) rows.push(assetsOnly.matrix[t].map((v, i) => v / assetsOnly.matrix[t - 1][i] - 1));
  const cov = covarianceMatrix(rows).map((r) => r.map((v) => v * 252));
  let benchIndex: number[] | null = null;
  let benchReturns: number[] | null = null;
  if (b.hasBenchmark) {
    const base = b.aligned.matrix[0][n];
    benchIndex = b.aligned.matrix.map((row) => row[n] / base);
    benchReturns = [];
    for (let t = 1; t < T; t++) benchReturns.push(benchIndex[t] / benchIndex[t - 1] - 1);
  }
  return {
    dates: b.aligned.dates,
    index,
    benchIndex,
    perf: performance(b.aligned.dates, index, rf),
    benchPerf: benchIndex ? performance(b.aligned.dates, benchIndex, rf) : null,
    regression: benchReturns ? regress(returns, benchReturns, 252, rf) : null,
    tracking: benchReturns ? tracking(returns, benchReturns, 252) : null,
    var95: historicalVar(returns, 0.95),
    var99: historicalVar(returns, 0.99),
    cov,
    corr: correlationFromCov(cov),
    riskShare: riskContributions(w, cov),
    diversification: diversificationRatio(w, cov),
    assetVol: cov.map((r, i) => Math.sqrt(r[i])),
    returns,
    observations: returns.length,
  };
}
