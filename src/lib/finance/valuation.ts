/**
 * Company valuation: discounted cash flow (FCFF), cost of capital, dividend discount
 * models, and multiples-based (relative) valuation.
 */
import { brent, FinanceError } from './tvm';

/* ---------- cost of capital ---------- */

/** CAPM cost of equity. */
export function costOfEquity(rf: number, beta: number, equityRiskPremium: number, extraPremium = 0): number {
  return rf + beta * equityRiskPremium + extraPremium;
}

export interface WaccInput {
  equityValue: number;
  debtValue: number;
  costOfEquity: number;
  /** pre-tax cost of debt */
  costOfDebt: number;
  taxRate: number;
}
export interface WaccResult {
  wacc: number;
  equityWeight: number;
  debtWeight: number;
  afterTaxCostOfDebt: number;
}

export function wacc(i: WaccInput): WaccResult {
  const total = i.equityValue + i.debtValue;
  if (!(total > 0) || i.equityValue < 0 || i.debtValue < 0) throw new FinanceError('Enter the market value of equity and debt (at least one above zero).');
  const we = i.equityValue / total;
  const wd = i.debtValue / total;
  const kd = i.costOfDebt * (1 - i.taxRate);
  return { wacc: we * i.costOfEquity + wd * kd, equityWeight: we, debtWeight: wd, afterTaxCostOfDebt: kd };
}

/** Re-lever a beta for a different capital structure (Hamada). */
export function unleverBeta(beta: number, debtToEquity: number, taxRate: number): number {
  return beta / (1 + (1 - taxRate) * debtToEquity);
}
export function releverBeta(assetBeta: number, debtToEquity: number, taxRate: number): number {
  return assetBeta * (1 + (1 - taxRate) * debtToEquity);
}

/* ---------- DCF ---------- */

export interface DcfInput {
  /** last twelve months revenue, in the model currency units */
  baseRevenue: number;
  /** explicit forecast length in years */
  years: number;
  /** revenue growth in year 1 and in the final forecast year; years in between fade linearly */
  growthStart: number;
  growthEnd: number;
  /** EBIT margin in year 1 and in the final forecast year */
  marginStart: number;
  marginEnd: number;
  taxRate: number;
  /** depreciation & amortisation as a share of revenue */
  daPct: number;
  /** capital expenditure as a share of revenue */
  capexPct: number;
  /** net working capital needed per rupee of ADDITIONAL revenue */
  nwcPct: number;
  wacc: number;
  terminalMethod: 'growth' | 'multiple';
  /** perpetual growth after the forecast (Gordon growth) */
  terminalGrowth: number;
  /** exit EV/EBITDA multiple, used when terminalMethod = 'multiple' */
  exitMultiple: number;
  /** discount cash flows as if received mid-year rather than at year end */
  midYear: boolean;
  /** debt minus cash; negative for a net-cash company */
  netDebt: number;
  /** other claims ahead of shareholders (minority interest, preference shares) */
  otherClaims: number;
  /** non-operating assets not captured in cash flows (investments) */
  nonOperatingAssets: number;
  sharesOutstanding: number;
  /** optional year-by-year overrides */
  growthOverride?: (number | null)[];
  marginOverride?: (number | null)[];
}

export interface DcfYear {
  year: number;
  growth: number;
  revenue: number;
  margin: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  nwcChange: number;
  fcff: number;
  discountFactor: number;
  pv: number;
}

export interface DcfResult {
  years: DcfYear[];
  sumPv: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  valuePerShare: number;
  /** share of enterprise value that comes from the terminal value */
  terminalShare: number;
  /** EV/EBITDA implied by the Gordon terminal value, or growth implied by the exit multiple */
  impliedExitMultiple: number;
  impliedTerminalGrowth: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function dcf(i: DcfInput): DcfResult {
  const n = Math.round(i.years);
  if (!(i.baseRevenue > 0)) throw new FinanceError('Enter the starting revenue.');
  if (!(n >= 1 && n <= 30)) throw new FinanceError('Forecast between 1 and 30 years.');
  if (!(i.wacc > 0)) throw new FinanceError('The discount rate (WACC) must be above zero.');
  if (!(i.sharesOutstanding > 0)) throw new FinanceError('Enter the number of shares outstanding.');
  if (i.terminalMethod === 'growth' && !(i.wacc > i.terminalGrowth))
    throw new FinanceError('Terminal growth must be below the discount rate, otherwise the value is infinite.');
  if (i.terminalMethod === 'multiple' && !(i.exitMultiple > 0)) throw new FinanceError('Enter an exit multiple above zero.');

  const rows: DcfYear[] = [];
  let revenue = i.baseRevenue;
  let sumPv = 0;
  for (let y = 1; y <= n; y++) {
    const k = n === 1 ? 1 : (y - 1) / (n - 1);
    const growth = i.growthOverride?.[y - 1] ?? lerp(i.growthStart, i.growthEnd, k);
    const margin = i.marginOverride?.[y - 1] ?? lerp(i.marginStart, i.marginEnd, k);
    const prev = revenue;
    revenue = prev * (1 + growth);
    const ebit = revenue * margin;
    const nopat = ebit * (1 - i.taxRate);
    const da = revenue * i.daPct;
    const capex = revenue * i.capexPct;
    const nwcChange = (revenue - prev) * i.nwcPct;
    const fcff = nopat + da - capex - nwcChange;
    const t = i.midYear ? y - 0.5 : y;
    const discountFactor = 1 / Math.pow(1 + i.wacc, t);
    const pv = fcff * discountFactor;
    sumPv += pv;
    rows.push({ year: y, growth, revenue, margin, ebit, nopat, da, capex, nwcChange, fcff, discountFactor, pv });
  }
  const last = rows[n - 1];
  const ebitdaLast = last.ebit + last.da;
  let terminalValue: number;
  let pvTerminal: number;
  if (i.terminalMethod === 'growth') {
    // Normalised terminal cash flow: growth g on the final-year cash flow.
    terminalValue = (last.fcff * (1 + i.terminalGrowth)) / (i.wacc - i.terminalGrowth);
    // With mid-year discounting the Gordon value sits half a year earlier, so it is discounted n − 0.5 years.
    pvTerminal = terminalValue / Math.pow(1 + i.wacc, i.midYear ? n - 0.5 : n);
  } else {
    terminalValue = ebitdaLast * i.exitMultiple;
    pvTerminal = terminalValue / Math.pow(1 + i.wacc, n);
  }
  const enterpriseValue = sumPv + pvTerminal;
  const equityValue = enterpriseValue - i.netDebt - i.otherClaims + i.nonOperatingAssets;
  const tvAtN = i.terminalMethod === 'growth' && i.midYear ? terminalValue * Math.pow(1 + i.wacc, 0.5) : terminalValue;
  const impliedExitMultiple = ebitdaLast > 0 ? tvAtN / ebitdaLast : NaN;
  // growth g solving TV = FCF·(1+g)/(WACC − g)
  const impliedTerminalGrowth = last.fcff + tvAtN !== 0 ? (tvAtN * i.wacc - last.fcff) / (tvAtN + last.fcff) : NaN;
  return {
    years: rows,
    sumPv,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    valuePerShare: equityValue / i.sharesOutstanding,
    terminalShare: enterpriseValue !== 0 ? pvTerminal / enterpriseValue : NaN,
    impliedExitMultiple,
    impliedTerminalGrowth,
  };
}

/** Value per share across a grid of discount rates and terminal growth rates (or exit multiples). */
export function dcfSensitivity(i: DcfInput, waccs: number[], seconds: number[]): (number | null)[][] {
  return waccs.map((w) =>
    seconds.map((s) => {
      try {
        return dcf({ ...i, wacc: w, ...(i.terminalMethod === 'growth' ? { terminalGrowth: s } : { exitMultiple: s }) }).valuePerShare;
      } catch {
        return null;
      }
    }),
  );
}

/**
 * Reverse DCF: the constant revenue growth over the forecast period that makes the model's
 * value per share equal to the market price. Tells you what the market is "pricing in".
 */
export function impliedGrowth(i: DcfInput, marketPrice: number): number | null {
  if (!(marketPrice > 0)) return null;
  const f = (g: number) => {
    try {
      return dcf({ ...i, growthStart: g, growthEnd: g, growthOverride: undefined }).valuePerShare - marketPrice;
    } catch {
      return NaN;
    }
  };
  return brent(f, -0.5, 1.5, 1e-9);
}

/* ---------- dividend discount models ---------- */

/** Gordon growth: value = next year's dividend ÷ (required return − growth). */
export function gordonGrowth(dividendNextYear: number, requiredReturn: number, growth: number): number | null {
  if (!(requiredReturn > growth) || !(dividendNextYear >= 0)) return null;
  return dividendNextYear / (requiredReturn - growth);
}

/** Two-stage DDM: `highYears` of fast growth, then stable growth forever. */
export function twoStageDdm(currentDividend: number, highGrowth: number, highYears: number, stableGrowth: number, requiredReturn: number): number | null {
  if (!(requiredReturn > stableGrowth) || !(currentDividend >= 0) || highYears < 0) return null;
  let value = 0;
  let d = currentDividend;
  const n = Math.round(highYears);
  for (let t = 1; t <= n; t++) {
    d *= 1 + highGrowth;
    value += d / Math.pow(1 + requiredReturn, t);
  }
  const terminal = (d * (1 + stableGrowth)) / (requiredReturn - stableGrowth);
  return value + terminal / Math.pow(1 + requiredReturn, n);
}

/* ---------- quick checks ---------- */

/** Benjamin Graham's number: √(22.5 × EPS × book value per share). Null when either is not positive. */
export function grahamNumber(eps: number, bookValuePerShare: number): number | null {
  if (!(eps > 0) || !(bookValuePerShare > 0)) return null;
  return Math.sqrt(22.5 * eps * bookValuePerShare);
}

/** PEG: P/E ÷ expected EPS growth in percent. */
export function pegRatio(pe: number, growthPct: number): number | null {
  if (!(pe > 0) || !(growthPct > 0)) return null;
  return pe / growthPct;
}

/** Margin of safety: how far the price sits below your estimate of value. */
export function marginOfSafety(value: number, price: number): number | null {
  if (!(value > 0) || !(price > 0)) return null;
  return 1 - price / value;
}

/* ---------- relative valuation ---------- */

export function median(x: number[]): number {
  const s = x.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface CompsSummary {
  count: number;
  low: number;
  median: number;
  mean: number;
  high: number;
}

/** Summary of one multiple across peers, ignoring missing and non-positive values. */
export function summariseMultiple(values: (number | null | undefined)[]): CompsSummary | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  return { count: v.length, low: Math.min(...v), median: median(v), mean: v.reduce((s, x) => s + x, 0) / v.length, high: Math.max(...v) };
}

/* ---------- ratio analysis ---------- */

export interface DuPont {
  netMargin: number;
  assetTurnover: number;
  equityMultiplier: number;
  roe: number;
}

/** Three-step DuPont: ROE = net margin × asset turnover × equity multiplier. */
export function duPont(netIncome: number, revenue: number, totalAssets: number, equity: number): DuPont | null {
  if (!(revenue > 0) || !(totalAssets > 0) || !(equity > 0)) return null;
  const netMargin = netIncome / revenue;
  const assetTurnover = revenue / totalAssets;
  const equityMultiplier = totalAssets / equity;
  return { netMargin, assetTurnover, equityMultiplier, roe: netMargin * assetTurnover * equityMultiplier };
}
