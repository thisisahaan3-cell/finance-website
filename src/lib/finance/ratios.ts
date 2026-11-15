/**
 * Financial-ratio analysis from annual statement tables. Every ratio uses year-end
 * balance-sheet figures (not averages) so that each number can be checked by hand
 * against the statements shown on the page.
 */

export interface StatementTable {
  dates: string[];
  items: Record<string, (number | null)[]>;
}

export interface YearRatios {
  date: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  fcf: number | null;
  revenueGrowth: number | null;
  profitGrowth: number | null;
  epsGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  /** net income ÷ shareholders' equity */
  roe: number | null;
  /** EBIT ÷ (total assets − current liabilities) */
  roce: number | null;
  /** net income ÷ total assets */
  roa: number | null;
  /** total debt ÷ shareholders' equity */
  debtToEquity: number | null;
  /** EBIT ÷ interest expense */
  interestCover: number | null;
  currentRatio: number | null;
  /** revenue ÷ total assets */
  assetTurnover: number | null;
  /** total assets ÷ shareholders' equity */
  equityMultiplier: number | null;
  /** operating cash flow ÷ net income: are profits turning into cash? */
  cashConversion: number | null;
  /** dividends paid ÷ net income */
  payout: number | null;
}

const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null;

/** Growth between two values; null when the base is zero or negative (a percentage would mislead). */
export const growth = (now: number | null | undefined, before: number | null | undefined): number | null =>
  typeof now === 'number' && typeof before === 'number' && before > 0 ? now / before - 1 : null;

export function yearlyRatios(t: StatementTable): YearRatios[] {
  const get = (key: string, i: number): number | null => {
    const v = t.items[key]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return t.dates
    .map((date, i) => {
      const revenue = get('TotalRevenue', i);
      const ni = get('NetIncome', i);
      const ebit = get('EBIT', i) ?? get('OperatingIncome', i);
      const equity = get('StockholdersEquity', i);
      const assets = get('TotalAssets', i);
      const curLiab = get('CurrentLiabilities', i);
      const interest = get('InterestExpense', i);
      const ocf = get('OperatingCashFlow', i);
      const capex = get('CapitalExpenditure', i);
      const fcf = get('FreeCashFlow', i) ?? (ocf !== null && capex !== null ? ocf + capex : null);
      const eps = get('DilutedEPS', i) ?? get('BasicEPS', i);
      const dividends = get('CashDividendsPaid', i);
      const capitalEmployed = assets !== null && curLiab !== null ? assets - curLiab : null;
      return {
        date,
        revenue,
        netIncome: ni,
        eps,
        fcf,
        revenueGrowth: i > 0 ? growth(revenue, get('TotalRevenue', i - 1)) : null,
        profitGrowth: i > 0 ? growth(ni, get('NetIncome', i - 1)) : null,
        epsGrowth: i > 0 ? growth(eps, get('DilutedEPS', i - 1) ?? get('BasicEPS', i - 1)) : null,
        grossMargin: div(get('GrossProfit', i), revenue),
        operatingMargin: div(get('OperatingIncome', i), revenue),
        ebitdaMargin: div(get('EBITDA', i), revenue),
        netMargin: div(ni, revenue),
        fcfMargin: div(fcf, revenue),
        roe: equity !== null && equity > 0 ? div(ni, equity) : null,
        roce: capitalEmployed !== null && capitalEmployed > 0 ? div(ebit, capitalEmployed) : null,
        roa: div(ni, assets),
        debtToEquity: equity !== null && equity > 0 ? div(get('TotalDebt', i), equity) : null,
        interestCover: interest !== null && interest > 0 ? div(ebit, interest) : null,
        currentRatio: div(get('CurrentAssets', i), curLiab),
        assetTurnover: div(revenue, assets),
        equityMultiplier: equity !== null && equity > 0 ? div(assets, equity) : null,
        cashConversion: ni !== null && ni > 0 ? div(ocf, ni) : null,
        payout: ni !== null && ni > 0 && dividends !== null ? -dividends / ni : null,
      };
    })
    .filter((r) => r.revenue !== null || r.netIncome !== null);
}

/** Compound annual growth between the first and last available values of a series. */
export function seriesCagr(values: (number | null)[], dates: string[]): { rate: number; years: number } | null {
  let first = -1;
  let last = -1;
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (first < 0) first = i;
      last = i;
    }
  });
  if (first < 0 || last <= first) return null;
  const a = values[first]!;
  const b = values[last]!;
  const years = (Date.parse(dates[last]) - Date.parse(dates[first])) / (365.25 * 86_400_000);
  if (!(a > 0) || !(b > 0) || !(years > 0.5)) return null;
  return { rate: Math.pow(b / a, 1 / years) - 1, years };
}

/** Piotroski-style checklist on the two most recent years: simple yes/no tests of improving fundamentals. */
export function qualityChecks(r: YearRatios[]): { label: string; pass: boolean | null; why: string }[] {
  const cur = r[r.length - 1];
  const prev = r[r.length - 2];
  if (!cur) return [];
  const cmp = (a: number | null, b: number | null | undefined, better: 'up' | 'down') => (a === null || b === null || b === undefined ? null : better === 'up' ? a > b : a < b);
  return [
    { label: 'Profitable', pass: cur.netIncome === null ? null : cur.netIncome > 0, why: 'Made a net profit in the latest year.' },
    { label: 'Profits backed by cash', pass: cur.cashConversion === null ? null : cur.cashConversion >= 1, why: 'Operating cash flow is at least as large as reported profit, so earnings are not just accounting entries.' },
    { label: 'Generates free cash', pass: cur.fcf === null ? null : cur.fcf > 0, why: 'Cash left after paying for investment in the business.' },
    { label: 'Return on equity above 15%', pass: cur.roe === null ? null : cur.roe > 0.15, why: 'Earns more than ₹15 a year on every ₹100 of shareholder money: a common bar for a good business.' },
    { label: 'Revenue growing', pass: cur.revenueGrowth === null ? null : cur.revenueGrowth > 0, why: 'Sales rose compared with the previous year.' },
    { label: 'Margins improving', pass: cmp(cur.netMargin, prev?.netMargin, 'up'), why: 'Net profit margin is higher than a year earlier.' },
    { label: 'Debt falling relative to equity', pass: cur.debtToEquity === 0 ? true : cmp(cur.debtToEquity, prev?.debtToEquity, 'down'), why: 'Debt-to-equity is lower than a year earlier (or there is no debt).' },
    { label: 'Interest comfortably covered', pass: cur.interestCover === null ? (cur.debtToEquity === 0 ? true : null) : cur.interestCover > 3, why: 'Operating profit is more than three times the interest bill.' },
  ];
}
