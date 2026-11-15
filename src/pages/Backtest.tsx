import { useMemo } from 'react';
import { BasketPicker, useBasket } from '../components/Basket';
import { BarChart, LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, Loading, MoneyField, Note, NumberField, PercentField, SelectField, Source, Stat, Stats } from '../components/ui';
import { loadBasket } from '../lib/analytics';
import type { Range } from '../lib/data/api';
import { BENCHMARKS, benchmarkName, defaultBenchmark, shortSymbol } from '../lib/data/symbols';
import { backtest, rollingReturns, type BacktestResult, type RebalanceRule } from '../lib/finance/backtest';
import { drawdown } from '../lib/finance/stats';
import { compact, date as fmtDate, duration, money, num, pct, signedPct, tone } from '../lib/format';
import { attempt, useAsync } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

interface Inputs {
  range: Range;
  initial: number;
  monthly: number;
  rebalance: RebalanceRule;
  threshold: number;
  costBps: number;
  benchmark: string;
}

const DEFAULTS: Inputs = { range: '5y', initial: 100_000, monthly: 0, rebalance: 'yearly', threshold: 0.05, costBps: 20, benchmark: '' };

const RULES: { value: RebalanceRule; label: string }[] = [
  { value: 'none', label: 'Never (buy and hold)' },
  { value: 'yearly', label: 'Once a year' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'monthly', label: 'Every month' },
  { value: 'threshold', label: 'Only when weights drift too far' },
];

export default function Backtest() {
  const basket = useBasket('backtest', [
    { symbol: 'NIFTYBEES.NS', weight: 70 },
    { symbol: 'GOLDBEES.NS', weight: 30 },
  ]);
  const [inp, set, reset] = useSaved<Inputs>('backtest', DEFAULTS);
  const rf = useStore((s) => s.settings.riskFree);
  const symbols = basket.items.map((i) => i.symbol);
  const total = basket.items.reduce((s, i) => s + i.weight, 0);
  const benchmark = inp.benchmark || (symbols[0] ? defaultBenchmark(symbols[0]) : '^NSEI');
  const data = useAsync(symbols.length ? () => loadBasket(symbols, inp.range, 'INR', benchmark) : null, [symbols.join(','), inp.range, benchmark]);

  const run = useMemo(() => {
    const b = data.data;
    if (!b || !b.symbols.length || Math.abs(total - 100) > 0.05) return null;
    const n = b.symbols.length;
    const raw = b.symbols.map((s) => basket.items.find((i) => i.symbol === s)?.weight ?? 0);
    const sum = raw.reduce((a, c) => a + c, 0);
    if (!(sum > 0)) return null;
    const weights = raw.map((w) => w / sum);
    const prices = b.aligned.matrix.map((r) => r.slice(0, n));
    const common = { dates: b.aligned.dates, initial: inp.initial, monthlyContribution: inp.monthly, costBps: inp.costBps };
    return attempt(() => {
      const main = backtest({ ...common, prices, weights, rebalance: inp.rebalance, threshold: inp.threshold }, rf);
      const hold = inp.rebalance === 'none' ? null : backtest({ ...common, prices, weights, rebalance: 'none' }, rf);
      const bench: BacktestResult | null = b.hasBenchmark ? backtest({ ...common, prices: b.aligned.matrix.map((r) => [r[n]]), weights: [1], rebalance: 'none', costBps: 0 }, rf) : null;
      return { main, hold, bench, weights, dd: drawdown(main.nav).series, benchDd: bench ? drawdown(bench.nav).series : null, rolling: rollingReturns(main.dates, main.nav, 1), benchRolling: bench ? rollingReturns(bench.dates, bench.nav, 1) : null };
    });
  }, [data.data, basket.items, total, inp.initial, inp.monthly, inp.rebalance, inp.threshold, inp.costBps, rf]);

  const r = run?.value;
  const perf = r?.main.performance;
  const benchName = benchmarkName(benchmark);
  const cols = r ? ([['Your strategy', r.main], r.hold ? ['Same mix, never rebalanced', r.hold] : null, r.bench ? [benchName, r.bench] : null].filter(Boolean) as [string, BacktestResult][]) : [];

  return (
    <Page tool="backtest" actions={<button className="btn sm" onClick={reset}>Reset settings</button>}>
      <div className="split wide">
        <div className="stack">
          <Card title="1. The portfolio to test" sub="weights must total 100%">
            <BasketPicker items={basket.items} onChange={basket.setItems} onLoadPortfolio={basket.fromPortfolio} seeding={basket.seeding} seedError={basket.seedError} />
          </Card>
          <Card title="2. The rules">
            <div className="form">
              <div className="form two">
                <SelectField label="Period" value={inp.range} onChange={(range) => set({ range })} options={[{ value: '1y', label: 'Last 1 year' }, { value: '2y', label: 'Last 2 years' }, { value: '5y', label: 'Last 5 years' }, { value: '10y', label: 'Last 10 years' }, { value: 'max', label: 'As far back as possible' }]} />
                <SelectField label="Compare with" value={benchmark} onChange={(b) => set({ benchmark: b })} options={BENCHMARKS.map((b) => ({ value: b.symbol, label: b.name }))} />
                <MoneyField label="Starting amount" value={inp.initial} onChange={(initial) => set({ initial })} min={1} decimals={0} />
                <MoneyField label="Added every month (SIP)" value={inp.monthly} onChange={(monthly) => set({ monthly })} min={0} decimals={0} />
              </div>
              <SelectField label="Rebalancing" tip="Rebalancing means selling a little of what has risen and buying what has lagged, to return to your chosen weights. It keeps risk steady." value={inp.rebalance} onChange={(rebalance) => set({ rebalance })} options={RULES} />
              {inp.rebalance === 'threshold' && <PercentField label="Rebalance when any weight is off by" value={inp.threshold} onChange={(threshold) => set({ threshold })} min={0.005} max={0.5} />}
              <NumberField label="Trading cost" suffix="bps" value={inp.costBps} onChange={(costBps) => set({ costBps })} min={0} max={500} decimals={0} tip="Cost of each trade in basis points of its value (100 bps = 1%). Around 10–30 bps covers brokerage, STT and other charges on delivery trades in India." />
            </div>
          </Card>
        </div>
        <div className="stack">
          {!symbols.length && (
            <Card>
              <Empty title="Add something to test">
                <p>Pick stocks, ETFs or indices and give them weights. The backtest replays history day by day using total-return prices (dividends reinvested).</p>
              </Empty>
            </Card>
          )}
          {data.loading && <Loading label="Loading price history…" height={120} />}
          {data.error && <ErrorNote error={data.error} retry={data.reload} />}
          {data.data?.failed.length ? <Note kind="warn">No usable history for {data.data.failed.map((f) => f.symbol).join(', ')}. Remove it or the test cannot run with the weights given.</Note> : null}
          {run?.error && <Note kind="err">{run.error}</Note>}
          {r && perf && (
            <>
              <Stats>
                <Stat big label="Ended with" value={compact(r.main.value[r.main.value.length - 1])} sub={`from ${compact(r.main.invested[r.main.invested.length - 1])} put in`} />
                <Stat big label="Return per year" tip="Time-weighted compound annual growth rate: the strategy's own return, unaffected by the size and timing of monthly additions." value={signedPct(perf.cagr)} tone={tone(perf.cagr)} sub={r.bench?.performance ? `${benchName}: ${signedPct(r.bench.performance.cagr)}` : undefined} />
                <Stat label="Deepest fall" value={pct(perf.maxDrawdown)} tone="neg" sub={`${fmtDate(perf.drawdownPeak)} → ${fmtDate(perf.drawdownTrough)}`} />
                <Stat label="Volatility" value={pct(perf.volatility)} sub="per year" />
                <Stat label="Sharpe ratio" value={num(perf.sharpe, 2)} sub={`risk-free ${pct(rf)}`} />
                <Stat label="Period tested" value={duration(perf.years)} sub={`${fmtDate(perf.start)} – ${fmtDate(perf.end)}`} />
              </Stats>
              {data.data?.aligned.limitedBy && (
                <Note>
                  The test starts on {fmtDate(perf.start)} because {shortSymbol(data.data.aligned.limitedBy)} has no earlier history.
                </Note>
              )}
              <Card title="Growth of 100" sub="time-weighted; dividends reinvested">
                <LineChart
                  x={r.main.dates}
                  series={[
                    { name: 'Your strategy', values: r.main.nav.map((v) => v * 100) },
                    ...(r.hold ? [{ name: 'Never rebalanced', values: r.hold.nav.map((v) => v * 100), color: 'var(--s3)' }] : []),
                    ...(r.bench ? [{ name: benchName, values: r.bench.nav.map((v) => v * 100), color: 'var(--text-3)' }] : []),
                  ]}
                  yFormat={(v) => num(v, 0)}
                  height={300}
                />
              </Card>
              {inp.monthly > 0 && (
                <Card title="Your money over time" sub="value against the total you put in">
                  <LineChart x={r.main.dates} series={[{ name: 'Portfolio value', values: r.main.value }, { name: 'Money put in', values: r.main.invested, color: 'var(--text-3)', dashed: true }]} area height={240} />
                </Card>
              )}
              <Card title="Falls from the previous peak" sub="how deep, and how long it took to recover">
                <LineChart
                  x={r.main.dates}
                  series={[{ name: 'Your strategy', values: r.dd }, ...(r.benchDd ? [{ name: benchName, values: r.benchDd, color: 'var(--text-3)' }] : [])]}
                  yFormat={(v) => pct(v, 0)}
                  area
                  yMax={0}
                  height={200}
                />
              </Card>
              <Card title="Side by side" flush>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Measure</th>
                        {cols.map(([name]) => (
                          <th className="r" key={name}>
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['Final value', (x) => money(x.value[x.value.length - 1], 'INR', 0)],
                          ['Return per year (time-weighted)', (x) => signedPct(x.performance?.cagr)],
                          ['Return on your money (XIRR)', (x) => signedPct(x.xirr)],
                          ['Total return', (x) => signedPct(x.performance?.totalReturn)],
                          ['Volatility', (x) => pct(x.performance?.volatility)],
                          ['Deepest fall', (x) => pct(x.performance?.maxDrawdown)],
                          ['Sharpe ratio', (x) => num(x.performance?.sharpe, 2)],
                          ['Sortino ratio', (x) => num(x.performance?.sortino, 2)],
                          ['Return ÷ deepest fall (Calmar)', (x) => num(x.performance?.calmar, 2)],
                          ['Best calendar year', (x) => (x.performance?.bestYear ? `${signedPct(x.performance.bestYear.ret)} (${x.performance.bestYear.year})` : '—')],
                          ['Worst calendar year', (x) => (x.performance?.worstYear ? `${signedPct(x.performance.worstYear.ret)} (${x.performance.worstYear.year})` : '—')],
                          ['Months with a gain', (x) => pct(x.performance?.positiveMonths, 0)],
                          ['Times rebalanced', (x) => String(x.rebalances)],
                          ['Trading costs paid', (x) => money(x.totalCosts, 'INR', 0)],
                        ] as [string, (x: BacktestResult) => string][]
                      ).map(([label, f]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          {cols.map(([name, x]) => (
                            <td className="r" key={name}>
                              {f(x)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="grid cols-2">
                <Card title="Return by calendar year">
                  <BarChart data={perf.yearly.map((y) => ({ label: String(y.year).slice(2) + (y.partial ? '*' : ''), value: y.ret, note: `${y.year}${y.partial ? ' (part year)' : ''}` }))} signed yFormat={(v) => pct(v, 0)} height={210} />
                </Card>
                <Card title="Rolling 1-year return" sub="the return of every possible 12-month holding period">
                  {r.rolling.length > 5 ? (
                    <LineChart x={r.rolling.map((x) => x.date)} series={[{ name: 'Your strategy', values: r.rolling.map((x) => x.ret) }, ...(r.benchRolling ? [{ name: benchName, values: r.benchRolling.map((x) => x.ret), color: 'var(--text-3)' }] : [])]} yFormat={(v) => pct(v, 0)} zeroLine height={210} />
                  ) : (
                    <p className="muted small">Needs more than a year of history.</p>
                  )}
                </Card>
              </div>
              <Source>
                <span>Adjusted closing prices in rupees; taxes are not modelled.</span>
              </Source>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
