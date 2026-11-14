import { describe, expect, it } from 'vitest';
import * as st from '../src/lib/finance/stats';
import * as opt from '../src/lib/finance/optimize';
import * as bt from '../src/lib/finance/backtest';
import * as mc from '../src/lib/finance/montecarlo';
import * as pf from '../src/lib/finance/portfolio';

const isoDays = (start: string, n: number): string[] => {
  const out: string[] = [];
  const t0 = Date.parse(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return out;
};

describe('statistics', () => {
  it('moments', () => {
    const x = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(st.mean(x)).toBe(5);
    expect(st.stdev(x)).toBeCloseTo(2.13809, 5);
    expect(st.variance([1])).toBeNaN();
    expect(st.correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(st.correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(st.percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(st.percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(st.skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 12);
  });

  it('returns, index and drawdown', () => {
    const r = st.toReturns([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(st.toIndex(r, 100)[2]).toBeCloseTo(99, 10);
    const d = st.drawdown([100, 120, 90, 95, 130]);
    expect(d.maxDrawdown).toBeCloseTo(-0.25, 12);
    expect(d.peakIndex).toBe(1);
    expect(d.troughIndex).toBe(2);
    expect(d.recoveryIndex).toBe(4);
    expect(st.drawdown([100, 80, 90]).recoveryIndex).toBeNull();
    expect(st.drawdown([1, 2, 3]).maxDrawdown).toBe(0);
  });

  it('annualisation, Sharpe and Sortino', () => {
    const r = new Array(252).fill(0).map((_, i) => (i % 2 ? 0.011 : -0.009));
    expect(st.annualVol(r, 252)).toBeCloseTo(st.stdev(r) * Math.sqrt(252), 12);
    expect(st.annualReturn([0.1, 0.1], 1)).toBeCloseTo(0.1, 12);
    expect(st.sharpe(r, 252, 0.05)).toBeCloseTo((0.001 * 252 - 0.05) / st.annualVol(r, 252), 9);
    expect(st.sortino(r, 252, 0)).toBeGreaterThan(st.sharpe(r, 252, 0));
    expect(st.sharpe([0.01, 0.01, 0.01], 12, 0)).toBeNaN(); // zero volatility: undefined, not infinite
  });

  it('regression recovers a known beta and alpha', () => {
    const x = Array.from({ length: 300 }, (_, i) => Math.sin(i) * 0.01);
    const y = x.map((v) => 0.0002 + 1.5 * v);
    const reg = st.regress(y, x, 252)!;
    expect(reg.beta).toBeCloseTo(1.5, 9);
    expect(reg.alpha).toBeCloseTo(0.0002 * 252, 9);
    expect(reg.r2).toBeCloseTo(1, 9);
    expect(st.regress([0.01], [0.01], 252)).toBeNull();
  });

  it('normal quantiles and VaR', () => {
    expect(st.normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(st.normInv(0.5)).toBeCloseTo(0, 9);
    expect(st.normInv(0.01)).toBeCloseTo(-2.326348, 5);
    const p = st.parametricVar(0, 0.01, 0.95);
    expect(p.var).toBeCloseTo(0.0164485, 6);
    expect(p.cvar).toBeCloseTo(0.0206271, 6);
    const rets = Array.from({ length: 1000 }, (_, i) => (i - 499.5) / 10_000);
    const h = st.historicalVar(rets, 0.95)!;
    expect(h.var).toBeCloseTo(0.04495, 4);
    expect(h.cvar).toBeGreaterThan(h.var);
    expect(st.historicalVar([0.01, -0.01], 0.95)).toBeNull();
  });

  it('covariance estimators', () => {
    const rows = Array.from({ length: 200 }, (_, t) => [Math.sin(t) * 0.01, Math.cos(t * 1.3) * 0.02, Math.sin(t * 0.7 + 1) * 0.015]);
    const cov = st.covarianceMatrix(rows);
    expect(cov[0][1]).toBeCloseTo(st.covariance(rows.map((r) => r[0]), rows.map((r) => r[1])), 12);
    expect(cov[1][1]).toBeCloseTo(st.variance(rows.map((r) => r[1])), 12);
    const corr = st.correlationFromCov(cov);
    expect(corr[2][2]).toBeCloseTo(1, 12);
    const lw = st.ledoitWolf(rows);
    expect(lw.shrinkage).toBeGreaterThanOrEqual(0);
    expect(lw.shrinkage).toBeLessThanOrEqual(1);
    // shrinkage pulls off-diagonals towards zero and keeps the average variance
    expect(Math.abs(lw.cov[0][1])).toBeLessThanOrEqual(Math.abs(cov[0][1]) + 1e-15);
    const tr = (m: number[][]) => m[0][0] + m[1][1] + m[2][2];
    expect(tr(lw.cov)).toBeCloseTo(tr(cov), 10);
    const ew = st.ewmaCovariance(rows, 0.94);
    expect(ew[0][1]).toBeCloseTo(ew[1][0], 15);
    expect(ew[0][0]).toBeGreaterThan(0);
  });
});

describe('portfolio optimisation', () => {
  it('minimum variance matches the two-asset closed form', () => {
    expect(opt.minVariance([[0.04, 0], [0, 0.09]])[0]).toBeCloseTo(0.09 / 0.13, 6);
    const s12 = 0.3 * 0.2 * 0.3;
    const w = opt.minVariance([[0.04, s12], [s12, 0.09]]);
    expect(w[0]).toBeCloseTo((0.09 - s12) / (0.04 + 0.09 - 2 * s12), 6);
    expect(w[0] + w[1]).toBeCloseTo(1, 12);
  });

  it('maximum Sharpe matches the tangency formula when no constraint binds', () => {
    const mu = [0.1, 0.14, 0.18];
    const cov = [[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.16]];
    const rf = 0.06;
    const raw = mu.map((m, i) => (m - rf) / cov[i][i]);
    const s = raw.reduce((a, b) => a + b, 0);
    const w = opt.maxSharpe(mu, cov, rf);
    w.forEach((wi, i) => expect(wi).toBeCloseTo(raw[i] / s, 4));
  });

  it('maximum Sharpe beats a brute-force grid under constraints', () => {
    const mu = [0.11, 0.15, 0.09, 0.2];
    const sd = [0.18, 0.25, 0.12, 0.4];
    const corr = [
      [1, 0.5, 0.2, 0.4],
      [0.5, 1, 0.1, 0.6],
      [0.2, 0.1, 1, 0.0],
      [0.4, 0.6, 0.0, 1],
    ];
    const cov = corr.map((row, i) => row.map((c, j) => c * sd[i] * sd[j]));
    const cons = { max: [0.4, 0.4, 0.4, 0.4] };
    const rf = 0.065;
    const best = opt.describe(opt.maxSharpe(mu, cov, rf, cons), mu, cov, rf);
    let grid = -Infinity;
    const step = 0.02;
    for (let a = 0; a <= 0.4 + 1e-9; a += step)
      for (let b = 0; b <= 0.4 + 1e-9; b += step)
        for (let c = 0; c <= 0.4 + 1e-9; c += step) {
          const d = 1 - a - b - c;
          if (d < -1e-9 || d > 0.4 + 1e-9) continue;
          grid = Math.max(grid, opt.describe([a, b, c, d], mu, cov, rf).sharpe);
        }
    expect(best.sharpe).toBeGreaterThanOrEqual(grid - 1e-6);
    expect(best.sharpe - grid).toBeLessThan(0.01);
    best.weights.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(-1e-9);
      expect(w).toBeLessThanOrEqual(0.4 + 1e-9);
    });
  });

  it('respects caps, minimums and group limits', () => {
    const cov = [[0.04, 0.01, 0.0], [0.01, 0.09, 0.02], [0.0, 0.02, 0.16]];
    const capped = opt.minVariance(cov, { max: [0.4, 0.4, 0.4] });
    expect(Math.max(...capped)).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(capped.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const floor = opt.minVariance(cov, { min: [0, 0, 0.3] });
    expect(floor[2]).toBeGreaterThanOrEqual(0.3 - 1e-9);
    const group = opt.minVariance(cov, { groups: [{ members: [0, 1], max: 0.5 }] });
    expect(group[0] + group[1]).toBeLessThanOrEqual(0.5 + 1e-9);
    const target = opt.minVarianceForReturn([0.08, 0.12, 0.2], cov, 0.15);
    expect(target[0] * 0.08 + target[1] * 0.12 + target[2] * 0.2).toBeGreaterThanOrEqual(0.15 - 1e-8);
  });

  it('explains infeasible constraints instead of returning nonsense', () => {
    const cov = [[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.16]];
    expect(() => opt.minVariance(cov, { max: [0.2, 0.2, 0.2] })).toThrow(/cannot be fully invested/);
    expect(() => opt.minVariance(cov, { min: [0.5, 0.5, 0.5] })).toThrow(/more than 100%/);
    expect(opt.feasibilityProblem(3, { groups: [{ members: [0, 1, 2], max: 0.5, label: 'Banks' }] })).toMatch(/Banks/);
    expect(() => opt.minVarianceForReturn([0.08, 0.12, 0.2], cov, 0.5)).toThrow(opt.InfeasibleError);
  });

  it('efficient frontier rises in both risk and return', () => {
    const mu = [0.08, 0.12, 0.2];
    const cov = [[0.04, 0.01, 0.0], [0.01, 0.09, 0.02], [0.0, 0.02, 0.16]];
    const f = opt.efficientFrontier(mu, cov, 0.06, {}, 20);
    expect(f.length).toBeGreaterThan(15);
    for (let i = 1; i < f.length; i++) {
      expect(f[i].ret).toBeGreaterThanOrEqual(f[i - 1].ret - 1e-9);
      expect(f[i].vol).toBeGreaterThanOrEqual(f[i - 1].vol - 1e-7);
    }
    expect(f[f.length - 1].weights[2]).toBeCloseTo(1, 4); // top of the frontier is the highest-return asset
  });

  it('risk parity equalises risk contributions', () => {
    const sd = [0.1, 0.2, 0.3];
    const corr = [[1, 0.3, 0.1], [0.3, 1, 0.5], [0.1, 0.5, 1]];
    const cov = corr.map((row, i) => row.map((c, j) => c * sd[i] * sd[j]));
    const w = opt.riskParity(cov);
    const rc = opt.riskContributions(w, cov);
    rc.forEach((v) => expect(v).toBeCloseTo(1 / 3, 6));
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const iv = opt.inverseVolatility(cov);
    expect(iv[0] / iv[1]).toBeCloseTo(2, 9);
    expect(opt.diversificationRatio(w, cov)).toBeGreaterThan(1);
  });

  it('return shrinkage and CAPM', () => {
    opt.shrinkReturns([0.1, 0.2], 1).forEach((v) => expect(v).toBeCloseTo(0.15, 12));
    expect(opt.shrinkReturns([0.1, 0.2], 0)).toEqual([0.1, 0.2]);
    expect(opt.capmReturn(0.07, 1.2, 0.06)).toBeCloseTo(0.142, 12);
  });
});

describe('backtest and performance', () => {
  it('buy and hold of one asset tracks its price', () => {
    const dates = isoDays('2024-01-01', 367);
    const prices = dates.map((_, i) => [100 * Math.pow(2, i / 366)]);
    const r = bt.backtest({ dates, prices, weights: [1], initial: 1000, rebalance: 'none' });
    expect(r.value[366]).toBeCloseTo(2000, 6);
    expect(r.performance!.totalReturn).toBeCloseTo(1, 9);
    expect(r.performance!.cagr).toBeCloseTo(Math.pow(2, 365.25 / 366) - 1, 6);
    expect(r.performance!.maxDrawdown).toBe(0);
    expect(r.xirr).toBeCloseTo(Math.pow(2, 365 / 366) - 1, 6);
  });

  it('rebalancing differs from letting weights drift', () => {
    const dates = isoDays('2024-01-01', 400);
    const prices = dates.map((_, i) => [100 * (1 + 0.5 * Math.sin(i / 20)) + 100, 100 * (1 + 0.5 * Math.cos(i / 20)) + 100]);
    const hold = bt.backtest({ dates, prices, weights: [0.5, 0.5], initial: 1000, rebalance: 'none' });
    const reb = bt.backtest({ dates, prices, weights: [0.5, 0.5], initial: 1000, rebalance: 'monthly' });
    expect(reb.rebalances).toBeGreaterThan(10);
    expect(hold.rebalances).toBe(0);
    expect(reb.value[399]).not.toBeCloseTo(hold.value[399], 2);
    // out-of-phase assets: rebalancing harvests the swings
    expect(reb.value[399]).toBeGreaterThan(hold.value[399]);
    const costly = bt.backtest({ dates, prices, weights: [0.5, 0.5], initial: 1000, rebalance: 'monthly', costBps: 50 });
    expect(costly.value[399]).toBeLessThan(reb.value[399]);
    expect(costly.totalCosts).toBeGreaterThan(0);
    const thr = bt.backtest({ dates, prices, weights: [0.5, 0.5], initial: 1000, rebalance: 'threshold', threshold: 0.05 });
    expect(thr.rebalances).toBeGreaterThan(0);
  });

  it('contributions add to value but not to time-weighted return', () => {
    const dates = isoDays('2024-01-01', 100);
    const prices = dates.map(() => [50, 80]);
    const r = bt.backtest({ dates, prices, weights: [0.6, 0.4], initial: 1000, monthlyContribution: 100, rebalance: 'quarterly' });
    expect(r.value[99]).toBeCloseTo(1300, 9); // Feb, Mar, Apr contributions
    expect(r.invested[99]).toBe(1300);
    expect(r.nav[99]).toBeCloseTo(1, 12);
    expect(r.finalWeights[0]).toBeCloseTo(0.6, 12);
  });

  it('performance statistics', () => {
    const dates = ['2022-01-03', '2022-12-30', '2023-12-29', '2024-12-31'];
    const p = bt.performance(dates, [100, 110, 99, 120])!;
    expect(p.totalReturn).toBeCloseTo(0.2, 12);
    expect(p.maxDrawdown).toBeCloseTo(-0.1, 12);
    expect(p.yearly.map((y) => y.year)).toEqual([2022, 2023, 2024]);
    expect(p.yearly[1].ret).toBeCloseTo(-0.1, 12);
    expect(p.worstYear!.year).toBe(2023);
    expect(bt.performance(['2024-01-01'], [100])).toBeNull();
    const roll = bt.rollingReturns(isoDays('2020-01-01', 800), isoDays('2020-01-01', 800).map((_, i) => Math.pow(1.1, i / 365.25)), 1);
    expect(roll.length).toBeGreaterThan(400);
    roll.forEach((x) => expect(x.ret).toBeCloseTo(0.1, 6));
  });

  it('rejects bad inputs', () => {
    expect(() => bt.backtest({ dates: ['2024-01-01', '2024-01-02'], prices: [[1], [1]], weights: [0.5], initial: 1, rebalance: 'none' })).toThrow(/100%/);
  });
});

describe('Monte Carlo', () => {
  const base: mc.SimulationInput = {
    model: { kind: 'lognormal', expectedReturn: 0.1, volatility: 0 },
    years: 10,
    initial: 100_000,
    monthlyContribution: 0,
    contributionGrowth: 0,
    monthlyWithdrawal: 0,
    withdrawalStartYear: 0,
    inflation: 0,
    annualFee: 0,
    paths: 500,
    seed: 7,
  };

  it('with zero volatility every path compounds at the expected return', () => {
    const r = mc.simulate(base);
    expect(r.p50[10]).toBeCloseTo(100_000 * Math.pow(1.1, 10), 4);
    expect(r.p5[10]).toBeCloseTo(r.p95[10], 4);
    expect(r.survival).toBe(1);
  });

  it('is reproducible and the average matches the expected return', () => {
    const input = { ...base, model: { kind: 'lognormal' as const, expectedReturn: 0.12, volatility: 0.2 }, years: 1, paths: 20000 };
    const a = mc.simulate(input);
    const b = mc.simulate(input);
    expect(a.terminal[123]).toBe(b.terminal[123]);
    const avg = a.terminal.reduce((s, v) => s + v, 0) / a.terminal.length;
    expect(avg / 100_000 - 1).toBeCloseTo(0.12, 2);
    const sd = Math.sqrt(a.terminal.reduce((s, v) => s + (v - avg) ** 2, 0) / a.terminal.length) / 100_000;
    expect(sd).toBeCloseTo(0.2, 2);
    expect(a.p5[1]).toBeLessThan(a.p50[1]);
    expect(a.p50[1]).toBeLessThan(a.p95[1]);
    expect(a.p50[1]).toBeLessThan(avg); // volatility drag: the median sits below the mean
    expect(mc.simulate({ ...input, seed: 8 }).terminal[123]).not.toBe(a.terminal[123]);
  });

  it('contributions, fees and inflation', () => {
    const r = mc.simulate({ ...base, model: { kind: 'lognormal', expectedReturn: 0, volatility: 0 }, monthlyContribution: 1_000, contributionGrowth: 0.1, years: 2 });
    expect(r.totalContributed).toBeCloseTo(100_000 + 12_000 + 13_200, 6);
    expect(r.p50[2]).toBeCloseTo(125_200, 4);
    const fee = mc.simulate({ ...base, annualFee: 0.01, years: 1 });
    expect(fee.p50[1]).toBeCloseTo(100_000 * 1.1 * 0.99, 4);
    const infl = mc.simulate({ ...base, inflation: 0.05, years: 10 });
    expect(infl.terminalReal[0]).toBeCloseTo((100_000 * Math.pow(1.1, 10)) / Math.pow(1.05, 10), 4);
  });

  it('withdrawals can exhaust the money', () => {
    const r = mc.simulate({ ...base, model: { kind: 'lognormal', expectedReturn: 0, volatility: 0 }, monthlyWithdrawal: 5_000, years: 5 });
    expect(r.survival).toBe(0);
    expect(r.medianDepletionYear).toBeCloseTo(21 / 12, 6);
    const safe = mc.simulate({ ...base, monthlyWithdrawal: 500, years: 5 });
    expect(safe.survival).toBe(1);
    const goal = mc.simulate({ ...base, goal: 200_000 });
    expect(goal.goalProbability).toBe(1);
  });

  it('fat tails and bootstrap models run and stay finite', () => {
    const t = mc.simulate({ ...base, model: { kind: 'fat-tails', expectedReturn: 0.1, volatility: 0.2, degreesOfFreedom: 4 }, paths: 2000 });
    expect(t.terminal.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    const hist = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? -0.03 : 0.025));
    const b = mc.simulate({ ...base, model: { kind: 'bootstrap', monthlyReturns: hist, blockMonths: 6 }, paths: 1000 });
    expect(b.p50[10]).toBeGreaterThan(100_000);
    expect(() => mc.simulate({ ...base, model: { kind: 'bootstrap', monthlyReturns: [0.01], blockMonths: 6 } })).toThrow(/24 months/);
  });

  it('lognormal parameters reproduce the requested annual mean', () => {
    const { m, s } = mc.lognormalMonthly(0.12, 0.25);
    expect(Math.exp(12 * m + (12 * s * s) / 2)).toBeCloseTo(1.12, 12);
  });
});

describe('portfolio accounting', () => {
  const t = (p: Partial<pf.Txn> & Pick<pf.Txn, 'date' | 'type' | 'symbol'>): pf.Txn => ({ id: Math.random().toString(36), qty: 0, price: 0, ...p });

  it('FIFO lots, realised gains and remaining cost', () => {
    const led = pf.buildLedger([
      t({ date: '2024-01-10', type: 'buy', symbol: 'A', qty: 10, price: 100 }),
      t({ date: '2024-06-10', type: 'buy', symbol: 'A', qty: 10, price: 120 }),
      t({ date: '2025-03-01', type: 'sell', symbol: 'A', qty: 15, price: 150 }),
    ]);
    const h = led.holdings.A;
    expect(h.qty).toBe(5);
    expect(h.avgCost).toBe(120);
    expect(h.invested).toBe(600);
    expect(h.realised).toBe(10 * 50 + 5 * 30);
    expect(led.realised).toHaveLength(2);
    expect(led.realised[0].longTerm).toBe(true); // Jan 2024 → Mar 2025
    expect(led.realised[1].longTerm).toBe(false); // Jun 2024 → Mar 2025
    expect(led.realised[0].financialYear).toBe('2024-25');
    expect(led.issues).toHaveLength(0);
  });

  it('fees, currency conversion, dividends and overselling', () => {
    const led = pf.buildLedger([
      t({ date: '2024-01-10', type: 'buy', symbol: 'US', qty: 2, price: 100, fx: 83, fees: 40 }),
      t({ date: '2024-02-10', type: 'dividend', symbol: 'US', amount: 55 }),
      t({ date: '2024-03-10', type: 'sell', symbol: 'US', qty: 5, price: 110, fx: 84, fees: 50 }),
    ]);
    const h = led.holdings.US;
    expect(h.qty).toBe(0);
    expect(h.dividends).toBe(55);
    expect(led.issues[0]).toMatch(/only 2 were held/);
    // sold 2 of the 5 requested: net proceeds per share = (5×110×84 − 50) / 5
    expect(h.realised).toBeCloseTo(2 * ((5 * 110 * 84 - 50) / 5) - (2 * 100 * 83 + 40), 8);
  });

  it('splits restate lots without changing total cost', () => {
    const led = pf.buildLedger([
      t({ date: '2024-01-10', type: 'buy', symbol: 'S', qty: 10, price: 1000 }),
      t({ date: '2024-05-01', type: 'split', symbol: 'S', qty: 5 }),
      t({ date: '2024-06-01', type: 'sell', symbol: 'S', qty: 20, price: 250 }),
    ]);
    expect(led.holdings.S.qty).toBe(30);
    expect(led.holdings.S.avgCost).toBe(200);
    expect(led.holdings.S.realised).toBe(20 * 50);
    expect(pf.buildLedger([t({ date: '2024-01-10', type: 'buy', symbol: 'S', qty: 10, price: 1000 }), t({ date: '2024-05-01', type: 'split', symbol: 'S', qty: 5 })], '2024-02-01').holdings.S.qty).toBe(10);
  });

  it('valuation, weights and the if-sold-today tax split', () => {
    const led = pf.buildLedger([
      t({ date: '2024-01-10', type: 'buy', symbol: 'A', qty: 10, price: 100 }),
      t({ date: '2025-10-10', type: 'buy', symbol: 'A', qty: 10, price: 200 }),
      t({ date: '2025-01-10', type: 'buy', symbol: 'B', qty: 5, price: 400 }),
      t({ date: '2025-01-10', type: 'buy', symbol: 'C', qty: 1, price: 10 }),
    ]);
    const v = pf.valuePortfolio(led, { A: { price: 250, prevClose: 245 }, B: { price: 300, prevClose: 300 } }, 1500, '2025-12-01');
    expect(v.holdingsValue).toBe(5000 + 1500);
    expect(v.total).toBe(8000);
    expect(v.unpriced).toEqual(['C']);
    const a = v.positions.find((p) => p.symbol === 'A')!;
    expect(a.weight).toBeCloseTo(5000 / 8000, 12);
    expect(a.unrealised).toBe(2000);
    expect(a.longTermGain).toBe(1500);
    expect(a.shortTermGain).toBe(500);
    expect(a.dayChange).toBe(100);
    expect(v.unrealised).toBe(2000 - 500);
    expect(v.dayChangePct).toBeCloseTo(100 / 6400, 12);
  });

  it('money-weighted return', () => {
    const txns = [t({ date: '2025-01-01', type: 'buy', symbol: 'A', qty: 1000, price: 100 })];
    expect(pf.portfolioXirr(txns, 110_000, '2026-01-01').rate).toBeCloseTo(0.1, 9);
    expect(pf.portfolioXirr([], 0, '2026-01-01').rate).toBeNull();
  });

  it('concentration', () => {
    const c = pf.concentration([0.25, 0.25, 0.25, 0.25]);
    expect(c.hhi).toBeCloseTo(0.25, 12);
    expect(c.effectiveHoldings).toBeCloseTo(4, 12);
    expect(c.top3).toBeCloseTo(0.75, 12);
    expect(pf.concentration([1]).effectiveHoldings).toBe(1);
    const g = pf.groupWeights([{ value: 60, s: 'IT' }, { value: 30, s: 'Bank' }, { value: 10, s: 'IT' }, { value: null, s: 'X' }], (x) => x.s, 100);
    expect(g[0]).toEqual({ key: 'IT', value: 70, weight: 0.7 });
  });

  it('full rebalance reaches the targets', () => {
    const r = pf.rebalance({
      assets: [
        { symbol: 'A', value: 7000, price: 100, target: 0.5 },
        { symbol: 'B', value: 3000, price: 50, target: 0.4 },
      ],
      cash: 0,
      cashTarget: 0.1,
      newMoney: 0,
      mode: 'full',
      wholeShares: false,
    });
    expect(r.trades[0]).toMatchObject({ action: 'SELL', shares: 20 });
    expect(r.trades[1]).toMatchObject({ action: 'BUY', shares: 20 });
    expect(r.cashAfter).toBeCloseTo(1000, 9);
    expect(r.maxDrift).toBeCloseTo(0, 12);
    expect(r.turnover).toBeCloseTo(0.3, 12);
  });

  it('buy-only rebalance never sells and spends only spare cash', () => {
    const r = pf.rebalance({
      assets: [
        { symbol: 'A', value: 7000, price: 100, target: 0.5 },
        { symbol: 'B', value: 3000, price: 50, target: 0.5 },
      ],
      cash: 0,
      cashTarget: 0,
      newMoney: 2000,
      mode: 'buy-only',
      wholeShares: true,
    });
    expect(r.trades[0].action).toBe('HOLD');
    expect(r.trades[1]).toMatchObject({ action: 'BUY', shares: 40 });
    expect(r.cashAfter).toBeCloseTo(0, 9);
    expect(() => pf.rebalance({ assets: [{ symbol: 'A', value: 1, price: 1, target: 0.5 }], cash: 0, cashTarget: 0, newMoney: 0, mode: 'full', wholeShares: false })).toThrow(/100%/);
  });

  it('whole-share rounding leaves the remainder in cash', () => {
    const r = pf.rebalance({
      assets: [{ symbol: 'A', value: 0, price: 300, target: 1 }],
      cash: 1000,
      cashTarget: 0,
      newMoney: 0,
      mode: 'full',
      wholeShares: true,
    });
    expect(r.trades[0].shares).toBe(3);
    expect(r.cashAfter).toBe(100);
  });

  it('history: time-weighted return ignores the timing of new money', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04'];
    const h = pf.buildHistory({
      txns: [t({ date: '2025-01-01', type: 'buy', symbol: 'A', qty: 10, price: 100 }), t({ date: '2025-01-02', type: 'buy', symbol: 'A', qty: 10, price: 110 })],
      dates,
      prices: { A: [100, 110, 121, 121] },
    })!;
    expect(h.value).toEqual([1000, 2200, 2420, 2420]);
    expect(h.netInvested).toEqual([1000, 2100, 2100, 2100]);
    expect(h.twr[2]).toBeCloseTo(1.21, 12);
    expect(h.startIndex).toBe(0);
  });

  it('history handles sells, dividends, splits and weekend trades', () => {
    const dates = ['2025-01-06', '2025-01-07', '2025-01-08'];
    const h = pf.buildHistory({
      txns: [
        t({ date: '2025-01-04', type: 'buy', symbol: 'A', qty: 10, price: 500 }), // Saturday → settles Monday
        t({ date: '2025-01-07', type: 'split', symbol: 'A', qty: 5 }),
        t({ date: '2025-01-07', type: 'dividend', symbol: 'A', amount: 100 }),
        t({ date: '2025-01-08', type: 'sell', symbol: 'A', qty: 25, price: 110 }),
      ],
      dates,
      prices: { A: [100, 100, 110] }, // split-adjusted history
    })!;
    expect(h.value[0]).toBe(5000);
    expect(h.value[1]).toBe(5000);
    expect(h.twr[1]).toBeCloseTo(1.02, 12); // dividend counted as return
    expect(h.value[2]).toBe(25 * 110);
    expect(h.twr[2]).toBeCloseTo(1.02 * 1.1, 12);
    expect(pf.buildHistory({ txns: [], dates, prices: {} })).toBeNull();
  });

  it('estimates dividends from ex-dividend history', () => {
    const txns = [
      t({ date: '2024-01-10', type: 'buy', symbol: 'A', qty: 10, price: 1000 }),
      t({ date: '2024-05-01', type: 'split', symbol: 'A', qty: 2 }),
      t({ date: '2024-08-01', type: 'sell', symbol: 'A', qty: 5, price: 600 }),
    ];
    const est = pf.estimateDividends(txns, { A: [{ date: '2023-12-01', perShare: 5 }, { date: '2024-03-01', perShare: 4 }, { date: '2024-09-01', perShare: 6 }] });
    expect(est).toEqual([
      { symbol: 'A', date: '2024-03-01', amount: 80 }, // 10 shares = 20 in today's units × 4 (split-adjusted)
      { symbol: 'A', date: '2024-09-01', amount: 90 },
    ]);
  });
});
