/**
 * Fixed income: bank deposits (FD, RD), PPF, and plain-vanilla bond maths.
 */
import { brent, FinanceError } from './tvm';

/** Fixed deposit maturity value. Indian banks compound quarterly (m = 4) unless stated otherwise. */
export function fdMaturity(principal: number, annualRate: number, years: number, m = 4): { maturity: number; interest: number; effectiveYield: number } {
  if (!(principal >= 0) || !(years > 0) || !(annualRate > -1) || !(m > 0)) throw new FinanceError('Enter a deposit, a rate and a tenure above zero.');
  const maturity = principal * Math.pow(1 + annualRate / m, m * years);
  return { maturity, interest: maturity - principal, effectiveYield: Math.pow(1 + annualRate / m, m) - 1 };
}

/**
 * Recurring deposit: a fixed amount every month, each instalment compounding quarterly
 * until maturity (the formula Indian banks use).
 */
export function rdMaturity(monthly: number, annualRate: number, months: number): { maturity: number; invested: number; interest: number } {
  if (!(monthly >= 0) || !(months > 0) || !(annualRate > -1)) throw new FinanceError('Enter a monthly amount, a rate and a tenure above zero.');
  const n = Math.round(months);
  let maturity = 0;
  for (let k = 0; k < n; k++) maturity += monthly * Math.pow(1 + annualRate / 4, (n - k) / 3);
  const invested = monthly * n;
  return { maturity, invested, interest: maturity - invested };
}

/**
 * Public Provident Fund: one deposit at the start of each year, interest credited yearly.
 * (Real PPF interest is calculated on the lowest balance between the 5th and month-end; depositing
 * before 5 April each year matches this model.)
 */
export function ppf(yearlyDeposit: number, annualRate: number, years = 15): { maturity: number; invested: number; interest: number; schedule: { year: number; invested: number; value: number }[] } {
  if (!(yearlyDeposit >= 0) || !(years > 0)) throw new FinanceError('Enter a yearly deposit and a tenure above zero.');
  let value = 0;
  let invested = 0;
  const schedule = [];
  for (let y = 1; y <= Math.round(years); y++) {
    value = (value + yearlyDeposit) * (1 + annualRate);
    invested += yearlyDeposit;
    schedule.push({ year: y, invested, value });
  }
  return { maturity: value, invested, interest: value - invested, schedule };
}

export interface BondInput {
  face: number;
  /** annual coupon rate as a decimal of face value */
  couponRate: number;
  /** years to maturity (priced on a coupon date: a whole number of coupon periods) */
  years: number;
  /** coupons per year: 1 annual, 2 semi-annual (Indian G-secs), 4 quarterly */
  frequency: number;
}

/** Price of a fixed-coupon bond for a given yield to maturity (compounded at the coupon frequency). */
export function bondPrice(b: BondInput, ytm: number): number {
  const n = Math.round(b.years * b.frequency);
  const c = (b.face * b.couponRate) / b.frequency;
  const y = ytm / b.frequency;
  if (n <= 0) return b.face;
  let price = 0;
  for (let t = 1; t <= n; t++) price += c / Math.pow(1 + y, t);
  return price + b.face / Math.pow(1 + y, n);
}

/** Yield to maturity that reproduces a market price. */
export function bondYtm(b: BondInput, price: number): number | null {
  if (!(price > 0) || !(b.face > 0) || !(b.years > 0)) return null;
  return brent((y) => bondPrice(b, y) - price, -0.95 * b.frequency + 1e-6, 5, 1e-12);
}

export interface BondAnalytics {
  price: number;
  currentYield: number;
  /** Macaulay duration in years: the weighted average time to receive the cash flows */
  macaulay: number;
  /** modified duration: % price change for a 1 percentage-point change in yield */
  modified: number;
  convexity: number;
  /** estimated price after a yield change, using duration and convexity */
  priceForShift: (dy: number) => number;
}

export function bondAnalytics(b: BondInput, ytm: number): BondAnalytics {
  const n = Math.round(b.years * b.frequency);
  const c = (b.face * b.couponRate) / b.frequency;
  const y = ytm / b.frequency;
  const price = bondPrice(b, ytm);
  let dur = 0;
  let conv = 0;
  for (let t = 1; t <= n; t++) {
    const cf = t === n ? c + b.face : c;
    const pv = cf / Math.pow(1 + y, t);
    dur += (t / b.frequency) * pv;
    conv += (t * (t + 1) * pv) / Math.pow(1 + y, 2);
  }
  const macaulay = dur / price;
  const modified = macaulay / (1 + y);
  const convexity = conv / (price * b.frequency * b.frequency);
  return {
    price,
    currentYield: (b.face * b.couponRate) / price,
    macaulay,
    modified,
    convexity,
    priceForShift: (dy: number) => price * (1 - modified * dy + 0.5 * convexity * dy * dy),
  };
}

/** Post-tax yield of an interest-bearing investment for a given marginal tax rate. */
export const postTaxYield = (yieldRate: number, taxRate: number): number => yieldRate * (1 - taxRate);
