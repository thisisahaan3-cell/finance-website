import { useMemo, useState } from 'react';
import { BasketPicker, useBasket } from '../components/Basket';
import { BarChart, BarList, Heatmap, LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, Loading, MoneyField, Note, PercentField, SelectField, Source, Stat, Stats } from '../components/ui';
import { basketStats, loadBasket } from '../lib/analytics';
import { BENCHMARKS, benchmarkName, defaultBenchmark, shortSymbol } from '../lib/data/symbols';
import { covariance, drawdown, excessKurtosis, histogram, mean, parametricVar, skewness, stdev, variance } from '../lib/finance/stats';
import { date as fmtDate, money, num, pct, signedPct, times, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

interface Inputs {
  range: '1y' | '2y' | '5y' | '10y';
  amount: number;
  benchmark: string;
  shock: number;
}

/** Broad windows around well-known market falls. The exact peak and trough inside each window are found from the benchmark's own data. */
const EPISODES: { name: string; from: string; to: string }[] = [
  { name: 'Global financial crisis', from: '2007-10-01', to: '2009-03-31' },
  { name: 'Taper tantrum', from: '2013-05-01', to: '2013-09-30' },
  { name: 'China slowdown scare', from: '2015-03-01', to: '2016-03-31' },
  { name: 'Demonetisation', from: '2016-09-01', to: '2016-12-31' },
  { name: 'COVID-19 crash', from: '2020-01-01', to: '2020-04-30' },
  { name: 'Global rate-hike sell-off', from: '2021-10-01', to: '2022-07-31' },
  { name: 'Late 2024 – early 2025 correction', from: '2024-09-01', to: '2025-04-30' },
];

export default function RiskLab() {
  const basket = useBasket('risk', []);
  const [inp, set, reset] = useSaved<Inputs>('risk', { range: '5y', amount: 1_000_000, benchmark: '', shock: -0.2 });
  const rf = useStore((s) => s.settings.riskFree);
  const [stress, setStress] = useState(false);
  const symbols = basket.items.map((i) => i.symbol);
  const total = basket.items.reduce((s, i) => s + i.weight, 0);
  const benchmark = inp.benchmark || (symbols[0] ? defaultBenchmark(symbols[0]) : '^NSEI');
  const data = useAsync(symbols.length ? () => loadBasket(symbols, inp.range, 'INR', benchmark) : null, [symbols.join(','), inp.range, benchmark]);
  const long = useAsync(stress && symbols.length ? () => loadBasket(symbols, 'max', 'INR', benchmark) : null, [stress, symbols.join(','), benchmark]);

  const weightsFor = (list: string[]) => {
    const raw = list.map((s) => basket.items.find((i) => i.symbol === s)?.weight ?? 0);
    const sum = raw.reduce((a, c) => a + c, 0);
    return sum > 0 ? raw.map((w) => w / sum) : raw;
  };

  const stats = useMemo(() => (data.data && Math.abs(total - 100) < 0.05 ? basketStats(data.data, weightsFor(data.data.symbols), rf) : null), [data.data, basket.items, total, rf]);

  const betas = useMemo(() => {
    const b = data.data;
    if (!b?.hasBenchmark || !stats) return null;
    const n = b.symbols.length;
    const m = b.aligned.matrix;
    const bench: number[] = [];
    for (let t = 1; t < m.length; t++) bench.push(m[t][n] / m[t - 1][n] - 1);
    const vb = variance(bench);
    return b.symbols.map((_, i) => {
      const r: number[] = [];
      for (let t = 1; t < m.length; t++) r.push(m[t][i] / m[t - 1][i] - 1);
      return vb > 0 ? covariance(bench, r) / vb : NaN;
    });
  }, [data.data, stats]);

  const episodes = useMemo(() => {
    const b = long.data;
    if (!b?.hasBenchmark || !betas || !data.data) return null;
    const n = b.symbols.length;
    const w = weightsFor(b.symbols);
    // each asset's own first available date, from the unaligned picture: use the aligned matrix only inside the common window
    const dates = b.aligned.dates;
    return EPISODES.map((ep) => {
      const idx = dates.map((d, i) => (d >= ep.from && d <= ep.to ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 5) return { ...ep, covered: false as const };
      const levels = idx.map((i) => b.aligned.matrix[i][n]);
      const dd = drawdown(levels);
      if (!(dd.maxDrawdown < 0)) return { ...ep, covered: false as const };
      const i0 = idx[dd.peakIndex];
      const i1 = idx[dd.troughIndex];
      const assetRet = b.symbols.map((_, k) => b.aligned.matrix[i1][k] / b.aligned.matrix[i0][k] - 1);
      const portfolio = assetRet.reduce((s, r, k) => s + w[k] * r, 0);
      return { ...ep, covered: true as const, peak: dates[i0], trough: dates[i1], bench: dd.maxDrawdown, portfolio, worst: b.symbols[assetRet.indexOf(Math.min(...assetRet))], worstRet: Math.min(...assetRet) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [long.data, betas, basket.items]);

  const b = data.data;
  const perf = stats?.perf;
  const benchName = benchmarkName(benchmark);
  const w = b ? weightsFor(b.symbols) : [];
  const portBeta = betas ? betas.reduce((s, be, i) => s + w[i] * be, 0) : null;
  const dayMu = stats ? mean(stats.returns) : 0;
  const daySd = stats ? stdev(stats.returns) : 0;
  const order = b && stats ? b.symbols.map((_, i) => i).sort((i, j) => stats.riskShare[j] - stats.riskShare[i]) : [];
  const hist = stats ? histogram(stats.returns, 41) : [];

  return (
    <Page tool="risk" actions={<button className="btn sm" onClick={reset}>Reset settings</button>}>
      <div className="split wide">
        <div className="stack">
          <Card title="Portfolio to examine" sub="weights must total 100%">
            <BasketPicker items={basket.items} onChange={basket.setItems} onLoadPortfolio={basket.fromPortfolio} seeding={basket.seeding} seedError={basket.seedError} />
          </Card>
          <Card title="Settings">
            <div className="form">
              <MoneyField label="Portfolio size" value={inp.amount} onChange={(amount) => set({ amount })} min={0} decimals={0} hint="Used to turn percentages into rupees." />
              <div className="form two">
                <SelectField label="History used" value={inp.range} onChange={(range) => set({ range })} options={[{ value: '1y', label: '1 year' }, { value: '2y', label: '2 years' }, { value: '5y', label: '5 years' }, { value: '10y', label: '10 years' }]} />
                <SelectField label="Market index" value={benchmark} onChange={(x) => set({ benchmark: x })} options={BENCHMARKS.map((x) => ({ value: x.symbol, label: x.name }))} />
              </div>
            </div>
          </Card>
        </div>
        <div className="stack">
          {!symbols.length && (
            <Card>
              <Empty title="Choose a portfolio to examine">
                <p>Load one of your saved portfolios or build a mix here. The lab shows how bumpy it has been, what a bad day or month looks like, and how it would have fared in past market crashes.</p>
              </Empty>
            </Card>
          )}
          {data.loading && <Loading label="Loading price history…" height={120} />}
          {data.error && <ErrorNote error={data.error} retry={data.reload} />}
          {b?.failed.length ? <Note kind="warn">No usable history for {b.failed.map((f) => f.symbol).join(', ')}; left out and the remaining weights are scaled up.</Note> : null}
          {b && !stats && Math.abs(total - 100) < 0.05 && !data.loading && <Note kind="warn">Not enough shared history to measure risk. Try a shorter period.</Note>}
          {b && stats && perf && (
            <>
              <p className="small muted">
                Based on {stats.observations} trading days, {fmtDate(stats.dates[0])} to {fmtDate(stats.dates[stats.dates.length - 1])}, for a mix held at constant weights.
                {b.aligned.limitedBy ? ` The window is limited by ${shortSymbol(b.aligned.limitedBy)}.` : ''}
              </p>
              <Stats>
                <Stat label="Volatility" tip="Annualised standard deviation of daily returns: the size of a typical year's swing." value={pct(perf.volatility)} sub={stats.benchPerf ? `${benchName}: ${pct(stats.benchPerf.volatility)}` : undefined} />
                <Stat label="Beta" tip={`Sensitivity to the ${benchName}. 1.2 means the portfolio has tended to move 1.2% for each 1% market move.`} value={portBeta !== null ? num(portBeta, 2) : '—'} />
                <Stat label="Deepest fall" value={pct(perf.maxDrawdown)} tone="neg" sub={`${money(-perf.maxDrawdown * inp.amount, 'INR', 0)} on your portfolio`} />
                <Stat label="Recovered" value={perf.drawdownRecovery ? fmtDate(perf.drawdownRecovery) : 'Not yet'} sub={`fell ${fmtDate(perf.drawdownPeak)} → ${fmtDate(perf.drawdownTrough)}`} />
                <Stat label="Sharpe ratio" value={num(perf.sharpe, 2)} />
                <Stat label="Diversification" tip="Average volatility of the holdings divided by the portfolio's volatility. Higher means mixing them has removed more risk." value={times(stats.diversification)} />
              </Stats>

              <Card title="How much could you lose? (value at risk)" sub="two ways of estimating the same thing" flush>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Horizon and confidence</th>
                        <th className="r">From actual history</th>
                        <th className="r">Assuming a bell curve</th>
                        <th className="r">In rupees (history)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['1 day, 95% (a 1-in-20 day)', stats.var95?.var, parametricVar(dayMu, daySd, 0.95).var, 1],
                          ['1 day, 99% (a 1-in-100 day)', stats.var99?.var, parametricVar(dayMu, daySd, 0.99).var, 1],
                          ['Average of the worst 5% of days (CVaR)', stats.var95?.cvar, parametricVar(dayMu, daySd, 0.95).cvar, 1],
                          ['1 month, 95% (scaled by √21)', stats.var95 ? stats.var95.var * Math.sqrt(21) : null, parametricVar(dayMu * 21, daySd * Math.sqrt(21), 0.95).var, 1],
                        ] as [string, number | null | undefined, number, number][]
                      ).map(([label, h, pm]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="r">{pct(h, 2)}</td>
                          <td className="r">{pct(pm, 2)}</td>
                          <td className="r neg">{h == null ? '—' : money(h * inp.amount, 'INR', 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ padding: '10px 14px' }}>
                  Read “1 day, 95%” as: on 19 trading days out of 20 the loss was smaller than this. It says nothing about how bad the 20th day can be; the CVaR row does. Real markets have fatter tails than a bell curve
                  (skew {num(skewness(stats.returns), 2)}, excess kurtosis {num(excessKurtosis(stats.returns), 1)}; both would be 0 for a perfect bell curve), which is why the history column is usually worse at 99%.
                </p>
              </Card>

              <div className="grid cols-2">
                <Card title="Falls from the previous peak">
                  <LineChart x={stats.dates} series={[{ name: 'Portfolio', values: drawdown(stats.index).series }, ...(stats.benchIndex ? [{ name: benchName, values: drawdown(stats.benchIndex).series, color: 'var(--text-3)' }] : [])]} yFormat={(v) => pct(v, 0)} area yMax={0} height={220} />
                </Card>
                <Card title="Daily returns" sub="how often each size of move happened">
                  <BarChart dense data={hist.map((h) => ({ label: pct((h.from + h.to) / 2, 1), value: h.count, note: 'Days', color: (h.from + h.to) / 2 < 0 ? 'var(--neg)' : 'var(--pos)' }))} yFormat={(v) => num(v, 0)} height={220} />
                </Card>
              </div>

              <div className="grid cols-2">
                <Card title="Where the risk comes from">
                  <BarList
                    items={order.map((i) => ({ label: shortSymbol(b.symbols[i]), title: `${pct(w[i])} of money, ${pct(stats.riskShare[i])} of risk`, share: Math.max(0, stats.riskShare[i]), mark: w[i], display: pct(stats.riskShare[i], 0), color: stats.riskShare[i] > w[i] * 1.25 ? 'var(--s2)' : 'var(--s1)' }))}
                  />
                  <p className="tiny muted mt-s">Bar = share of risk. Black tick = share of money.</p>
                </Card>
                <Card title="What if the market falls?" sub="a simple beta-based shock">
                  <div className="form">
                    <PercentField label={`${benchName} moves by`} value={inp.shock} onChange={(shock) => set({ shock })} min={-0.9} max={0.9} />
                    {portBeta !== null ? (
                      <Note kind={inp.shock < 0 ? 'warn' : 'ok'}>
                        With a beta of {num(portBeta, 2)}, the portfolio would be expected to move about <b>{signedPct(portBeta * inp.shock)}</b>, or <b>{money(portBeta * inp.shock * inp.amount, 'INR', 0)}</b>.
                      </Note>
                    ) : (
                      <Note kind="warn">Benchmark history is unavailable, so betas cannot be estimated.</Note>
                    )}
                    <p className="tiny muted">Beta captures only the market-wide part of each stock's moves. In a real crash correlations rise and individual stocks can fall much further, so treat this as a floor, not a forecast.</p>
                  </div>
                </Card>
              </div>

              <Card
                title="Replay of past market falls"
                sub="what these holdings actually did, peak to trough"
                right={!stress ? <button className="btn sm primary" onClick={() => setStress(true)}>Load full history and run</button> : undefined}
                flush
              >
                {!stress && <p className="small muted" style={{ padding: 14 }}>Fetches each holding's complete price history and measures its real return during the benchmark's worst stretch in each episode. Holdings that were not listed at the time shorten the common window, so some episodes may not be covered.</p>}
                {stress && long.loading && <Loading label="Loading complete history…" />}
                {stress && long.error && <div style={{ padding: 14 }}><ErrorNote error={long.error} retry={long.reload} /></div>}
                {stress && episodes && (
                  <>
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Episode</th>
                            <th>Benchmark peak → trough</th>
                            <th className="r">{benchName}</th>
                            <th className="r">This portfolio</th>
                            <th className="r">In rupees</th>
                            <th>Hardest hit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {episodes.map((e) =>
                            e.covered ? (
                              <tr key={e.name}>
                                <td>{e.name}</td>
                                <td className="nowrap small">
                                  {fmtDate(e.peak)} → {fmtDate(e.trough)}
                                </td>
                                <td className={'r ' + tone(e.bench)}>{signedPct(e.bench)}</td>
                                <td className={'r strong ' + tone(e.portfolio)}>{signedPct(e.portfolio)}</td>
                                <td className={'r ' + tone(e.portfolio)}>{money(e.portfolio * inp.amount, 'INR', 0)}</td>
                                <td className="small">
                                  {shortSymbol(e.worst)} {signedPct(e.worstRet, 0)}
                                </td>
                              </tr>
                            ) : (
                              <tr key={e.name} className="muted">
                                <td>{e.name}</td>
                                <td colSpan={5} className="small">
                                  Not covered: at least one holding has no price history that far back.
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="small muted" style={{ padding: '10px 14px' }}>
                      Peak and trough dates are the benchmark's own high and low inside each episode, found from the data. Returns include dividends and assume the weights shown were held at the peak.
                      {long.data?.aligned.dates.length ? ` Common history for these holdings begins ${fmtDate(long.data.aligned.dates[0])}.` : ''}
                    </p>
                  </>
                )}
              </Card>

              {b.symbols.length > 1 && (
                <Card title="How the holdings move together" sub="correlation of daily returns">
                  <Heatmap labels={order.slice(0, 14).map((i) => shortSymbol(b.symbols[i]))} matrix={order.slice(0, 14).map((i) => order.slice(0, 14).map((j) => stats.corr[i][j]))} />
                </Card>
              )}
              <Source />
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
