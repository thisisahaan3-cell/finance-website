import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BasketPicker, useBasket } from '../components/Basket';
import { Scatter } from '../components/charts';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, Loading, Note, PercentField, SelectField, Stat, Stats, toast } from '../components/ui';
import { loadBasket } from '../lib/analytics';
import { PERIODS_PER_YEAR, resample, returnsMatrix, type Frequency } from '../lib/data/series';
import { BENCHMARKS, defaultBenchmark, shortSymbol } from '../lib/data/symbols';
import {
  capmReturn,
  describe,
  efficientFrontier,
  equalWeight,
  inverseVolatility,
  maxSharpe,
  minVariance,
  minVarianceForReturn,
  riskContributions,
  riskParity,
  shrinkReturns,
  type Constraints,
  type PortfolioPoint,
} from '../lib/finance/optimize';
import { columnMeans, covariance, covarianceMatrix, ewmaCovariance, ledoitWolf, variance } from '../lib/finance/stats';
import { date as fmtDate, num, pct, signedPct } from '../lib/format';
import { attempt, useAsync } from '../lib/hooks';
import { ensureClassified, sectorOf } from '../lib/portfolioData';
import { patchPortfolio, useSaved, useStore } from '../lib/store';

type Objective = 'sharpe' | 'minvol' | 'target' | 'parity' | 'equal' | 'invvol';
type ReturnModel = 'history' | 'shrunk' | 'capm';
type RiskModel = 'lw' | 'sample' | 'ewma';

interface Inputs {
  range: '2y' | '5y' | '10y';
  freq: Frequency;
  objective: Objective;
  targetReturn: number;
  maxWeight: number;
  minWeight: number;
  sectorCap: number;
  returnModel: ReturnModel;
  shrink: number;
  erp: number;
  riskModel: RiskModel;
  benchmark: string;
}

const DEFAULTS: Inputs = {
  range: '5y',
  freq: 'weekly',
  objective: 'sharpe',
  targetReturn: 0.15,
  maxWeight: 0.25,
  minWeight: 0,
  sectorCap: 1,
  returnModel: 'shrunk',
  shrink: 0.5,
  erp: 0.06,
  riskModel: 'lw',
  benchmark: '',
};

const OBJECTIVES: { value: Objective; label: string; plain: string }[] = [
  { value: 'sharpe', label: 'Best return for the risk (maximum Sharpe)', plain: 'The mix with the highest expected return per unit of risk. Sensitive to the return estimates you feed it.' },
  { value: 'minvol', label: 'Smoothest ride (minimum volatility)', plain: 'The mix with the smallest swings. It ignores expected returns entirely, which makes it the most robust choice.' },
  { value: 'target', label: 'Hit a target return with least risk', plain: 'The calmest mix that is still expected to earn the return you ask for.' },
  { value: 'parity', label: 'Equal risk from every stock (risk parity)', plain: 'Each stock contributes the same share of total risk, so volatile stocks get smaller weights. Ignores caps and return estimates.' },
  { value: 'invvol', label: 'Inverse volatility', plain: 'Weights proportional to 1 ÷ volatility: a simple cousin of risk parity that ignores correlations.' },
  { value: 'equal', label: 'Equal weights', plain: 'The same amount in every stock. Surprisingly hard to beat, and a useful yardstick for the others.' },
];

export default function Optimizer() {
  const basket = useBasket('optimizer', []);
  const [inp, set, reset] = useSaved<Inputs>('optimizer', DEFAULTS);
  const rf = useStore((s) => s.settings.riskFree);
  const portfolios = useStore((s) => s.portfolios);
  useStore((s) => s.symbolMeta);
  const symbols = basket.items.map((i) => i.symbol);
  const benchmark = inp.benchmark || (symbols[0] ? defaultBenchmark(symbols[0]) : '^NSEI');
  const data = useAsync(symbols.length >= 2 ? () => loadBasket(symbols, inp.range, 'INR', benchmark) : null, [symbols.join(','), inp.range, benchmark]);
  useEffect(() => {
    if (symbols.length) void ensureClassified(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);

  const model = useMemo(() => {
    const b = data.data;
    if (!b || b.symbols.length < 2) return null;
    const n = b.symbols.length;
    const sampled = resample(b.aligned, inp.freq);
    const rows = returnsMatrix(sampled);
    if (rows.length < 24) return { error: `Only ${rows.length} ${inp.freq} observations are shared by all these stocks. Use a longer history, a higher frequency, or drop the newest listing.` } as const;
    const periods = PERIODS_PER_YEAR[inp.freq];
    const assetRows = rows.map((r) => r.slice(0, n));
    const hist = columnMeans(assetRows).map((m) => m * periods);
    const lw = ledoitWolf(assetRows);
    const base = inp.riskModel === 'lw' ? lw.cov : inp.riskModel === 'ewma' ? ewmaCovariance(assetRows, inp.freq === 'daily' ? 0.97 : inp.freq === 'weekly' ? 0.94 : 0.9) : covarianceMatrix(assetRows);
    const cov = base.map((r) => r.map((v) => v * periods));
    let betas: number[] | null = null;
    if (b.hasBenchmark) {
      const bench = rows.map((r) => r[n]);
      const vb = variance(bench);
      betas = b.symbols.map((_, i) => (vb > 0 ? covariance(bench, assetRows.map((r) => r[i])) / vb : NaN));
    }
    const mu = inp.returnModel === 'history' ? hist : inp.returnModel === 'shrunk' ? shrinkReturns(hist, inp.shrink) : betas && betas.every(Number.isFinite) ? betas.map((be) => capmReturn(rf, be, inp.erp)) : null;
    if (!mu) return { error: 'CAPM needs benchmark history, which could not be loaded. Choose another return model.' } as const;
    return { b, n, mu, hist, cov, betas, obs: rows.length, shrinkage: lw.shrinkage, start: sampled.dates[0], end: sampled.dates[sampled.dates.length - 1] } as const;
  }, [data.data, inp.freq, inp.riskModel, inp.returnModel, inp.shrink, inp.erp, rf]);

  const solved = useMemo(() => {
    if (!model || 'error' in model) return null;
    const { b, n, mu, cov } = model;
    const cons: Constraints = { max: new Array(n).fill(inp.maxWeight), min: new Array(n).fill(inp.minWeight) };
    if (inp.sectorCap < 1) {
      const bySector = new Map<string, number[]>();
      b.symbols.forEach((s, i) => bySector.set(sectorOf(s), [...(bySector.get(sectorOf(s)) ?? []), i]));
      cons.groups = [...bySector.entries()].filter(([k]) => k !== 'Unclassified').map(([label, members]) => ({ label, members, max: inp.sectorCap }));
    }
    return attempt(() => {
      const w =
        inp.objective === 'sharpe'
          ? maxSharpe(mu, cov, rf, cons)
          : inp.objective === 'minvol'
            ? minVariance(cov, cons)
            : inp.objective === 'target'
              ? minVarianceForReturn(mu, cov, inp.targetReturn, cons)
              : inp.objective === 'parity'
                ? riskParity(cov)
                : inp.objective === 'invvol'
                  ? inverseVolatility(cov)
                  : equalWeight(n);
      const frontier = efficientFrontier(mu, cov, rf, cons, 28);
      const keyed: Record<string, PortfolioPoint> = { 'Minimum volatility': describe(minVariance(cov, cons), mu, cov, rf), 'Maximum Sharpe': describe(maxSharpe(mu, cov, rf, cons), mu, cov, rf), 'Equal weights': describe(equalWeight(n), mu, cov, rf) };
      // Robustness: the same optimisation under three different beliefs about returns.
      const alt = [0, 0.5, 1].map((k) => {
        const m = shrinkReturns(model.hist, k);
        return maxSharpe(m, cov, rf, cons);
      });
      return { point: describe(w, mu, cov, rf), frontier, keyed, alt, risk: riskContributions(w, cov) };
    });
  }, [model, inp.objective, inp.maxWeight, inp.minWeight, inp.sectorCap, inp.targetReturn, rf]);

  const curTotal = basket.items.reduce((s, i) => s + i.weight, 0);
  const current = useMemo(() => {
    if (!model || 'error' in model || Math.abs(curTotal - 100) > 0.5) return null;
    const w = model.b.symbols.map((s) => (basket.items.find((i) => i.symbol === s)?.weight ?? 0) / 100);
    const sum = w.reduce((a, c) => a + c, 0);
    return sum > 0 ? describe(w.map((x) => x / sum), model.mu, model.cov, rf) : null;
  }, [model, basket.items, curTotal, rf]);

  const applyTo = (id: string) => {
    if (!solved?.value || !model || 'error' in model) return;
    const target = portfolios.find((x) => x.id === id);
    if (!target) return;
    const share = 1 - (target.cashTarget || 0) / 100;
    const targets: Record<string, number> = {};
    model.b.symbols.forEach((s, i) => (targets[s] = Number((solved.value!.point.weights[i] * 100 * share).toFixed(2))));
    patchPortfolio(id, (x) => ({ ...x, targets }));
    toast(`Target weights saved to “${target.name}”. Open its Rebalance tab to see the trades.`);
  };

  const ok = model && !('error' in model) ? model : null;
  const res = solved?.value ?? null;
  const obj = OBJECTIVES.find((o) => o.value === inp.objective)!;

  return (
    <Page tool="optimizer" actions={<button className="btn sm" onClick={reset}>Reset settings</button>}>
      <div className="split wide">
        <div className="stack">
          <Card title="1. Choose the stocks" sub="at least two">
            <BasketPicker items={basket.items} onChange={basket.setItems} onLoadPortfolio={basket.fromPortfolio} seeding={basket.seeding} seedError={basket.seedError} types={['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND']} />
            <p className="tiny muted mt-s">The weights you type here are treated as your current mix and shown for comparison. Leave them equal if you are starting fresh.</p>
          </Card>
          <Card title="2. What should the optimiser aim for?">
            <div className="form">
              <SelectField label="Goal" value={inp.objective} onChange={(objective) => set({ objective })} options={OBJECTIVES.map((o) => ({ value: o.value, label: o.label }))} hint={obj.plain} />
              {inp.objective === 'target' && <PercentField label="Target return per year" value={inp.targetReturn} onChange={(targetReturn) => set({ targetReturn })} min={-0.5} max={2} />}
              <div className="form two">
                <PercentField label="Most in any one stock" value={inp.maxWeight} onChange={(maxWeight) => set({ maxWeight })} min={0.01} max={1} tip="A cap stops the optimiser betting the portfolio on one or two names. 100% means no cap." />
                <PercentField label="Least in each stock" value={inp.minWeight} onChange={(minWeight) => set({ minWeight })} min={0} max={0.5} tip="A floor keeps every stock in the answer. 0% lets the optimiser drop stocks completely." />
                <PercentField label="Most in any one sector" value={inp.sectorCap} onChange={(sectorCap) => set({ sectorCap })} min={0.05} max={1} tip="Uses the data provider's sector labels. 100% means no sector limit." />
              </div>
            </div>
          </Card>
          <Card title="3. Assumptions" sub="advanced: the defaults are sensible">
            <div className="form">
              <div className="form two">
                <SelectField label="History used" value={inp.range} onChange={(range) => set({ range })} options={[{ value: '2y', label: 'Last 2 years' }, { value: '5y', label: 'Last 5 years' }, { value: '10y', label: 'Last 10 years' }]} />
                <SelectField label="Measured" value={inp.freq} onChange={(freq) => set({ freq })} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'daily', label: 'Daily' }, { value: 'monthly', label: 'Monthly' }]} tip="Weekly returns are a good balance: enough data points, and markets with different holidays line up properly." />
              </div>
              <SelectField
                label="Expected returns"
                tip="The optimiser is only as good as these guesses. Past averages are noisy, so by default each stock's average is pulled halfway towards the group average."
                value={inp.returnModel}
                onChange={(returnModel) => set({ returnModel })}
                options={[
                  { value: 'shrunk', label: 'Past averages, pulled towards the group average' },
                  { value: 'history', label: 'Past averages as they are' },
                  { value: 'capm', label: 'CAPM: risk-free rate + beta × market premium' },
                ]}
              />
              {inp.returnModel === 'shrunk' && <PercentField label="How far to pull towards the average" value={inp.shrink} onChange={(shrink) => set({ shrink })} min={0} max={1} hint="0% trusts history fully; 100% assumes every stock earns the same." />}
              {inp.returnModel === 'capm' && (
                <div className="form two">
                  <PercentField label="Market risk premium" value={inp.erp} onChange={(erp) => set({ erp })} min={0} max={0.2} tip="Extra yearly return investors expect from shares over safe government bonds. 5–7% is a common long-run assumption for India." />
                  <SelectField label="Market index for beta" value={benchmark} onChange={(b) => set({ benchmark: b })} options={BENCHMARKS.map((b) => ({ value: b.symbol, label: b.name }))} />
                </div>
              )}
              <SelectField
                label="Risk model"
                tip="How the co-movement of stocks is estimated. Shrinkage is more stable than the raw sample when you have many stocks and limited history."
                value={inp.riskModel}
                onChange={(riskModel) => set({ riskModel })}
                options={[
                  { value: 'lw', label: 'Shrinkage (Ledoit–Wolf): stable' },
                  { value: 'sample', label: 'Plain historical covariance' },
                  { value: 'ewma', label: 'Recent data counts more (EWMA)' },
                ]}
              />
              <p className="tiny muted">
                Risk-free rate {pct(rf)} (change in <Link to="/settings">Data &amp; settings</Link>). Prices are converted to rupees so foreign stocks include currency moves.
              </p>
            </div>
          </Card>
        </div>

        <div className="stack">
          {symbols.length < 2 && (
            <Card>
              <Empty title="Add at least two stocks">
                <p>The optimiser looks at how your chosen stocks have moved, alone and together, and proposes how much to hold of each. Start with the quick-add buttons, or load one of your portfolios.</p>
              </Empty>
            </Card>
          )}
          {data.loading && <Loading label="Loading price history…" height={120} />}
          {data.error && <ErrorNote error={data.error} retry={data.reload} />}
          {data.data?.failed.length ? <Note kind="warn">No usable history for {data.data.failed.map((f) => f.symbol).join(', ')}; left out.</Note> : null}
          {model && 'error' in model && <Note kind="err">{model.error}</Note>}
          {solved?.error && <Note kind="err">{solved.error}</Note>}
          {ok && res && (
            <>
              <Stats>
                <Stat big label="Expected return" tip="A model estimate built from the assumptions on the left: not a forecast or a promise." value={pct(res.point.ret)} sub={current ? `your mix: ${pct(current.ret)}` : 'per year'} />
                <Stat big label="Expected volatility" tip="Typical yearly swing of the portfolio's value." value={pct(res.point.vol)} sub={current ? `your mix: ${pct(current.vol)}` : 'per year'} />
                <Stat big label="Sharpe ratio" tip="Expected return above the risk-free rate, per unit of volatility. Higher is better." value={num(res.point.sharpe, 2)} sub={current ? `your mix: ${num(current.sharpe, 2)}` : undefined} />
                <Stat label="Stocks used" value={`${res.point.weights.filter((w) => w > 0.0005).length} of ${ok.n}`} sub={`${ok.obs} ${inp.freq} observations`} />
              </Stats>
              <Card
                title="Suggested weights"
                sub={obj.label}
                right={
                  portfolios.length > 0 ? (
                    <select className="select" style={{ width: 'auto', height: 28, fontSize: 12.5 }} value="" aria-label="Save these weights as targets in a portfolio" onChange={(e) => e.target.value && applyTo(e.target.value)}>
                      <option value="">Save as targets in…</option>
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : undefined
                }
                flush
              >
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Stock</th>
                        <th className="r">Suggested</th>
                        {current && <th className="r">Yours</th>}
                        {current && <th className="r">Change</th>}
                        <th className="r">Exp. return</th>
                        <th className="r">Volatility</th>
                        {ok.betas && <th className="r">Beta</th>}
                        <th className="r">Share of risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ok.b.symbols
                        .map((s, i) => ({ s, i }))
                        .sort((a, c) => res.point.weights[c.i] - res.point.weights[a.i])
                        .map(({ s, i }) => {
                          const w = res.point.weights[i];
                          const cur = current ? current.weights[i] : null;
                          return (
                            <tr key={s} className={w < 0.0005 ? 'muted' : ''}>
                              <td>
                                <Link to={`/stock/${encodeURIComponent(s)}`}>{shortSymbol(s)}</Link>
                                <span className="sub">{ok.b.names[i]}</span>
                              </td>
                              <td className="r strong">{pct(w)}</td>
                              {cur !== null && <td className="r">{pct(cur)}</td>}
                              {cur !== null && <td className={'r ' + (Math.abs(w - cur) < 0.005 ? 'muted' : w > cur ? 'pos' : 'neg')}>{signedPct(w - cur)}</td>}
                              <td className="r">{pct(ok.mu[i])}</td>
                              <td className="r">{pct(Math.sqrt(ok.cov[i][i]))}</td>
                              {ok.betas && <td className="r">{num(ok.betas[i], 2)}</td>}
                              <td className="r">{pct(res.risk[i], 0)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Risk against return" sub="the curve is the efficient frontier: the best return available at each level of risk">
                <Scatter
                  height={360}
                  xLabel="Volatility (risk) per year"
                  yLabel="Expected return per year"
                  xFormat={(v) => pct(v, 0)}
                  yFormat={(v) => pct(v, 0)}
                  line={res.frontier.map((f) => ({ x: f.vol, y: f.ret }))}
                  points={[
                    ...ok.b.symbols.map((s, i) => ({ x: Math.sqrt(ok.cov[i][i]), y: ok.mu[i], label: shortSymbol(s), detail: ok.b.names[i] })),
                    ...Object.entries(res.keyed)
                      .filter(([name]) => !(name === 'Maximum Sharpe' && inp.objective === 'sharpe') && !(name === 'Minimum volatility' && inp.objective === 'minvol') && !(name === 'Equal weights' && inp.objective === 'equal'))
                      .map(([name, pt]) => ({ x: pt.vol, y: pt.ret, label: name, color: 'var(--s3)', detail: `Sharpe ${num(pt.sharpe, 2)}` })),
                    ...(current ? [{ x: current.vol, y: current.ret, label: 'Your mix', color: 'var(--s2)', key: true, detail: `Sharpe ${num(current.sharpe, 2)}` }] : []),
                    { x: res.point.vol, y: res.point.ret, label: 'Suggested', color: 'var(--s1)', key: true, detail: `Sharpe ${num(res.point.sharpe, 2)}` },
                  ]}
                />
                <p className="tiny muted">Grey dots are the individual stocks; green dots are reference portfolios. A mix can sit to the left of every single stock: that is diversification at work.</p>
              </Card>
              <Card title="How fragile is the answer?" sub="maximum-Sharpe weights under three beliefs about future returns" flush>
                <div className="tbl-wrap">
                  <table className="tbl compact">
                    <thead>
                      <tr>
                        <th>Stock</th>
                        <th className="r">Trust history fully</th>
                        <th className="r">Halfway</th>
                        <th className="r">All stocks earn the same</th>
                        <th className="r">Past average return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ok.b.symbols.map((s, i) => (
                        <tr key={s}>
                          <td>{shortSymbol(s)}</td>
                          {res.alt.map((w, k) => (
                            <td className="r" key={k}>
                              {pct(w[i], 0)}
                            </td>
                          ))}
                          <td className="r">{pct(ok.hist[i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ padding: '10px 14px' }}>
                  If the weights swing wildly between columns, the “optimal” portfolio depends mostly on return guesses nobody can make reliably. Stocks that keep a similar weight in all three columns are the robust part of the answer.
                </p>
              </Card>
              <Note kind="warn">
                <b>Read this before acting.</b> The optimiser finds the best mix <i>for the past data and assumptions you gave it</i> ({fmtDate(ok.start)} to {fmtDate(ok.end)}
                {ok.b.aligned.limitedBy ? `, limited by ${shortSymbol(ok.b.aligned.limitedBy)}'s shorter history` : ''}). It does not know about valuations, business quality or the future. Recent winners look best simply because they
                won. Use the output as a starting point, keep sensible caps, and prefer answers that survive the fragility check above.
              </Note>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
