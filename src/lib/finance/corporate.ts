/**
 * Business finance: break-even, operating and financial leverage, depreciation.
 */
import { FinanceError } from './tvm';

export interface BreakEvenInput {
  fixedCosts: number;
  pricePerUnit: number;
  variableCostPerUnit: number;
  /** units you expect to sell: used for margin of safety and leverage */
  expectedUnits?: number;
  /** yearly interest cost: used for financial leverage */
  interest?: number;
}

export interface BreakEvenResult {
  contributionPerUnit: number;
  contributionMargin: number;
  breakEvenUnits: number;
  breakEvenRevenue: number;
  profitAtExpected: number | null;
  marginOfSafety: number | null;
  /** degree of operating leverage at the expected volume: % change in EBIT per 1% change in sales */
  dol: number | null;
  /** degree of financial leverage: % change in profit before tax per 1% change in EBIT */
  dfl: number | null;
  dcl: number | null;
}

export function breakEven(i: BreakEvenInput): BreakEvenResult {
  const contribution = i.pricePerUnit - i.variableCostPerUnit;
  if (!(i.pricePerUnit > 0)) throw new FinanceError('Enter a selling price above zero.');
  if (!(contribution > 0)) throw new FinanceError('The selling price must be above the variable cost per unit, otherwise every sale loses money.');
  if (!(i.fixedCosts >= 0)) throw new FinanceError('Fixed costs cannot be negative.');
  const breakEvenUnits = i.fixedCosts / contribution;
  const out: BreakEvenResult = {
    contributionPerUnit: contribution,
    contributionMargin: contribution / i.pricePerUnit,
    breakEvenUnits,
    breakEvenRevenue: breakEvenUnits * i.pricePerUnit,
    profitAtExpected: null,
    marginOfSafety: null,
    dol: null,
    dfl: null,
    dcl: null,
  };
  if (i.expectedUnits && i.expectedUnits > 0) {
    const totalContribution = contribution * i.expectedUnits;
    const ebit = totalContribution - i.fixedCosts;
    out.profitAtExpected = ebit;
    out.marginOfSafety = (i.expectedUnits - breakEvenUnits) / i.expectedUnits;
    if (ebit > 0) {
      out.dol = totalContribution / ebit;
      const pbt = ebit - (i.interest ?? 0);
      if (pbt > 0) {
        out.dfl = ebit / pbt;
        out.dcl = out.dol * out.dfl;
      }
    }
  }
  return out;
}

export interface DepreciationRow {
  year: number;
  opening: number;
  depreciation: number;
  closing: number;
}

/** Straight-line method: the same charge every year down to the salvage value. */
export function straightLine(cost: number, salvage: number, life: number): DepreciationRow[] {
  if (!(cost > 0) || !(life >= 1) || salvage < 0 || salvage > cost) throw new FinanceError('Enter a cost, a salvage value between zero and the cost, and a life of at least one year.');
  const n = Math.round(life);
  const dep = (cost - salvage) / n;
  const rows: DepreciationRow[] = [];
  let book = cost;
  for (let y = 1; y <= n; y++) {
    rows.push({ year: y, opening: book, depreciation: dep, closing: book - dep });
    book -= dep;
  }
  return rows;
}

/**
 * Written-down value (reducing balance): a fixed percentage of the opening book value each year.
 * This is the method the Indian Income-tax Act uses for blocks of assets.
 */
export function writtenDownValue(cost: number, rate: number, years: number): DepreciationRow[] {
  if (!(cost > 0) || !(rate > 0 && rate < 1) || !(years >= 1)) throw new FinanceError('Enter a cost, a rate between 0% and 100%, and at least one year.');
  const rows: DepreciationRow[] = [];
  let book = cost;
  for (let y = 1; y <= Math.round(years); y++) {
    const dep = book * rate;
    rows.push({ year: y, opening: book, depreciation: dep, closing: book - dep });
    book -= dep;
  }
  return rows;
}

/** WDV rate that takes an asset from cost to salvage value over its life: 1 − (salvage ÷ cost)^(1/life). */
export function wdvRateFor(cost: number, salvage: number, life: number): number | null {
  if (!(cost > 0) || !(salvage > 0) || !(life >= 1) || salvage >= cost) return null;
  return 1 - Math.pow(salvage / cost, 1 / life);
}
