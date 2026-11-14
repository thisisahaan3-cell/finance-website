/**
 * Mean–variance portfolio optimisation (Markowitz) with practical constraints.
 *
 * Quadratic programmes are solved with the Goldfarb–Idnani dual active-set method
 * (the `quadprog` package, a port of the R routine). Inputs are ANNUALISED expected
 * returns (`mu`) and an ANNUALISED covariance matrix (`cov`).
 */
// @ts-expect-error quadprog ships no type declarations
import quadprog from 'quadprog';

export class InfeasibleError extends Error {}

export interface GroupLimit {
  /** indices of the assets in the group (for example, one sector) */
  members: number[];
  min?: number;
  max?: number;
  label?: string;
}

export interface Constraints {
  /** lower bound per asset (default 0 = long-only) */
  min?: number[];
  /** upper bound per asset (default 1) */
  max?: number[];
  groups?: GroupLimit[];
}

export interface PortfolioPoint {
  weights: number[];
  ret: number;
  vol: number;
  sharpe: number;
}

interface LinCon {
  a: number[];
  b: number;
  eq?: boolean;
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

export function portfolioVariance(w: number[], cov: number[][]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += w[i] * cov[i][j] * w[j];
  return s;
}

export function describe(w: number[], mu: number[], cov: number[][], rf: number): PortfolioPoint {
  const ret = dot(w, mu);
  const vol = Math.sqrt(Math.max(0, portfolioVariance(w, cov)));
  return { weights: w, ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : NaN };
}

/** Each asset's share of total portfolio variance (sums to 1). */
export function riskContributions(w: number[], cov: number[][]): number[] {
  const v = portfolioVariance(w, cov);
  if (!(v > 0)) return w.map(() => 0);
  return w.map((wi, i) => (wi * dot(cov[i], w)) / v);
}

/** Diversification ratio: weighted average volatility ÷ portfolio volatility (1 = no diversification benefit). */
export function diversificationRatio(w: number[], cov: number[][]): number {
  const vol = Math.sqrt(portfolioVariance(w, cov));
  return vol > 0 ? w.reduce((s, wi, i) => s + wi * Math.sqrt(cov[i][i]), 0) / vol : NaN;
}

function bounds(n: number, c: Constraints): { lo: number[]; hi: number[] } {
  const lo = Array.from({ length: n }, (_, i) => c.min?.[i] ?? 0);
  const hi = Array.from({ length: n }, (_, i) => c.max?.[i] ?? 1);
  return { lo, hi };
}

/** Quick, human-readable feasibility check before any solver runs. Returns null when the constraints can be met. */
export function feasibilityProblem(n: number, c: Constraints): string | null {
  const { lo, hi } = bounds(n, c);
  for (let i = 0; i < n; i++) if (lo[i] > hi[i] + 1e-12) return 'An asset has a minimum weight above its maximum.';
  const sumLo = lo.reduce((s, v) => s + v, 0);
  const sumHi = hi.reduce((s, v) => s + v, 0);
  if (sumLo > 1 + 1e-9) return `The minimum weights add up to ${(sumLo * 100).toFixed(1)}%, which is more than 100%.`;
  if (sumHi < 1 - 1e-9) return `The maximum weights add up to only ${(sumHi * 100).toFixed(1)}%, so the portfolio cannot be fully invested. Raise the per-stock cap or add more stocks.`;
  for (const g of c.groups ?? []) {
    const gLo = g.members.reduce((s, i) => s + lo[i], 0);
    const gHi = g.members.reduce((s, i) => s + hi[i], 0);
    const name = g.label ?? 'A group';
    if (g.max !== undefined && gLo > g.max + 1e-9) return `${name}: the minimum weights of its stocks exceed the group cap.`;
    if (g.min !== undefined && gHi < g.min - 1e-9) return `${name}: its stocks cannot reach the group minimum.`;
    if (g.max !== undefined) {
      const others = hi.reduce((s, v, i) => s + (g.members.includes(i) ? 0 : v), 0);
      if (others + Math.min(g.max, gHi) < 1 - 1e-9) return `${name}: with this cap the remaining stocks cannot absorb the rest of the portfolio.`;
    }
  }
  return null;
}

function linearConstraints(n: number, c: Constraints): LinCon[] {
  const { lo, hi } = bounds(n, c);
  const cons: LinCon[] = [{ a: new Array(n).fill(1), b: 1, eq: true }];
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    cons.push({ a: e, b: lo[i] });
    cons.push({ a: e.map((v) => -v), b: -hi[i] });
  }
  for (const g of c.groups ?? []) {
    const a = new Array(n).fill(0);
    for (const i of g.members) a[i] = 1;
    if (g.max !== undefined) cons.push({ a: a.map((v) => -v), b: -g.max });
    if (g.min !== undefined) cons.push({ a, b: g.min });
  }
  return cons;
}

/** minimise ½·xᵀDx − dᵀx  subject to  aᵀx ≥ b (or = b for `eq`). */
function solveQp(D: number[][], d: number[], cons: LinCon[]): number[] {
  const n = d.length;
  const ordered = [...cons.filter((c) => c.eq), ...cons.filter((c) => !c.eq)];
  const meq = cons.filter((c) => c.eq).length;
  const q = ordered.length;
  // quadprog uses 1-based arrays and overwrites Dmat.
  const Dmat: number[][] = [[]];
  for (let i = 0; i < n; i++) Dmat.push([0, ...D[i]]);
  const dvec = [0, ...d];
  const Amat: number[][] = [[]];
  for (let i = 0; i < n; i++) {
    const row = new Array(q + 1).fill(0);
    for (let j = 0; j < q; j++) row[j + 1] = ordered[j].a[i];
    Amat.push(row);
  }
  const bvec = [0, ...ordered.map((c) => c.b)];
  const res = quadprog.solveQP(Dmat, dvec, Amat, bvec, meq);
  if (res.message) throw new InfeasibleError('No portfolio satisfies all the constraints at once. Loosen a cap or a minimum.');
  const x: number[] = res.solution.slice(1, n + 1);
  if (!x.every((v) => Number.isFinite(v))) throw new InfeasibleError('The optimiser could not find a stable solution for these inputs.');
  return x;
}

/** Covariance with a tiny ridge so it is strictly positive definite even with short or collinear histories. */
function regularise(cov: number[][]): number[][] {
  const n = cov.length;
  let tr = 0;
  for (let i = 0; i < n; i++) tr += cov[i][i];
  const ridge = Math.max(1e-10, (tr / n) * 1e-8);
  return cov.map((row, i) => row.map((v, j) => (i === j ? v + ridge : v)));
}

function clean(w: number[], c: Constraints): number[] {
  const { lo, hi } = bounds(w.length, c);
  const x = w.map((v, i) => Math.min(hi[i], Math.max(lo[i], Math.abs(v) < 1e-9 ? 0 : v)));
  const s = x.reduce((a, b) => a + b, 0);
  return s > 0 ? x.map((v) => v / s) : x;
}

function check(n: number, c: Constraints) {
  const problem = feasibilityProblem(n, c);
  if (problem) throw new InfeasibleError(problem);
}

/** The lowest-volatility fully invested portfolio. */
export function minVariance(cov: number[][], c: Constraints = {}): number[] {
  const n = cov.length;
  check(n, c);
  return clean(solveQp(regularise(cov), new Array(n).fill(0), linearConstraints(n, c)), c);
}

/** Lowest-volatility portfolio with expected return of at least `target`. */
export function minVarianceForReturn(mu: number[], cov: number[][], target: number, c: Constraints = {}): number[] {
  const n = cov.length;
  check(n, c);
  const cons = linearConstraints(n, c);
  cons.push({ a: mu, b: target });
  return clean(solveQp(regularise(cov), new Array(n).fill(0), cons), c);
}

/** The highest expected return the constraints allow (a linear programme, solved as a QP with a vanishing risk term). */
export function maxReturn(mu: number[], c: Constraints = {}): number[] {
  const n = mu.length;
  check(n, c);
  const scale = Math.max(1e-6, ...mu.map(Math.abs));
  const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? scale * 1e-6 : 0)));
  return clean(solveQp(D, mu, linearConstraints(n, c)), c);
}

/**
 * Maximum Sharpe ratio (tangency) portfolio under the constraints.
 * The Sharpe ratio is unimodal along the efficient frontier, so a golden-section search
 * over the target return finds it; each step solves one minimum-variance QP.
 */
export function maxSharpe(mu: number[], cov: number[][], rf: number, c: Constraints = {}): number[] {
  const wMin = minVariance(cov, c);
  const wMax = maxReturn(mu, c);
  let lo = dot(wMin, mu);
  let hi = dot(wMax, mu);
  if (hi - lo < 1e-9) return wMin;
  const sharpeAt = (target: number): { s: number; w: number[] } => {
    const w = minVarianceForReturn(mu, cov, Math.min(target, hi - 1e-12), c);
    const p = describe(w, mu, cov, rf);
    return { s: Number.isFinite(p.sharpe) ? p.sharpe : -Infinity, w };
  };
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = sharpeAt(x1);
  let f2 = sharpeAt(x2);
  for (let i = 0; i < 48 && hi - lo > 1e-7; i++) {
    if (f1.s < f2.s) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = sharpeAt(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = sharpeAt(x1);
    }
  }
  const candidates = [f1, f2, { s: describe(wMin, mu, cov, rf).sharpe, w: wMin }, { s: describe(wMax, mu, cov, rf).sharpe, w: wMax }];
  candidates.sort((a, b) => (Number.isFinite(b.s) ? b.s : -Infinity) - (Number.isFinite(a.s) ? a.s : -Infinity));
  return candidates[0].w;
}

/** Points along the efficient frontier, from minimum variance up to maximum return. */
export function efficientFrontier(mu: number[], cov: number[][], rf: number, c: Constraints = {}, points = 30): PortfolioPoint[] {
  const wMin = minVariance(cov, c);
  const wMax = maxReturn(mu, c);
  const lo = dot(wMin, mu);
  const hi = dot(wMax, mu);
  const out: PortfolioPoint[] = [describe(wMin, mu, cov, rf)];
  if (hi - lo < 1e-9) return out;
  for (let k = 1; k < points; k++) {
    const target = lo + ((hi - lo) * k) / (points - 1);
    try {
      out.push(describe(minVarianceForReturn(mu, cov, Math.min(target, hi - 1e-12), c), mu, cov, rf));
    } catch {
      /* skip a numerically awkward point; the neighbours still draw the curve */
    }
  }
  return out;
}

/**
 * Risk parity: every asset contributes the same share of portfolio risk.
 * Spinu's convex formulation solved by cyclical coordinate descent; long-only by construction.
 */
export function riskParity(cov: number[][], budgets?: number[]): number[] {
  const n = cov.length;
  const b = budgets ?? new Array(n).fill(1 / n);
  let y = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-12)));
  for (let iter = 0; iter < 2000; iter++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let j = 0; j < n; j++) if (j !== i) a += cov[i][j] * y[j];
      const sii = Math.max(cov[i][i], 1e-12);
      const next = (-a + Math.sqrt(a * a + 4 * sii * b[i])) / (2 * sii);
      change = Math.max(change, Math.abs(next - y[i]) / Math.max(next, 1e-12));
      y[i] = next;
    }
    if (change < 1e-10) break;
  }
  const s = y.reduce((p, v) => p + v, 0);
  return y.map((v) => v / s);
}

/** Weights proportional to 1 / volatility. */
export function inverseVolatility(cov: number[][]): number[] {
  const inv = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-12)));
  const s = inv.reduce((p, v) => p + v, 0);
  return inv.map((v) => v / s);
}

export const equalWeight = (n: number): number[] => new Array(n).fill(1 / n);

/* ---------- expected-return estimation ---------- */

/** Shrink each asset's estimate towards the cross-sectional average. intensity 0 = raw history, 1 = all equal. */
export function shrinkReturns(mu: number[], intensity: number): number[] {
  const avg = mu.reduce((s, v) => s + v, 0) / mu.length;
  const k = Math.min(1, Math.max(0, intensity));
  return mu.map((v) => avg * k + v * (1 - k));
}

/** CAPM expected return: risk-free rate + beta × equity risk premium. */
export const capmReturn = (rf: number, beta: number, equityRiskPremium: number): number => rf + beta * equityRiskPremium;
