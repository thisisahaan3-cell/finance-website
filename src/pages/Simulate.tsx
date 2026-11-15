import { useMemo, useState } from 'react';
import { BarChart, LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { TickerSearch } from '../components/TickerSearch';
import { Card, Check, MoneyField, Note, NumberField, PercentField, Seg, SelectField, Stat, Stats } from '../components/ui';
import { getChart } from '../lib/data/api';
import { toDaily } from '../lib/data/series';
import { monthlyReturns } from '../lib/finance/backtest';
import { simulate, type ReturnModel, type SimulationInput } from '../lib/finance/montecarlo';
import { histogram, mean, percentile, stdev } from '../lib/finance/stats';
import { compact, date as fmtDate, money, num, pct } from '../lib/format';
import { attempt } from '../lib/hooks';
import { rememberMeta, useSaved, useStore } from '../lib/store';

interface Inputs {
  initial: number;
  monthly: number;
  stepUp: number;
  years: number;
  contributionYears: number;
  expectedReturn: number;
  volatility: number;
  model: 'lognormal' | 'fat-tails' | 'bootstrap';
  withdrawal: number;
  withdrawalStart: number;
  inflation: number;
  fee: number;
  goal: number;
  paths: number;
  seed: number;
  real: boolean;
  historySymbol: string;
}

const PRESETS: { label: string; ret: number; vol: number; note: string }[] = [
  { label: 'Mostly shares', ret: 0.12, vol: 0.18, note: 'An assumption in the range often used for a diversified Indian equity portfolio.' },
  { label: 'Balanced', ret: 0.095, vol: 0.11, note: 'An assumption for roughly 60% shares and 40% bonds.' },
  { label: 'Mostly bonds / deposits', ret: 0.07, vol: 0.03, note: 'An assumption for high-quality debt funds or deposits.' },
];

export default function Simulate() {
  const settings = useStore((s) => s.settings);
  const [inp, set, reset] = useSaved<Inputs>('simulate', {
    initial: 500_000,
    monthly: 20_000,
    stepUp: 0.05,
    years: 20,
    contributionYears: 20,
    expectedReturn: 0.12,
    volatility: 0.18,
    model: 'lognormal',
    withdrawal: 0,
    withdrawalStart: 20,
    inflation: settings.inflation,
    fee: 0.005,
    goal: 20_000_000,
    paths: 5000,
    seed: 2026,
    real: false,
    historySymbol: '^NSEI',
  });
  const [hist, setHist] = useState<{ symbol: string; name: string; monthly: number[]; from: string; to: string } | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  const loadHistory = async (symbol: string) => {
    setHistBusy(true);
    setHistError(null);
    try {
      const chart = await getChart(symbol, 'max', '1d');
      const d = toDaily(chart);
      const m = monthlyReturns(d.dates, d.adj).slice(1, -1); // drop the partial first and last months
      if (m.length < 24) throw new Error(`${symbol} has under two years of monthly history: too little to learn from.`);
      setHist({ symbol, name: chart.name, monthly: m.map((x) => x.ret), from: m[0].month, to: m[m.length - 1].month });
      set({ historySymbol: symbol });
      return m.map((x) => x.ret);
    } catch (e) {
      setHistError((e as Error).message);
      return null;
    } finally {
      setHistBusy(false);
    }
  };

  const fillFromHistory = async () => {
    const m = hist?.symbol === inp.historySymbol ? hist.monthly : await loadHistory(inp.historySymbol);
    if (!m) return;
    set({ expectedReturn: Number((mean(m) * 12).toFixed(4)), volatility: Number((stdev(m) * Math.sqrt(12)).toFixed(4)) });
  };

  const result = useMemo(() => {
    const model: ReturnModel | null =
      inp.model === 'bootstrap'
        ? hist
          ? { kind: 'bootstrap', monthlyReturns: hist.monthly, blockMonths: 6 }
          : null
        : inp.model === 'fat-tails'
          ? { kind: 'fat-tails', expectedReturn: inp.expectedReturn, volatility: inp.volatility, degreesOfFreedom: 4 }
          : { kind: 'lognormal', expectedReturn: inp.expectedReturn, volatility: inp.volatility };
    if (!model) return null;
    const input: SimulationInput = {
      model,
      years: inp.years,
      initial: inp.initial,
      monthlyContribution: inp.monthly,
      contributionGrowth: inp.stepUp,
      contributionYears: Math.min(inp.contributionYears, inp.years),
      monthlyWithdrawal: inp.withdrawal,
      withdrawalStartYear: inp.withdrawalStart,
      inflation: inp.inflation,
      annualFee: inp.fee,
      paths: inp.paths,
      seed: inp.seed,
      goal: inp.goal,
    };
    return attempt(() => simulate(input));
  }, [inp, hist]);

  const r = result?.value;
  const deflate = (v: number, year: number) => (inp.real ? v / Math.pow(1 + inp.inflation, year) : v);
  const term = r ? (inp.real ? r.terminalReal : r.terminal) : [];
  const termHist = useMemo(() => {
    if (!term.length) return [];
    const cap = percentile(term, 0.98);
    return histogram(term.map((v) => Math.min(v, cap)), 30);
  }, [term]);

  return (
    <Page tool="simulate" actions={<button className="btn sm" onClick={reset}>Reset</button>}>
      <div className="split wide">
        <div className="stack">
          <Card title="Your plan">
            <div className="form two">
              <MoneyField label="Invested today" value={inp.initial} onChange={(initial) => set({ initial })} min={0} decimals={0} />
              <MoneyField label="Added every month" value={inp.monthly} onChange={(monthly) => set({ monthly })} min={0} decimals={0} />
              <PercentField label="Raise the monthly amount each year by" value={inp.stepUp} onChange={(stepUp) => set({ stepUp })} min={0} max={0.5} tip="A step-up: as your salary grows, so does what you invest." />
              <NumberField label="Keep adding for" suffix="yrs" value={inp.contributionYears} onChange={(contributionYears) => set({ contributionYears })} min={0} max={60} decimals={0} />
              <NumberField label="Total period" suffix="yrs" value={inp.years} onChange={(years) => set({ years })} min={1} max={60} decimals={0} />
              <MoneyField label="Goal (today's money)" value={inp.goal} onChange={(goal) => set({ goal })} min={0} decimals={0} tip="What you want to have at the end, in today's purchasing power. Leave at 0 for no goal." />
            </div>
          </Card>
          <Card title="Withdrawals" sub="for retirement or regular income">
            <div className="form two">
              <MoneyField label="Monthly withdrawal (today's money)" value={inp.withdrawal} onChange={(withdrawal) => set({ withdrawal })} min={0} decimals={0} tip="Rises with inflation every year so its purchasing power stays the same." />
              <NumberField label="Starting after" suffix="yrs" value={inp.withdrawalStart} onChange={(withdrawalStart) => set({ withdrawalStart })} min={0} max={60} decimals={0} />
            </div>
          </Card>
          <Card title="Market assumptions">
            <div className="form">
              <div className="field">
                <span className="label">How returns are generated</span>
                <Seg
                  options={[
                    { value: 'lognormal', label: 'Standard' },
                    { value: 'fat-tails', label: 'With crashes' },
                    { value: 'bootstrap', label: 'Replay history' },
                  ]}
                  value={inp.model}
                  onChange={(model) => {
                    set({ model });
                    if (model === 'bootstrap' && !hist) void loadHistory(inp.historySymbol);
                  }}
                />
                <span className="hint">
                  {inp.model === 'lognormal' && 'Returns follow the classic bell-curve model with the average and volatility below.'}
                  {inp.model === 'fat-tails' && 'Same average and volatility, but extreme months (both crashes and surges) happen more often, as they do in real markets.'}
                  {inp.model === 'bootstrap' && 'No formula: real past months are drawn at random, in six-month runs so that streaks and crashes stay intact.'}
                </span>
              </div>
              {inp.model !== 'bootstrap' && (
                <>
                  <div className="chips">
                    {PRESETS.map((p) => (
                      <button key={p.label} className={'chip' + (Math.abs(p.ret - inp.expectedReturn) < 1e-9 && Math.abs(p.vol - inp.volatility) < 1e-9 ? ' on' : '')} title={p.note} onClick={() => set({ expectedReturn: p.ret, volatility: p.vol })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="form two">
                    <PercentField label="Average return per year" value={inp.expectedReturn} onChange={(expectedReturn) => set({ expectedReturn })} min={-0.2} max={0.5} tip="Before fees. The presets are assumptions, not facts: use the button below to measure a real index or stock instead." />
                    <PercentField label="Volatility per year" value={inp.volatility} onChange={(volatility) => set({ volatility })} min={0} max={1} tip="How widely yearly returns scatter around the average." />
                  </div>
                </>
              )}
              <div className="field">
                <span className="label">{inp.model === 'bootstrap' ? 'History to replay' : 'Or measure from real history'}</span>
                <TickerSearch placeholder={`Currently ${inp.historySymbol}. Search to change…`} onPick={(x) => { rememberMeta(x.symbol, { name: x.name }); void loadHistory(x.symbol); }} />
                <div className="row">
                  {inp.model !== 'bootstrap' && (
                    <button className="btn sm" onClick={fillFromHistory} disabled={histBusy}>
                      {histBusy ? 'Loading…' : `Use ${inp.historySymbol}'s actual average and volatility`}
                    </button>
                  )}
                  {hist && (
                    <span className="tiny muted">
                      {hist.name}: {hist.monthly.length} months, {hist.from} to {hist.to}. Average {pct(mean(hist.monthly) * 12)} a year, volatility {pct(stdev(hist.monthly) * Math.sqrt(12))}.
                    </span>
                  )}
                </div>
                {histError && <Note kind="err">{histError}</Note>}
              </div>
              <div className="form two">
                <PercentField label="Inflation" value={inp.inflation} onChange={(inflation) => set({ inflation })} min={0} max={0.3} />
                <PercentField label="Yearly costs" value={inp.fee} onChange={(fee) => set({ fee })} min={0} max={0.05} tip="Fund expense ratio or advisory fees, taken off every year. Even 1% compounds into a large amount over decades." />
                <SelectField label="Number of simulated futures" value={String(inp.paths)} onChange={(v) => set({ paths: Number(v) })} options={[{ value: '1000', label: '1,000 (fast)' }, { value: '5000', label: '5,000' }, { value: '10000', label: '10,000 (smoothest)' }]} />
                <NumberField label="Random seed" value={inp.seed} onChange={(seed) => set({ seed })} min={0} max={999999} decimals={0} tip="The same seed always gives the same result, so you can compare plans fairly. Change it to see how much the answer moves by chance." />
              </div>
            </div>
          </Card>
        </div>
        <div className="stack">
          {inp.model === 'bootstrap' && !hist && !histError && <Note>{histBusy ? 'Loading history to replay…' : 'Choose a stock or index whose history should be replayed.'}</Note>}
          {result?.error && <Note kind="err">{result.error}</Note>}
          {r && (
            <>
              <Stats>
                <Stat big label="Middle outcome" tip="The median: half of the simulated futures end above this, half below." value={compact(percentile(term, 0.5))} sub={inp.real ? "in today's money" : `in ${new Date().getFullYear() + Math.round(inp.years)} rupees`} />
                <Stat label="Poor outcome" tip="1 future in 20 ended below this (5th percentile)." value={compact(percentile(term, 0.05))} tone="neg" />
                <Stat label="Strong outcome" tip="1 future in 20 ended above this (95th percentile)." value={compact(percentile(term, 0.95))} tone="pos" />
                <Stat label="You put in" value={compact(r.totalContributed)} />
                {inp.goal > 0 && <Stat big label="Chance of reaching the goal" value={pct(r.goalProbability, 0)} tone={(r.goalProbability ?? 0) >= 0.75 ? 'pos' : (r.goalProbability ?? 0) < 0.5 ? 'neg' : ''} sub={`${compact(inp.goal)} in today's money`} />}
                {inp.withdrawal > 0 && <Stat big label="Chance the money lasts" value={pct(r.survival, 0)} tone={r.survival >= 0.85 ? 'pos' : r.survival < 0.6 ? 'neg' : ''} sub={r.medianDepletionYear ? `when it fails, typically in year ${num(r.medianDepletionYear, 0)}` : 'never ran out'} />}
              </Stats>
              <Card title="Range of possible futures" sub={`${num(inp.paths, 0)} simulations`} right={<Check label="Show in today's money" checked={inp.real} onChange={(real) => set({ real })} tip="Removes inflation, so the numbers show what the money would actually buy." />}>
                <LineChart
                  x={r.years.map((y) => new Date().getFullYear() + Math.round(y))}
                  series={[{ name: 'Middle outcome (median)', values: r.p50.map((v, i) => deflate(v, r.years[i])) }]}
                  bands={[
                    { name: '9 in 10 futures fall in here', lo: r.p5.map((v, i) => deflate(v, r.years[i])), hi: r.p95.map((v, i) => deflate(v, r.years[i])), opacity: 0.12 },
                    { name: 'Half of all futures', lo: r.p25.map((v, i) => deflate(v, r.years[i])), hi: r.p75.map((v, i) => deflate(v, r.years[i])), opacity: 0.2 },
                  ]}
                  height={320}
                />
              </Card>
              <div className="grid cols-2">
                <Card title="Where the futures ended" sub="the top 2% are grouped into the last bar">
                  <BarChart dense data={termHist.map((h) => ({ label: compact((h.from + h.to) / 2, 'INR', 1), value: h.count, note: 'Simulations' }))} yFormat={(v) => num(v, 0)} height={220} />
                </Card>
                <Card title="Milestones along the way" flush>
                  <div className="tbl-wrap">
                    <table className="tbl compact">
                      <thead>
                        <tr>
                          <th>After</th>
                          <th className="r">Poor (1 in 20)</th>
                          <th className="r">Middle</th>
                          <th className="r">Strong (1 in 20)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.years
                          .map((y, i) => ({ y, i }))
                          .filter(({ y, i }) => i > 0 && (i === r.years.length - 1 || y % Math.max(1, Math.round(inp.years / 6)) === 0))
                          .map(({ y, i }) => (
                            <tr key={i}>
                              <td>{num(y, 0)} years</td>
                              <td className="r">{compact(deflate(r.p5[i], y))}</td>
                              <td className="r strong">{compact(deflate(r.p50[i], y))}</td>
                              <td className="r">{compact(deflate(r.p95[i], y))}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
              <p className="plain">
                In plain words: nobody knows next year's return, so instead of one forecast this draws {num(inp.paths, 0)} different futures and shows the spread. Plan around the poor outcome, not the middle one. If the chance of
                success is too low, the levers are: invest more, invest longer, spend less, or accept more risk.
                {inp.model !== 'bootstrap' ? ` The middle outcome is below what a calculator using a flat ${pct(inp.expectedReturn, 0)} would show, because ups and downs drag compound growth below the average return.` : ''}
              </p>
              <Note>
                The plan adds {money(inp.monthly, 'INR', 0)} a month{inp.stepUp > 0 ? `, rising ${pct(inp.stepUp, 0)} a year,` : ''} for {num(Math.min(inp.contributionYears, inp.years), 0)} years
                {inp.withdrawal > 0 ? `, then withdraws ${money(inp.withdrawal, 'INR', 0)} a month in today's money from year ${num(inp.withdrawalStart, 0)}` : ''}. Taxes are not modelled.
                {hist && inp.model === 'bootstrap' ? ` Replaying ${hist.name}, ${fmtDate(hist.from + '-01')} to ${fmtDate(hist.to + '-01')}: the future may not resemble this period.` : ''}
              </Note>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
