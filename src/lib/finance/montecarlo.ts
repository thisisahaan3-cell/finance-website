/**
 * Monte Carlo simulation of a portfolio with contributions and withdrawals.
 * Seeded, so the same inputs always produce the same result.
 */

/** Small, fast, seedable PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box–Muller). */
export function normalSampler(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u < 1e-12) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export type ReturnModel =
  | { kind: 'lognormal'; expectedReturn: number; volatility: number }
  | { kind: 'fat-tails'; expectedReturn: number; volatility: number; degreesOfFreedom: number }
  | { kind: 'bootstrap'; monthlyReturns: number[]; blockMonths: number };

export interface SimulationInput {
  model: ReturnModel;
  years: number;
  initial: number;
  /** monthly amount added while accumulating */
  monthlyContribution: number;
  /** yearly growth of the contribution (step-up) */
  contributionGrowth: number;
  /** stop contributing after this many years (defaults to the whole horizon) */
  contributionYears?: number;
  /** monthly withdrawal in today's money, starting after `withdrawalStartYear` */
  monthlyWithdrawal: number;
  withdrawalStartYear: number;
  /** withdrawals rise with this inflation rate; results can also be shown in today's money */
  inflation: number;
  /** yearly cost (expense ratio, fees) deducted from returns */
  annualFee: number;
  paths: number;
  seed: number;
  /** optional target to measure success against, in today's money */
  goal?: number;
}

export interface SimulationResult {
  months: number;
  /** percentile paths by year (index 0 = today), nominal */
  years: number[];
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
  /** final values of every path, nominal and in today's money */
  terminal: number[];
  terminalReal: number[];
  totalContributed: number;
  /** share of paths that never run out of money */
  survival: number;
  /** share of paths that end at or above the goal (in today's money) */
  goalProbability: number | null;
  medianDepletionYear: number | null;
}

/** Monthly log-return parameters so that the ANNUAL simple return has the given mean and volatility. */
export function lognormalMonthly(expectedReturn: number, volatility: number): { m: number; s: number } {
  const varLog = Math.log(1 + (volatility * volatility) / ((1 + expectedReturn) * (1 + expectedReturn)));
  const meanLog = Math.log(1 + expectedReturn) - varLog / 2;
  return { m: meanLog / 12, s: Math.sqrt(varLog / 12) };
}

function pct(sorted: Float64Array, p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function simulate(input: SimulationInput): SimulationResult {
  const months = Math.round(input.years * 12);
  const paths = Math.max(100, Math.min(20000, Math.round(input.paths)));
  if (months < 1) throw new Error('Simulate at least one month.');
  const rand = rng(input.seed);
  const z = normalSampler(rand);
  const feeMonthly = Math.pow(1 - Math.min(0.5, Math.max(0, input.annualFee)), 1 / 12);
  const inflMonthly = Math.pow(1 + input.inflation, 1 / 12);
  const contributionMonths = Math.round((input.contributionYears ?? input.years) * 12);
  const withdrawStart = Math.round(input.withdrawalStartYear * 12);

  let draw: () => number; // one month's gross growth factor
  const model = input.model;
  if (model.kind === 'lognormal') {
    const { m, s } = lognormalMonthly(model.expectedReturn, model.volatility);
    draw = () => Math.exp(m + s * z());
  } else if (model.kind === 'fat-tails') {
    const { m, s } = lognormalMonthly(model.expectedReturn, model.volatility);
    const df = Math.max(3, Math.round(model.degreesOfFreedom));
    const scale = Math.sqrt((df - 2) / df); // Student-t rescaled to unit variance
    draw = () => {
      let chi = 0;
      for (let k = 0; k < df; k++) {
        const n = z();
        chi += n * n;
      }
      const t = z() / Math.sqrt(chi / df);
      return Math.exp(m + s * scale * t);
    };
  } else {
    const hist = model.monthlyReturns.filter((r) => Number.isFinite(r) && r > -1);
    if (hist.length < 24) throw new Error('Bootstrap needs at least 24 months of history.');
    const block = Math.max(1, Math.round(model.blockMonths));
    let pos = 0;
    let left = 0;
    draw = () => {
      if (left === 0) {
        pos = Math.floor(rand() * hist.length);
        left = block;
      }
      const r = hist[pos % hist.length];
      pos++;
      left--;
      return 1 + r;
    };
  }

  const nYears = Math.ceil(months / 12);
  const byYear: Float64Array[] = Array.from({ length: nYears + 1 }, () => new Float64Array(paths));
  const terminal: number[] = new Array(paths);
  const terminalReal: number[] = new Array(paths);
  const depletion: number[] = [];
  let survived = 0;
  let totalContributed = input.initial;
  {
    let c = input.monthlyContribution;
    for (let m = 1; m <= Math.min(months, contributionMonths); m++) {
      totalContributed += c;
      if (m % 12 === 0) c *= 1 + input.contributionGrowth;
    }
  }

  for (let p = 0; p < paths; p++) {
    let value = input.initial;
    let contribution = input.monthlyContribution;
    let withdrawal = input.monthlyWithdrawal * Math.pow(inflMonthly, withdrawStart);
    let depleted = -1;
    byYear[0][p] = value;
    for (let m = 1; m <= months; m++) {
      if (m <= contributionMonths) value += contribution;
      if (m > withdrawStart && input.monthlyWithdrawal > 0) {
        if (value <= withdrawal) {
          if (depleted < 0 && value < withdrawal) depleted = m;
          value = 0;
        } else value -= withdrawal;
        withdrawal *= inflMonthly;
      }
      if (value > 0) value *= draw() * feeMonthly;
      if (m % 12 === 0) {
        contribution *= 1 + input.contributionGrowth;
        byYear[m / 12][p] = value;
      }
    }
    if (months % 12 !== 0) byYear[nYears][p] = value;
    terminal[p] = value;
    terminalReal[p] = value / Math.pow(1 + input.inflation, months / 12);
    if (depleted < 0) survived++;
    else depletion.push(depleted / 12);
  }

  const years: number[] = [];
  const out = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  for (let y = 0; y <= nYears; y++) {
    const sorted = byYear[y].slice().sort();
    years.push(Math.min(y, months / 12));
    out.p5.push(pct(sorted, 0.05));
    out.p25.push(pct(sorted, 0.25));
    out.p50.push(pct(sorted, 0.5));
    out.p75.push(pct(sorted, 0.75));
    out.p95.push(pct(sorted, 0.95));
  }
  depletion.sort((a, b) => a - b);
  return {
    months,
    years,
    ...out,
    terminal,
    terminalReal,
    totalContributed,
    survival: survived / paths,
    goalProbability: input.goal && input.goal > 0 ? terminalReal.filter((v) => v >= input.goal!).length / paths : null,
    medianDepletionYear: depletion.length ? depletion[Math.floor(depletion.length / 2)] : null,
  };
}
