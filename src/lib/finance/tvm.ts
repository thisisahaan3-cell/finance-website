/**
 * Time value of money: growth, annuities (SIP / SWP), NPV, IRR, XIRR, payback.
 * Every function is pure. Rates are decimals (0.12 = 12%). Functions return `null`
 * (or throw a FinanceError) instead of a plausible-looking number when the maths has no answer.
 */

export class FinanceError extends Error {}

const finite = (x: number) => typeof x === 'number' && Number.isFinite(x);

/** Compound annual growth rate between two values `years` apart. */
export function cagr(start: number, end: number, years: number): number | null {
  if (!finite(start) || !finite(end) || !finite(years) || start <= 0 || end < 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

/** Simple (absolute) return. */
export function absoluteReturn(start: number, end: number): number | null {
  if (!finite(start) || !finite(end) || start <= 0) return null;
  return end / start - 1;
}

/** Future value of a lump sum with `m` compounding periods per year. */
export function futureValue(pv: number, annualRate: number, years: number, m = 1): number {
  return pv * Math.pow(1 + annualRate / m, m * years);
}

/** Present value of a single future amount. */
export function presentValue(fv: number, annualRate: number, years: number, m = 1): number {
  return fv / Math.pow(1 + annualRate / m, m * years);
}

/** Real (inflation-adjusted) return via the Fisher relation. */
export function realReturn(nominal: number, inflation: number): number | null {
  if (!finite(nominal) || !finite(inflation) || inflation <= -1) return null;
  return (1 + nominal) / (1 + inflation) - 1;
}

/**
 * Monthly rate from an annual rate.
 * - 'nominal': annual / 12 — the convention Indian SIP and loan calculators use.
 * - 'effective': (1 + annual)^(1/12) − 1 — twelve months compound to exactly the annual rate.
 */
export type RateConvention = 'nominal' | 'effective';
export function monthlyRate(annual: number, convention: RateConvention = 'nominal'): number {
  return convention === 'nominal' ? annual / 12 : Math.pow(1 + annual, 1 / 12) - 1;
}

export interface SipInput {
  monthly: number;
  annualRate: number;
  years: number;
  /** yearly increase in the instalment, e.g. 0.10 raises it 10% every 12 months */
  stepUp?: number;
  /** lump sum invested on day one alongside the SIP */
  initial?: number;
  /** invest at the start (default, how a SIP date works) or end of each month */
  timing?: 'begin' | 'end';
  convention?: RateConvention;
}
export interface YearRow {
  year: number;
  invested: number;
  value: number;
  gain: number;
}
export interface SipResult {
  invested: number;
  value: number;
  gain: number;
  schedule: YearRow[];
}

/** Systematic investment plan, simulated month by month. */
export function sip(input: SipInput): SipResult {
  const { monthly, annualRate, years } = input;
  const stepUp = input.stepUp ?? 0;
  const initial = input.initial ?? 0;
  const timing = input.timing ?? 'begin';
  if (![monthly, annualRate, years, stepUp, initial].every(finite) || monthly < 0 || initial < 0 || years <= 0 || annualRate <= -1)
    throw new FinanceError('Enter a non-negative instalment, a period above zero and a valid return.');
  const r = monthlyRate(annualRate, input.convention);
  const months = Math.round(years * 12);
  let value = initial;
  let invested = initial;
  let instalment = monthly;
  const schedule: YearRow[] = [];
  for (let m = 1; m <= months; m++) {
    if (timing === 'begin') {
      value = (value + instalment) * (1 + r);
    } else {
      value = value * (1 + r) + instalment;
    }
    invested += instalment;
    if (m % 12 === 0 || m === months) {
      schedule.push({ year: Math.ceil(m / 12), invested, value, gain: value - invested });
      if (m % 12 === 0) instalment *= 1 + stepUp;
    }
  }
  return { invested, value, gain: value - invested, schedule };
}

/** Monthly instalment needed to reach `target`. Future value is linear in the instalment, so this is exact. */
export function requiredSip(target: number, input: Omit<SipInput, 'monthly'>): number | null {
  if (!finite(target) || target <= 0) return null;
  const base = sip({ ...input, monthly: 0 }).value; // growth of the initial lump sum alone
  const unit = sip({ ...input, monthly: 1, initial: 0 }).value;
  if (unit <= 0) return null;
  return Math.max(0, (target - base) / unit);
}

/** Lump sum needed today to reach `target`. */
export function requiredLumpsum(target: number, annualRate: number, years: number): number | null {
  if (!finite(target) || !finite(annualRate) || !finite(years) || years <= 0 || annualRate <= -1) return null;
  return target / Math.pow(1 + annualRate, years);
}

export interface SwpInput {
  corpus: number;
  monthlyWithdrawal: number;
  annualRate: number;
  years: number;
  /** yearly increase in the withdrawal (to keep up with inflation) */
  withdrawalGrowth?: number;
  convention?: RateConvention;
}
export interface SwpResult {
  endValue: number;
  totalWithdrawn: number;
  /** month in which the money runs out, or null if it lasts the whole period */
  depletedMonth: number | null;
  schedule: { year: number; withdrawn: number; value: number }[];
}

/** Systematic withdrawal plan: withdraw at the start of each month, the rest stays invested. */
export function swp(input: SwpInput): SwpResult {
  const { corpus, monthlyWithdrawal, annualRate, years } = input;
  const g = input.withdrawalGrowth ?? 0;
  if (![corpus, monthlyWithdrawal, annualRate, years, g].every(finite) || corpus < 0 || monthlyWithdrawal < 0 || years <= 0 || annualRate <= -1)
    throw new FinanceError('Enter a non-negative corpus and withdrawal, and a period above zero.');
  const r = monthlyRate(annualRate, input.convention);
  const months = Math.round(years * 12);
  let value = corpus;
  let w = monthlyWithdrawal;
  let total = 0;
  let depletedMonth: number | null = null;
  const schedule: SwpResult['schedule'] = [];
  for (let m = 1; m <= months; m++) {
    const take = Math.min(w, value);
    value -= take;
    total += take;
    if (take < w - 1e-9 && depletedMonth === null) depletedMonth = m;
    value *= 1 + r;
    if (m % 12 === 0 || m === months) {
      schedule.push({ year: Math.ceil(m / 12), withdrawn: total, value });
      if (m % 12 === 0) w *= 1 + g;
    }
  }
  return { endValue: value, totalWithdrawn: total, depletedMonth, schedule };
}

/* ---------- root finding ---------- */

/**
 * Brent's method on [a, b]; f(a) and f(b) must have opposite signs.
 * Returns null if the bracket is invalid or the iteration fails to converge.
 */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-10, maxIter = 200): number | null {
  let fa = f(a);
  let fb = f(b);
  if (!finite(fa) || !finite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
    if (!finite(fb)) return null;
  }
  return null;
}

/** Scan a grid for the first sign change and polish it with Brent. */
function solveRate(f: (r: number) => number, grid: number[]): number | null {
  let prevX = grid[0];
  let prevF = f(prevX);
  for (let i = 1; i < grid.length; i++) {
    const x = grid[i];
    const fx = f(x);
    if (finite(prevF) && finite(fx)) {
      if (prevF === 0) return prevX;
      if (prevF * fx < 0) return brent(f, prevX, x);
    }
    prevX = x;
    prevF = fx;
  }
  return finite(prevF) && prevF === 0 ? prevX : null;
}

// Rate grid from −99% to +100,000%: dense near zero where real answers live.
const RATE_GRID: number[] = (() => {
  const g: number[] = [];
  for (let x = -0.99; x < -0.5; x += 0.07) g.push(x);
  for (let x = -0.5; x < 1; x += 0.025) g.push(x);
  for (let x = 1; x < 10; x += 0.5) g.push(x);
  for (let x = 10; x <= 1000; x *= 1.6) g.push(x);
  return g;
})();

/** Net present value. `cashflows[0]` happens now, `cashflows[t]` at the end of period t. */
export function npv(rate: number, cashflows: number[]): number {
  let total = 0;
  for (let t = 0; t < cashflows.length; t++) total += cashflows[t] / Math.pow(1 + rate, t);
  return total;
}

export interface RateResult {
  rate: number | null;
  /** why there is no rate, or a caution about the one returned */
  note?: string;
}

function signChanges(values: number[]): number {
  let changes = 0;
  let prev = 0;
  for (const v of values) {
    if (v === 0) continue;
    const s = Math.sign(v);
    if (prev !== 0 && s !== prev) changes++;
    prev = s;
  }
  return changes;
}

/** Internal rate of return for evenly spaced cash flows (one per period). */
export function irr(cashflows: number[]): RateResult {
  if (cashflows.length < 2 || !cashflows.every(finite)) return { rate: null, note: 'Enter at least two cash flows.' };
  const changes = signChanges(cashflows);
  if (changes === 0) return { rate: null, note: 'IRR needs at least one outflow (negative) and one inflow (positive).' };
  const rate = solveRate((r) => npv(r, cashflows), RATE_GRID);
  if (rate === null) return { rate: null, note: 'No rate makes these cash flows balance.' };
  return changes > 1
    ? { rate, note: 'The cash flows change sign more than once, so more than one IRR can exist. Prefer NPV or MIRR here.' }
    : { rate };
}

export interface DatedFlow {
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** negative = money you put in, positive = money you received (or current value) */
  amount: number;
}

const DAY = 86_400_000;
export const dayNumber = (iso: string): number => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

/** XNPV with Actual/365 day count, the same convention as Excel's XNPV. */
export function xnpv(rate: number, flows: DatedFlow[]): number {
  if (!flows.length) return 0;
  const t0 = Math.min(...flows.map((f) => dayNumber(f.date)));
  let total = 0;
  for (const f of flows) total += f.amount / Math.pow(1 + rate, (dayNumber(f.date) - t0) / 365);
  return total;
}

/** Annualised money-weighted return for irregular, dated cash flows (Excel XIRR convention). */
export function xirr(flows: DatedFlow[]): RateResult {
  const clean = flows.filter((f) => finite(f.amount) && f.amount !== 0 && finite(dayNumber(f.date)));
  if (clean.length < 2) return { rate: null, note: 'Enter at least two dated cash flows.' };
  const sorted = [...clean].sort((a, b) => dayNumber(a.date) - dayNumber(b.date));
  if (dayNumber(sorted[0].date) === dayNumber(sorted[sorted.length - 1].date))
    return { rate: null, note: 'All cash flows are on the same day, so an annual rate cannot be measured.' };
  const changes = signChanges(sorted.map((f) => f.amount));
  if (changes === 0) return { rate: null, note: 'XIRR needs at least one outflow (negative) and one inflow (positive).' };
  const rate = solveRate((r) => xnpv(r, sorted), RATE_GRID);
  if (rate === null) return { rate: null, note: 'No rate makes these cash flows balance.' };
  return changes > 1 ? { rate, note: 'Flows change sign more than once; the rate shown is the lowest valid solution.' } : { rate };
}

/** Modified IRR: outflows financed at `financeRate`, inflows reinvested at `reinvestRate`. */
export function mirr(cashflows: number[], financeRate: number, reinvestRate: number): number | null {
  const n = cashflows.length - 1;
  if (n < 1) return null;
  let pvOut = 0;
  let fvIn = 0;
  cashflows.forEach((cf, t) => {
    if (cf < 0) pvOut += cf / Math.pow(1 + financeRate, t);
    else fvIn += cf * Math.pow(1 + reinvestRate, n - t);
  });
  if (pvOut === 0 || fvIn === 0) return null;
  return Math.pow(fvIn / -pvOut, 1 / n) - 1;
}

/** Periods until cumulative cash flow turns positive (fractional, linear within the period). Null = never. */
export function paybackPeriod(cashflows: number[], discountRate = 0): number | null {
  let cumulative = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const cf = cashflows[t] / Math.pow(1 + discountRate, t);
    const next = cumulative + cf;
    if (cumulative < 0 && next >= 0) return t === 0 ? 0 : t - 1 + -cumulative / cf;
    cumulative = next;
  }
  return null;
}

/** Profitability index = PV of future flows ÷ initial outlay. */
export function profitabilityIndex(rate: number, cashflows: number[]): number | null {
  if (cashflows.length < 2 || cashflows[0] >= 0) return null;
  return npv(rate, [0, ...cashflows.slice(1)]) / -cashflows[0];
}

/** Years for money to multiply by `multiple` at a given rate. */
export function yearsToMultiply(multiple: number, annualRate: number): number | null {
  if (multiple <= 0 || annualRate <= 0) return null;
  return Math.log(multiple) / Math.log(1 + annualRate);
}
