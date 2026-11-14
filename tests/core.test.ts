import { describe, expect, it } from 'vitest';
import * as tvm from '../src/lib/finance/tvm';
import * as loans from '../src/lib/finance/loans';
import * as tax from '../src/lib/finance/tax';
import * as fi from '../src/lib/finance/fixedIncome';
import * as val from '../src/lib/finance/valuation';
import * as corp from '../src/lib/finance/corporate';

/** Reference values are from Microsoft Excel's documentation examples, standard textbooks, or closed-form formulas. */

describe('time value of money', () => {
  it('CAGR and absolute return', () => {
    expect(tvm.cagr(100, 200, 5)).toBeCloseTo(0.148698355, 9);
    expect(tvm.cagr(0, 200, 5)).toBeNull();
    expect(tvm.cagr(100, 200, 0)).toBeNull();
    expect(tvm.absoluteReturn(100, 150)).toBeCloseTo(0.5, 12);
    expect(tvm.cagr(100, 50, 2)).toBeCloseTo(Math.SQRT1_2 - 1, 12);
  });

  it('SIP matches the annuity-due closed form', () => {
    // 10,000 a month, 12% a year, 10 years: P × [((1+i)^n − 1) / i] × (1+i), i = 1%
    const r = tvm.sip({ monthly: 10_000, annualRate: 0.12, years: 10 });
    const closed = 10_000 * ((Math.pow(1.01, 120) - 1) / 0.01) * 1.01;
    expect(r.value).toBeCloseTo(closed, 4);
    expect(r.value).toBeCloseTo(2_323_390.76, 0);
    expect(r.invested).toBe(1_200_000);
    expect(r.schedule).toHaveLength(10);
  });

  it('SIP end-of-month timing and step-up', () => {
    const end = tvm.sip({ monthly: 10_000, annualRate: 0.12, years: 10, timing: 'end' });
    expect(end.value).toBeCloseTo(10_000 * ((Math.pow(1.01, 120) - 1) / 0.01), 4);
    const flat = tvm.sip({ monthly: 5_000, annualRate: 0.1, years: 3 });
    const stepped = tvm.sip({ monthly: 5_000, annualRate: 0.1, years: 3, stepUp: 0.1 });
    expect(stepped.invested).toBeCloseTo(5_000 * 12 * (1 + 1.1 + 1.21), 6);
    expect(stepped.value).toBeGreaterThan(flat.value);
    // zero return: value equals money put in
    expect(tvm.sip({ monthly: 1_000, annualRate: 0, years: 2 }).value).toBeCloseTo(24_000, 8);
  });

  it('required SIP round-trips to the target', () => {
    const opts = { annualRate: 0.12, years: 15, stepUp: 0.05, initial: 200_000 };
    const need = tvm.requiredSip(10_000_000, opts)!;
    expect(tvm.sip({ ...opts, monthly: need }).value).toBeCloseTo(10_000_000, 2);
    expect(tvm.requiredLumpsum(1_000_000, 0.1, 10)).toBeCloseTo(1_000_000 / Math.pow(1.1, 10), 6);
  });

  it('SWP: a sustainable withdrawal lasts, an excessive one runs out', () => {
    const ok = tvm.swp({ corpus: 10_000_000, monthlyWithdrawal: 50_000, annualRate: 0.08, years: 25 });
    expect(ok.depletedMonth).toBeNull();
    expect(ok.endValue).toBeGreaterThan(0);
    const bad = tvm.swp({ corpus: 1_000_000, monthlyWithdrawal: 50_000, annualRate: 0.06, years: 10 });
    expect(bad.depletedMonth).not.toBeNull();
    expect(bad.depletedMonth!).toBeGreaterThan(20);
    expect(bad.depletedMonth!).toBeLessThan(23);
    expect(bad.endValue).toBe(0);
    // no growth: money simply divides out
    expect(tvm.swp({ corpus: 120_000, monthlyWithdrawal: 10_000, annualRate: 0, years: 1 }).endValue).toBeCloseTo(0, 8);
  });

  it('NPV and IRR (Excel IRR example: 8.66%)', () => {
    expect(tvm.npv(0.1, [-1000, 300, 420, 680])).toBeCloseTo(130.7288, 3);
    const flows = [-70_000, 12_000, 15_000, 18_000, 21_000, 26_000];
    const r = tvm.irr(flows);
    expect(r.rate).toBeCloseTo(0.0866309, 6);
    expect(tvm.npv(r.rate!, flows)).toBeCloseTo(0, 5);
    expect(tvm.irr(flows.slice(0, 5)).rate).toBeCloseTo(-0.0212448, 6); // Excel: −2.1%
  });

  it('IRR refuses impossible inputs and flags multiple sign changes', () => {
    expect(tvm.irr([100, 200]).rate).toBeNull();
    expect(tvm.irr([-100]).rate).toBeNull();
    const multi = tvm.irr([-100, 230, -132]);
    expect(multi.note).toMatch(/more than one/i);
    expect(tvm.irr([-100, -50, -10]).rate).toBeNull();
  });

  it('XNPV and XIRR match the Excel documentation examples', () => {
    const flows = [
      { date: '2008-01-01', amount: -10_000 },
      { date: '2008-03-01', amount: 2_750 },
      { date: '2008-10-30', amount: 4_250 },
      { date: '2009-02-15', amount: 3_250 },
      { date: '2009-04-01', amount: 2_750 },
    ];
    expect(tvm.xnpv(0.09, flows)).toBeCloseTo(2086.647602, 4);
    expect(tvm.xirr(flows).rate).toBeCloseTo(0.373362535, 7);
    // order must not matter
    expect(tvm.xirr([...flows].reverse()).rate).toBeCloseTo(0.373362535, 7);
  });

  it('XIRR edge cases', () => {
    expect(tvm.xirr([{ date: '2025-01-01', amount: -100 }]).rate).toBeNull();
    expect(tvm.xirr([{ date: '2025-01-01', amount: -100 }, { date: '2025-01-01', amount: 110 }]).rate).toBeNull();
    expect(tvm.xirr([{ date: '2025-01-01', amount: 100 }, { date: '2026-01-01', amount: 110 }]).rate).toBeNull();
    // exactly one year, +10%
    expect(tvm.xirr([{ date: '2025-01-01', amount: -100_000 }, { date: '2026-01-01', amount: 110_000 }]).rate).toBeCloseTo(0.1, 9);
    // a heavy loss still resolves
    expect(tvm.xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 20 }]).rate).toBeCloseTo(-0.8, 9);
  });

  it('MIRR, payback and profitability index', () => {
    // Excel MIRR example: 12.61%
    expect(tvm.mirr([-120_000, 39_000, 30_000, 21_000, 37_000, 46_000], 0.1, 0.12)).toBeCloseTo(0.126094, 5);
    expect(tvm.paybackPeriod([-1000, 400, 400, 400])).toBeCloseTo(2.5, 12);
    expect(tvm.paybackPeriod([-1000, 100, 100])).toBeNull();
    expect(tvm.paybackPeriod([-1000, 500, 500, 500], 0.1)).toBeCloseTo(2 + (1000 - 500 / 1.1 - 500 / 1.21) / (500 / 1.331), 9);
    expect(tvm.profitabilityIndex(0.1, [-1000, 300, 420, 680])).toBeCloseTo(1.1307288, 6);
  });

  it('real return and doubling time', () => {
    expect(tvm.realReturn(0.12, 0.06)).toBeCloseTo(0.0566038, 6);
    expect(tvm.yearsToMultiply(2, 0.12)).toBeCloseTo(6.1163, 3);
    expect(tvm.monthlyRate(0.12, 'effective')).toBeCloseTo(Math.pow(1.12, 1 / 12) - 1, 12);
  });

  it("Brent's method finds roots and rejects bad brackets", () => {
    expect(tvm.brent((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 9);
    expect(tvm.brent((x) => x * x + 1, -1, 1)).toBeNull();
  });
});

describe('loans', () => {
  it('EMI matches the standard formula', () => {
    expect(loans.emi(100_000, 0.1, 12)).toBeCloseTo(8791.59, 2);
    expect(loans.emi(120_000, 0, 12)).toBe(10_000);
    expect(loans.loanFromEmi(loans.emi(2_500_000, 0.085, 240), 0.085, 240)).toBeCloseTo(2_500_000, 4);
  });

  it('amortisation repays exactly the principal', () => {
    const r = loans.amortise({ principal: 5_000_000, annualRate: 0.085, months: 240 });
    expect(r.schedule).toHaveLength(240);
    expect(r.schedule[239].closing).toBe(0);
    const principalPaid = r.schedule.reduce((s, x) => s + x.principal, 0);
    expect(principalPaid).toBeCloseTo(5_000_000, 2);
    expect(r.totalPaid).toBeCloseTo(r.emi * 240, 0);
    expect(r.totalInterest).toBeCloseTo(r.totalPaid - 5_000_000, 2);
    expect(r.yearly).toHaveLength(20);
  });

  it('prepayments shorten the loan (reduce-tenure) or lower the EMI (reduce-emi)', () => {
    const base = loans.amortise({ principal: 3_000_000, annualRate: 0.09, months: 180 });
    const shorter = loans.amortise({ principal: 3_000_000, annualRate: 0.09, months: 180, prepayments: [{ month: 12, amount: 500_000 }] });
    expect(shorter.monthsTaken).toBeLessThan(180);
    expect(shorter.totalInterest).toBeLessThan(base.totalInterest);
    const lower = loans.amortise({ principal: 3_000_000, annualRate: 0.09, months: 180, prepayments: [{ month: 12, amount: 500_000 }], prepayMode: 'reduce-emi' });
    expect(lower.monthsTaken).toBe(180);
    expect(lower.schedule[20].payment).toBeLessThan(base.emi);
    expect(lower.schedule[179].closing).toBe(0);
    const extra = loans.amortise({ principal: 3_000_000, annualRate: 0.09, months: 180, extraMonthly: 5_000 });
    expect(extra.monthsTaken).toBeLessThan(180);
  });

  it('moratorium adds simple interest to the loan', () => {
    const r = loans.amortise({ principal: 1_000_000, annualRate: 0.1, months: 84, moratoriumMonths: 30 });
    expect(r.principalAtStart).toBeCloseTo(1_000_000 * (1 + (0.1 * 30) / 12), 6);
    expect(r.schedule[r.schedule.length - 1].closing).toBe(0);
    const paid = loans.amortise({ principal: 1_000_000, annualRate: 0.1, months: 84, moratoriumMonths: 30, moratoriumInterest: 'pay' });
    expect(paid.principalAtStart).toBe(1_000_000);
    expect(paid.totalInterest).toBeLessThan(r.totalInterest);
  });

  it('flat rate converts to a higher reducing-balance rate', () => {
    const r = loans.flatToReducingRate(0.1, 36)!;
    expect(r).toBeGreaterThan(0.17);
    expect(r).toBeLessThan(0.19);
    expect(loans.emi(100, r, 36)).toBeCloseTo((100 + 30) / 36, 6);
  });
});

describe('Indian income tax', () => {
  const base = { age: 'below60' as const, otherIncome: 0 };

  it('FY 2025-26 new regime: no tax up to ₹12.75 lakh salary', () => {
    const r = tax.computeRegime({ ...base, yearId: '2025-26', salary: 1_275_000 }, 'new');
    expect(r.taxableIncome).toBe(1_200_000);
    expect(r.taxBeforeRebate).toBe(60_000);
    expect(r.totalTax).toBe(0);
  });

  it('FY 2025-26 new regime: ₹15 lakh salary → ₹97,500', () => {
    const r = tax.computeRegime({ ...base, yearId: '2025-26', salary: 1_500_000 }, 'new');
    expect(r.taxableIncome).toBe(1_425_000);
    expect(r.taxBeforeRebate).toBe(93_750);
    expect(r.cess).toBe(3_750);
    expect(r.totalTax).toBe(97_500);
  });

  it('marginal relief just above ₹12 lakh', () => {
    const r = tax.computeRegime({ ...base, yearId: '2025-26', salary: 1_285_000 }, 'new');
    expect(r.taxBeforeRebate).toBe(61_500);
    expect(r.taxBeforeRebate - r.rebate).toBe(10_000);
    expect(r.totalTax).toBeCloseTo(10_400, 6);
  });

  it('FY 2026-27 uses the same new-regime rules as FY 2025-26', () => {
    const a = tax.computeRegime({ ...base, yearId: '2026-27', salary: 2_400_000 }, 'new');
    const b = tax.computeRegime({ ...base, yearId: '2025-26', salary: 2_400_000 }, 'new');
    expect(a.totalTax).toBe(b.totalTax);
  });

  it('FY 2024-25 new regime', () => {
    expect(tax.computeRegime({ ...base, yearId: '2024-25', salary: 775_000 }, 'new').totalTax).toBe(0);
    const r = tax.computeRegime({ ...base, yearId: '2024-25', salary: 1_000_000 }, 'new');
    expect(r.taxBeforeRebate).toBe(42_500);
    expect(r.totalTax).toBeCloseTo(44_200, 6);
  });

  it('old regime with deductions, caps and rebate', () => {
    const r = tax.computeRegime({ ...base, yearId: '2025-26', salary: 1_000_000, deductions: { sec80C: 400_000 } }, 'old');
    expect(r.taxableIncome).toBe(800_000); // 80C capped at 1.5 lakh
    expect(r.taxBeforeRebate).toBe(72_500);
    expect(r.totalTax).toBeCloseTo(75_400, 6);
    expect(tax.computeRegime({ ...base, yearId: '2025-26', salary: 550_000 }, 'old').totalTax).toBe(0);
    // no marginal relief in the old regime: ₹1 over the limit loses the whole rebate
    expect(tax.computeRegime({ ...base, yearId: '2025-26', salary: 550_001 }, 'old').totalTax).toBeGreaterThan(12_000);
    // senior citizens get a higher exemption
    const senior = tax.computeRegime({ yearId: '2025-26', age: '60to79', salary: 0, otherIncome: 600_000 }, 'old');
    expect(senior.taxBeforeRebate).toBe(10_000 + 20_000);
    const superSenior = tax.computeRegime({ yearId: '2025-26', age: '80plus', salary: 0, otherIncome: 600_000 }, 'old');
    expect(superSenior.taxBeforeRebate).toBe(20_000);
  });

  it('surcharge and its marginal relief', () => {
    const r = tax.computeRegime({ yearId: '2025-26', age: 'below60', salary: 0, otherIncome: 6_000_000 }, 'new');
    expect(r.taxBeforeRebate).toBe(1_380_000);
    expect(r.surcharge).toBeCloseTo(138_000, 6);
    expect(r.totalTax).toBeCloseTo(1_578_720, 4);
    const edge = tax.computeRegime({ yearId: '2025-26', age: 'below60', salary: 0, otherIncome: 5_050_000 }, 'new');
    expect(edge.taxBeforeRebate).toBe(1_095_000);
    expect(edge.surcharge).toBeCloseTo(35_000, 6);
    expect(edge.totalTax).toBeCloseTo(1_175_200, 4);
    // new regime caps surcharge at 25%, old regime goes to 37%
    const big = { yearId: '2025-26', age: 'below60' as const, salary: 0, otherIncome: 70_000_000 };
    const n = tax.computeRegime(big, 'new');
    const o = tax.computeRegime(big, 'old');
    expect(n.surcharge / n.taxBeforeRebate).toBeCloseTo(0.25, 9);
    expect(o.surcharge / o.taxBeforeRebate).toBeCloseTo(0.37, 9);
  });

  it('compares regimes', () => {
    const c = tax.compareRegimes({ yearId: '2025-26', age: 'below60', salary: 1_500_000, otherIncome: 0, deductions: { sec80C: 150_000 } });
    expect(c.better).toBe('new');
    expect(c.saving).toBeCloseTo(c.oldRegime.totalTax - c.newRegime.totalTax, 6);
  });

  it('equity capital gains', () => {
    const r = tax.equityCapitalGainsTax(100_000, 200_000);
    expect(r.stcgTax).toBe(20_000);
    expect(r.ltcgTaxable).toBe(75_000);
    expect(r.ltcgTax).toBe(9_375);
    expect(r.total).toBeCloseTo(30_550, 6);
    expect(tax.equityCapitalGainsTax(0, 100_000).total).toBe(0);
    // a short-term loss is set off against long-term gains
    expect(tax.equityCapitalGainsTax(-50_000, 200_000).ltcgTaxable).toBe(25_000);
    expect(tax.equityCapitalGainsTax(-50_000, -10_000).total).toBe(0);
  });

  it('holding period and financial year', () => {
    expect(tax.isLongTerm('2025-01-10', '2026-01-10')).toBe(false);
    expect(tax.isLongTerm('2025-01-10', '2026-01-11')).toBe(true);
    expect(tax.financialYearOf('2026-03-31')).toBe('2025-26');
    expect(tax.financialYearOf('2026-04-01')).toBe('2026-27');
    expect(tax.financialYearOf('1999-12-01')).toBe('1999-00');
  });
});

describe('fixed income', () => {
  it('FD, RD and PPF', () => {
    const fd = fi.fdMaturity(100_000, 0.07, 5);
    expect(fd.maturity).toBeCloseTo(100_000 * Math.pow(1.0175, 20), 6);
    expect(fd.maturity).toBeCloseTo(141_477.82, 0);
    expect(fd.effectiveYield).toBeCloseTo(0.071859, 6);
    // RD closed form used by banks: R × [(1+i)^n − 1] / [1 − (1+i)^(−1/3)], i = quarterly rate, n = quarters
    const rd = fi.rdMaturity(1_000, 0.08, 12);
    const closed = (1_000 * (Math.pow(1.02, 4) - 1)) / (1 - Math.pow(1.02, -1 / 3));
    expect(rd.maturity).toBeCloseTo(closed, 6);
    expect(rd.invested).toBe(12_000);
    const p = fi.ppf(150_000, 0.071, 15);
    expect(p.maturity).toBeCloseTo(4_068_209, 0);
    expect(p.invested).toBe(2_250_000);
  });

  it('bond price, yield and duration (textbook values)', () => {
    const annual = { face: 1000, couponRate: 0.08, years: 10, frequency: 1 };
    expect(fi.bondPrice(annual, 0.1)).toBeCloseTo(877.1087, 3);
    expect(fi.bondPrice({ ...annual, frequency: 2 }, 0.1)).toBeCloseTo(875.3779, 3);
    expect(fi.bondPrice(annual, 0.08)).toBeCloseTo(1000, 8);
    expect(fi.bondYtm(annual, 877.1087)).toBeCloseTo(0.1, 6);
    expect(fi.bondYtm({ ...annual, frequency: 2 }, 1100)).toBeCloseTo(0.06617, 4);
    const a = fi.bondAnalytics({ face: 1000, couponRate: 0.1, years: 3, frequency: 1 }, 0.1);
    expect(a.macaulay).toBeCloseTo(2.7355, 4);
    expect(a.modified).toBeCloseTo(2.7355 / 1.1, 3);
    // duration + convexity estimate is close to the true repriced value
    const b = { face: 1000, couponRate: 0.07, years: 10, frequency: 2 };
    const an = fi.bondAnalytics(b, 0.07);
    expect(an.priceForShift(0.01)).toBeCloseTo(fi.bondPrice(b, 0.08), 0);
    // a zero-coupon bond's Macaulay duration equals its maturity
    expect(fi.bondAnalytics({ face: 1000, couponRate: 0, years: 5, frequency: 1 }, 0.07).macaulay).toBeCloseTo(5, 9);
  });
});

describe('valuation', () => {
  const base: val.DcfInput = {
    baseRevenue: 1000,
    years: 5,
    growthStart: 0.02,
    growthEnd: 0.02,
    marginStart: 0.2,
    marginEnd: 0.2,
    taxRate: 0.25,
    daPct: 0.03,
    capexPct: 0.03,
    nwcPct: 0,
    wacc: 0.1,
    terminalMethod: 'growth',
    terminalGrowth: 0.02,
    exitMultiple: 10,
    midYear: false,
    netDebt: 200,
    otherClaims: 0,
    nonOperatingAssets: 0,
    sharesOutstanding: 100,
  };

  it('DCF of a steadily growing firm equals the growing-perpetuity formula', () => {
    const r = val.dcf(base);
    const fcf1 = 1000 * 1.02 * 0.2 * 0.75;
    expect(r.years[0].fcff).toBeCloseTo(fcf1, 9);
    expect(r.enterpriseValue).toBeCloseTo(fcf1 / (0.1 - 0.02), 6);
    expect(r.equityValue).toBeCloseTo(fcf1 / 0.08 - 200, 6);
    expect(r.valuePerShare).toBeCloseTo((fcf1 / 0.08 - 200) / 100, 8);
    expect(r.impliedTerminalGrowth).toBeCloseTo(0.02, 9);
    expect(r.terminalShare).toBeGreaterThan(0.5);
  });

  it('mid-year convention scales value by (1 + WACC)^0.5', () => {
    const end = val.dcf(base);
    const mid = val.dcf({ ...base, midYear: true });
    expect(mid.enterpriseValue / end.enterpriseValue).toBeCloseTo(Math.sqrt(1.1), 9);
  });

  it('working capital, capex and the exit-multiple method', () => {
    const r = val.dcf({ ...base, nwcPct: 0.1, capexPct: 0.05, terminalMethod: 'multiple', exitMultiple: 8 });
    const y1 = r.years[0];
    expect(y1.nwcChange).toBeCloseTo(20 * 0.1, 9);
    expect(y1.fcff).toBeCloseTo(1020 * 0.2 * 0.75 + 1020 * 0.03 - 1020 * 0.05 - 2, 9);
    const last = r.years[4];
    expect(r.terminalValue).toBeCloseTo((last.ebit + last.da) * 8, 6);
    expect(r.impliedExitMultiple).toBeCloseTo(8, 9);
  });

  it('rejects impossible inputs', () => {
    expect(() => val.dcf({ ...base, terminalGrowth: 0.1 })).toThrow(/below the discount rate/);
    expect(() => val.dcf({ ...base, sharesOutstanding: 0 })).toThrow();
    expect(() => val.dcf({ ...base, wacc: 0 })).toThrow();
  });

  it('sensitivity grid and reverse DCF', () => {
    const grid = val.dcfSensitivity(base, [0.09, 0.1, 0.11], [0.01, 0.02, 0.03]);
    expect(grid[1][1]).toBeCloseTo(val.dcf(base).valuePerShare, 9);
    expect(grid[0][1]!).toBeGreaterThan(grid[1][1]!); // lower discount rate → higher value
    expect(grid[1][2]!).toBeGreaterThan(grid[1][1]!); // higher growth → higher value
    const price = val.dcf({ ...base, growthStart: 0.08, growthEnd: 0.08 }).valuePerShare;
    expect(val.impliedGrowth(base, price)).toBeCloseTo(0.08, 6);
  });

  it('cost of capital', () => {
    expect(val.costOfEquity(0.07, 1.2, 0.06)).toBeCloseTo(0.142, 12);
    const w = val.wacc({ equityValue: 600, debtValue: 400, costOfEquity: 0.12, costOfDebt: 0.08, taxRate: 0.25 });
    expect(w.wacc).toBeCloseTo(0.096, 12);
    expect(val.releverBeta(val.unleverBeta(1.3, 0.5, 0.25), 0.5, 0.25)).toBeCloseTo(1.3, 12);
  });

  it('dividend discount models and quick checks', () => {
    expect(val.gordonGrowth(5, 0.1, 0.05)).toBeCloseTo(100, 9);
    expect(val.gordonGrowth(5, 0.05, 0.05)).toBeNull();
    expect(val.twoStageDdm(4, 0.05, 6, 0.05, 0.1)).toBeCloseTo((4 * 1.05) / 0.05, 6);
    expect(val.twoStageDdm(4, 0.15, 5, 0.05, 0.1)!).toBeGreaterThan(84);
    expect(val.grahamNumber(10, 50)).toBeCloseTo(Math.sqrt(11250), 9);
    expect(val.grahamNumber(-1, 50)).toBeNull();
    expect(val.pegRatio(20, 10)).toBe(2);
    expect(val.marginOfSafety(100, 70)).toBeCloseTo(0.3, 12);
  });

  it('peer multiples and DuPont', () => {
    const s = val.summariseMultiple([10, 20, null, -5, 30, undefined, 40])!;
    expect(s.count).toBe(4);
    expect(s.median).toBe(25);
    expect(s.low).toBe(10);
    expect(val.summariseMultiple([null, -1])).toBeNull();
    const d = val.duPont(50, 500, 1000, 400)!;
    expect(d.roe).toBeCloseTo(50 / 400, 12);
    expect(d.netMargin * d.assetTurnover * d.equityMultiplier).toBeCloseTo(d.roe, 12);
  });
});

describe('business finance', () => {
  it('break-even and leverage', () => {
    const r = corp.breakEven({ fixedCosts: 100_000, pricePerUnit: 50, variableCostPerUnit: 30, expectedUnits: 8_000, interest: 20_000 });
    expect(r.breakEvenUnits).toBe(5_000);
    expect(r.breakEvenRevenue).toBe(250_000);
    expect(r.contributionMargin).toBeCloseTo(0.4, 12);
    expect(r.profitAtExpected).toBe(60_000);
    expect(r.marginOfSafety).toBeCloseTo(0.375, 12);
    expect(r.dol).toBeCloseTo(160_000 / 60_000, 12);
    expect(r.dfl).toBeCloseTo(60_000 / 40_000, 12);
    expect(() => corp.breakEven({ fixedCosts: 1, pricePerUnit: 10, variableCostPerUnit: 12 })).toThrow();
  });

  it('depreciation schedules', () => {
    const slm = corp.straightLine(100_000, 10_000, 5);
    expect(slm[0].depreciation).toBe(18_000);
    expect(slm[4].closing).toBeCloseTo(10_000, 8);
    const wdv = corp.writtenDownValue(100_000, 0.15, 3);
    expect(wdv[2].closing).toBeCloseTo(100_000 * Math.pow(0.85, 3), 8);
    const rate = corp.wdvRateFor(100_000, 10_000, 5)!;
    expect(corp.writtenDownValue(100_000, rate, 5)[4].closing).toBeCloseTo(10_000, 6);
  });
});
