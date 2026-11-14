/**
 * Statistics for return series: risk, drawdowns, regression, covariance estimation.
 * Returns are simple periodic returns as decimals unless a function says otherwise.
 */

export const mean = (x: number[]): number => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);

/** Sample variance (n − 1). */
export function variance(x: number[]): number {
  if (x.length < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (x.length - 1);
}

export const stdev = (x: number[]): number => Math.sqrt(variance(x));

export function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

export function correlation(x: number[], y: number[]): number {
  const c = covariance(x, y);
  const d = stdev(x) * stdev(y);
  return d > 0 ? c / d : NaN;
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(x: number[], p: number): number {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const idx = Math.min(Math.max(p, 0), 1) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function skewness(x: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const m = mean(x);
  const sd = stdev(x);
  if (!(sd > 0)) return NaN;
  let s = 0;
  for (const v of x) s += Math.pow((v - m) / sd, 3);
  return (n / ((n - 1) * (n - 2))) * s;
}

/** Excess kurtosis (0 for a normal distribution). */
export function excessKurtosis(x: number[]): number {
  const n = x.length;
  if (n < 4) return NaN;
  const m = mean(x);
  const sd = stdev(x);
  if (!(sd > 0)) return NaN;
  let s = 0;
  for (const v of x) s += Math.pow((v - m) / sd, 4);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
}

/** Simple returns from a price (or index level) series. */
export function toReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) out.push(prices[i] / prices[i - 1] - 1);
  return out;
}

/** Growth-of-1 index from returns (starts at 1). */
export function toIndex(returns: number[], start = 1): number[] {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}

export interface Drawdown {
  /** deepest peak-to-trough fall, as a negative decimal */
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
  /** index where the previous peak was regained, or null if still under water */
  recoveryIndex: number | null;
  /** drawdown at each point (0 at a new high) */
  series: number[];
}

export function drawdown(levels: number[]): Drawdown {
  let peak = -Infinity;
  let peakIdx = 0;
  let maxDd = 0;
  let ddPeak = 0;
  let ddTrough = 0;
  const series: number[] = [];
  levels.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = peak > 0 ? v / peak - 1 : 0;
    series.push(dd);
    if (dd < maxDd) {
      maxDd = dd;
      ddPeak = peakIdx;
      ddTrough = i;
    }
  });
  let recoveryIndex: number | null = null;
  if (maxDd < 0) {
    for (let i = ddTrough + 1; i < levels.length; i++) {
      if (levels[i] >= levels[ddPeak]) {
        recoveryIndex = i;
        break;
      }
    }
  }
  return { maxDrawdown: maxDd, peakIndex: ddPeak, troughIndex: ddTrough, recoveryIndex, series };
}

/** Periods per year for common data frequencies. */
export const PERIODS = { daily: 252, weekly: 52, monthly: 12 } as const;

/** Annualised volatility from periodic returns. */
export const annualVol = (returns: number[], periods: number): number => stdev(returns) * Math.sqrt(periods);

/** Annualised geometric return (CAGR) from periodic returns. */
export function annualReturn(returns: number[], periods: number): number {
  if (!returns.length) return NaN;
  let growth = 1;
  for (const r of returns) growth *= 1 + r;
  if (growth <= 0) return -1;
  return Math.pow(growth, periods / returns.length) - 1;
}

/** Downside deviation against a minimum acceptable periodic return, annualised. */
export function downsideDeviation(returns: number[], periods: number, marPerPeriod = 0): number {
  if (returns.length < 2) return NaN;
  let s = 0;
  for (const r of returns) {
    const d = Math.min(0, r - marPerPeriod);
    s += d * d;
  }
  return Math.sqrt(s / returns.length) * Math.sqrt(periods);
}

/** Sharpe ratio: annualised excess return over annualised volatility. `rf` is an annual rate. */
export function sharpe(returns: number[], periods: number, rf: number): number {
  const vol = annualVol(returns, periods);
  if (!(vol > 0)) return NaN;
  return (mean(returns) * periods - rf) / vol;
}

/** Sortino ratio: like Sharpe, but only downside moves count as risk. */
export function sortino(returns: number[], periods: number, rf: number): number {
  const dd = downsideDeviation(returns, periods, rf / periods);
  if (!(dd > 0)) return NaN;
  return (mean(returns) * periods - rf) / dd;
}

export interface Regression {
  beta: number;
  /** annualised alpha (intercept × periods) */
  alpha: number;
  r2: number;
  correlation: number;
  n: number;
}

/** OLS of asset returns on benchmark returns (CAPM-style, on excess returns when rf is given). */
export function regress(asset: number[], benchmark: number[], periods: number, rf = 0): Regression | null {
  const n = Math.min(asset.length, benchmark.length);
  if (n < 12) return null;
  const rfp = rf / periods;
  const y = asset.slice(-n).map((v) => v - rfp);
  const x = benchmark.slice(-n).map((v) => v - rfp);
  const vx = variance(x);
  if (!(vx > 0)) return null;
  const beta = covariance(x, y) / vx;
  const alpha = (mean(y) - beta * mean(x)) * periods;
  const corr = correlation(x, y);
  return { beta, alpha, r2: corr * corr, correlation: corr, n };
}

/** Annualised tracking error and information ratio against a benchmark. */
export function tracking(asset: number[], benchmark: number[], periods: number): { trackingError: number; informationRatio: number } {
  const n = Math.min(asset.length, benchmark.length);
  const diff = asset.slice(-n).map((v, i) => v - benchmark[benchmark.length - n + i]);
  const te = stdev(diff) * Math.sqrt(periods);
  return { trackingError: te, informationRatio: te > 0 ? (mean(diff) * periods) / te : NaN };
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Standard normal density. */
export const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

export interface VarResult {
  /** loss not exceeded with the given confidence, as a positive decimal */
  var: number;
  /** average loss in the tail beyond VaR (expected shortfall) */
  cvar: number;
}

/** Historical VaR / CVaR straight from the observed return distribution. */
export function historicalVar(returns: number[], confidence = 0.95): VarResult | null {
  if (returns.length < 30) return null;
  const q = percentile(returns, 1 - confidence);
  const tail = returns.filter((r) => r <= q);
  return { var: Math.max(0, -q), cvar: Math.max(0, -mean(tail.length ? tail : [q])) };
}

/** Parametric (normal) VaR / CVaR from mean and volatility of the same period. */
export function parametricVar(mu: number, sigma: number, confidence = 0.95): VarResult {
  const z = normInv(1 - confidence);
  return { var: Math.max(0, -(mu + z * sigma)), cvar: Math.max(0, -(mu - (sigma * normPdf(z)) / (1 - confidence))) };
}

/* ---------- covariance estimation ---------- */

/** Column means of a T×N matrix of returns (rows = dates, columns = assets). */
export function columnMeans(rows: number[][]): number[] {
  const n = rows[0]?.length ?? 0;
  const out = new Array(n).fill(0);
  for (const r of rows) for (let j = 0; j < n; j++) out[j] += r[j];
  return out.map((v) => v / rows.length);
}

/** Sample covariance matrix (n − 1) of a T×N return matrix. */
export function covarianceMatrix(rows: number[][]): number[][] {
  const t = rows.length;
  const n = rows[0]?.length ?? 0;
  const mu = columnMeans(rows);
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of rows) {
    for (let i = 0; i < n; i++) {
      const di = r[i] - mu[i];
      for (let j = i; j < n; j++) cov[i][j] += di * (r[j] - mu[j]);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      cov[i][j] /= t - 1;
      cov[j][i] = cov[i][j];
    }
  return cov;
}

export function correlationFromCov(cov: number[][]): number[][] {
  const sd = cov.map((row, i) => Math.sqrt(row[i]));
  return cov.map((row, i) => row.map((v, j) => (sd[i] > 0 && sd[j] > 0 ? v / (sd[i] * sd[j]) : i === j ? 1 : 0)));
}

/**
 * Ledoit–Wolf shrinkage towards a scaled identity matrix (Ledoit & Wolf, 2004).
 * Pulls noisy sample covariances towards a simple, stable target; the data choose the intensity.
 */
export function ledoitWolf(rows: number[][]): { cov: number[][]; shrinkage: number } {
  const t = rows.length;
  const n = rows[0]?.length ?? 0;
  const mu = columnMeans(rows);
  const x = rows.map((r) => r.map((v, j) => v - mu[j]));
  const s = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of x) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s[i][j] += r[i] * r[j];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s[i][j] /= t;
  let m = 0;
  for (let i = 0; i < n; i++) m += s[i][i];
  m /= n;
  let d2 = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d2 += Math.pow(s[i][j] - (i === j ? m : 0), 2);
  d2 /= n;
  let b2 = 0;
  for (const r of x) {
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += Math.pow(r[i] * r[j] - s[i][j], 2);
    b2 += sum / n;
  }
  b2 = Math.min(b2 / (t * t), d2);
  const shrinkage = d2 > 0 ? b2 / d2 : 0;
  const scale = t / (t - 1); // report on the same (n − 1) basis as the sample covariance
  const cov = s.map((row, i) => row.map((v, j) => (shrinkage * (i === j ? m : 0) + (1 - shrinkage) * v) * scale));
  return { cov, shrinkage };
}

/** Exponentially weighted covariance (RiskMetrics style): recent data counts more. */
export function ewmaCovariance(rows: number[][], lambda = 0.94): number[][] {
  const n = rows[0]?.length ?? 0;
  const mu = columnMeans(rows);
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  let wSum = 0;
  let w = 1;
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k];
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) cov[i][j] += w * (r[i] - mu[i]) * (r[j] - mu[j]);
    wSum += w;
    w *= lambda;
  }
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      cov[i][j] /= wSum;
      cov[j][i] = cov[i][j];
    }
  return cov;
}

/** Histogram with equal-width bins. */
export function histogram(x: number[], bins = 30): { from: number; to: number; count: number }[] {
  if (!x.length) return [];
  const lo = Math.min(...x);
  const hi = Math.max(...x);
  if (lo === hi) return [{ from: lo, to: hi, count: x.length }];
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 }));
  for (const v of x) out[Math.min(bins - 1, Math.floor((v - lo) / w))].count++;
  return out;
}
