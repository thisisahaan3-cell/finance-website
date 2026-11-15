import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, BarList, Heatmap, LineChart } from '../../components/charts';
import { Card, Check, Empty, ErrorNote, KV, Loading, Note, Seg, Stat, Stats } from '../../components/ui';
import { basketStats, loadBasket } from '../../lib/analytics';
import { chartDates, getChart } from '../../lib/data/api';
import { benchmarkName, shortSymbol } from '../../lib/data/symbols';
import { loadSeriesIn } from '../../lib/data/series';
import { performance } from '../../lib/finance/backtest';
import { buildHistory, buildLedger, estimateDividends, portfolioXirr, sortTxns, type Txn } from '../../lib/finance/portfolio';
import { EQUITY_CG, equityCapitalGainsTax } from '../../lib/finance/tax';
import { date as fmtDate, duration, money, num, pct, signedMoney, signedPct, times, todayIso, tone } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { calendarPrices, nameOf, rangeSince } from '../../lib/portfolioData';
import { uid, useStore } from '../../lib/store';
import type { TabProps } from './Studio';

/** Ex-dividend history for each symbol, in portfolio currency (foreign payouts at today's exchange rate). */
async function dividendEvents(symbols: string[], since: string, fx: (symbol: string) => number) {
  const out: Record<string, { date: string; perShare: number }[]> = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const chart = await getChart(s, rangeSince(since));
        out[s] = chart.div.map(([t, amount]) => ({ date: chartDates({ t: [t], gmtoffset: chart.gmtoffset })[0], perShare: amount * fx(s) }));
      } catch {
        out[s] = [];
      }
    }),
  );
  return out;
}

/* ---------- Performance ---------- */

export function PerformanceTab({ p, live }: TabProps) {
  const rf = useStore((s) => s.settings.riskFree);
  const [withDividends, setWithDividends] = useState(true);
  const txns = useMemo(() => sortTxns(p.txns), [p.txns]);
  const first = txns.find((t) => t.type === 'buy')?.date;
  const symbols = useMemo(() => [...new Set(txns.filter((t) => t.type === 'buy').map((t) => t.symbol))], [txns]);
  const fxNow = (symbol: string) => {
    const c = live?.quotes[symbol]?.currency;
    return c && c !== p.currency ? live?.fx[c] ?? 1 : 1;
  };

  const data = useAsync(
    first && symbols.length
      ? async () => {
          const range = rangeSince(first);
          const [{ series, failed }, bench, divs] = await Promise.all([
            loadSeriesIn(symbols, range, p.currency),
            loadSeriesIn([p.benchmark], range, p.currency).catch(() => ({ series: [], failed: [] })),
            dividendEvents(symbols, first, fxNow),
          ]);
          return { series, failed, bench: bench.series[0] ?? null, divs };
        }
      : null,
    [p.id, symbols.join(','), first, p.benchmark, live?.fetchedAt ? 1 : 0],
  );

  const result = useMemo(() => {
    if (!data.data || !first) return null;
    const { series, bench, divs } = data.data;
    const logged = new Set(txns.filter((t) => t.type === 'dividend').map((t) => t.symbol));
    const estimated = estimateDividends(txns, Object.fromEntries(Object.entries(divs).filter(([s]) => !logged.has(s))));
    const extra: Txn[] = withDividends ? estimated.map((d) => ({ id: uid(), date: d.date, type: 'dividend' as const, symbol: d.symbol, qty: 0, price: 0, amount: d.amount })) : [];
    const { dates, prices } = calendarPrices(series, first);
    const hist = buildHistory({ txns: [...txns, ...extra], dates, prices });
    if (!hist) return null;
    const from = hist.startIndex;
    const d = hist.dates.slice(from);
    const twr = hist.twr.slice(from).map((v) => v / hist.twr[from]);
    let benchIdx: (number | null)[] | null = null;
    if (bench) {
      let k = 0;
      let last = NaN;
      const lv = d.map((day) => {
        while (k < bench.dates.length && bench.dates[k] <= day) last = bench.adj[k++];
        return last;
      });
      const base = lv.find((x) => Number.isFinite(x));
      benchIdx = base ? lv.map((x) => (Number.isFinite(x) ? x / base : null)) : null;
    }
    const perf = performance(d, twr, rf);
    const benchClean = benchIdx?.every((x) => x !== null) ? (benchIdx as number[]) : null;
    return {
      dates: d,
      value: hist.value.slice(from),
      invested: hist.netInvested.slice(from),
      twr,
      benchIdx,
      perf,
      benchPerf: benchClean ? performance(d, benchClean, rf) : null,
      estimatedTotal: estimated.reduce((s, x) => s + x.amount, 0),
    };
  }, [data.data, txns, first, withDividends, rf]);

  if (!first) return <Card><Empty title="Add a purchase first"><p>Performance needs at least one buy with a date.</p></Empty></Card>;
  if (data.loading && !data.data) return <Loading label="Loading price history for your holdings…" height={200} />;
  if (data.error) return <ErrorNote error={data.error} retry={data.reload} />;
  if (!result) return <Note kind="warn">Not enough price history to chart this portfolio yet. It needs at least one trading day after your first purchase.</Note>;

  const { perf, benchPerf } = result;
  const xirr = live && live.valuation.holdingsValue > 0 ? portfolioXirr(p.txns, live.valuation.holdingsValue, todayIso()) : null;
  const short = (perf?.years ?? 0) < 1;
  const benchName = benchmarkName(p.benchmark);
  return (
    <div className="stack">
      {data.data?.failed.length ? <Note kind="warn">No price history for {data.data.failed.map((f) => f.symbol).join(', ')}; those holdings are left out of the charts.</Note> : null}
      <Stats>
        <Stat label="Tracked for" value={duration(perf?.years)} sub={`since ${fmtDate(result.dates[0])}`} />
        <Stat
          label={short ? 'Return (time-weighted)' : 'Return per year (time-weighted)'}
          tip="How the stocks you picked performed, ignoring when you added or withdrew money. This is the fair number to compare with an index."
          value={signedPct(short ? perf?.totalReturn : perf?.cagr)}
          tone={tone(perf?.totalReturn)}
          sub={short ? 'not annualised: under a year' : `${signedPct(perf?.totalReturn)} in total`}
        />
        <Stat label={`${benchName}, same period`} value={benchPerf ? signedPct(short ? benchPerf.totalReturn : benchPerf.cagr) : '—'} tone={tone(benchPerf?.totalReturn)} sub={benchPerf ? (short ? 'total return' : 'per year') : 'benchmark history unavailable'} />
        <Stat
          label="Ahead / behind"
          tip="Your time-weighted return minus the benchmark's over the same dates."
          value={perf && benchPerf ? `${signedPct((short ? perf.totalReturn : perf.cagr) - (short ? benchPerf.totalReturn : benchPerf.cagr))}` : '—'}
          tone={perf && benchPerf ? tone(perf.totalReturn - benchPerf.totalReturn) : ''}
          sub={short ? 'percentage points' : 'points per year'}
        />
        <Stat label="Your return (XIRR)" tip="Money-weighted: depends on when you invested. If it is far from the time-weighted figure, your timing (luck or skill) made the difference." value={xirr?.rate != null ? signedPct(xirr.rate) : '—'} tone={tone(xirr?.rate)} />
        <Stat label="Deepest fall" tip="The largest drop from a peak to the following low during this period." value={pct(perf?.maxDrawdown)} tone="neg" sub={perf && perf.maxDrawdown < 0 ? `${fmtDate(perf.drawdownPeak)} → ${fmtDate(perf.drawdownTrough)}` : 'none yet'} />
      </Stats>
      <Card title={`Growth of 100: your portfolio against ${benchName}`} sub="time-weighted, so adding money does not look like a gain" right={<Check label="Count estimated dividends" checked={withDividends} onChange={setWithDividends} tip="Adds dividends worked out from each stock's ex-dividend history and the shares you held, for stocks where you have not recorded dividends yourself." />}>
        <LineChart
          x={result.dates}
          series={[
            { name: p.name, values: result.twr.map((v) => v * 100) },
            ...(result.benchIdx ? [{ name: benchName, values: result.benchIdx.map((v) => (v === null ? null : v * 100)), color: 'var(--text-3)' }] : []),
          ]}
          yFormat={(v) => num(v, 0)}
          height={300}
        />
      </Card>
      <Card title="Value of holdings against money put in" sub={`in ${p.currency}; cash balance not included`}>
        <LineChart
          x={result.dates}
          series={[
            { name: 'Market value', values: result.value },
            { name: 'Net money invested', values: result.invested, color: 'var(--text-3)', dashed: true },
          ]}
          area
          height={260}
        />
      </Card>
      {perf && perf.yearly.length > 1 && (
        <Card title="Return by calendar year" sub="time-weighted">
          <BarChart data={perf.yearly.map((y) => ({ label: String(y.year) + (y.partial ? '*' : ''), value: y.ret, note: y.partial ? 'Part year' : 'Return' }))} signed yFormat={(v) => pct(v, 0)} height={200} />
          <p className="tiny muted">* part of the year only.</p>
        </Card>
      )}
      <p className="plain">
        In plain words: there are two honest ways to measure return. <b>Time-weighted</b> asks “were my stock picks good?” and is what you compare with the {benchName}. <b>XIRR</b> asks “how fast did my actual rupees grow?”. If you
        cannot beat the index over several years, a low-cost index fund would have done the job with less effort.
        {withDividends && result.estimatedTotal > 0 ? ` Estimated dividends included: ${money(result.estimatedTotal, p.currency, 0)}.` : ''}
      </p>
    </div>
  );
}

/* ---------- Risk ---------- */

type Look = '1y' | '2y' | '5y';

export function RiskTab({ p, live, loading }: TabProps) {
  useStore((s) => s.symbolMeta);
  const rf = useStore((s) => s.settings.riskFree);
  const [look, setLook] = useState<Look>('2y');
  const v = live?.valuation;
  const positions = useMemo(() => (v?.positions ?? []).filter((x) => x.value !== null && x.value > 0), [v]);
  const symbols = positions.map((x) => x.symbol);
  const basket = useAsync(symbols.length ? () => loadBasket(symbols, look, p.currency, p.benchmark) : null, [symbols.join(','), look, p.currency, p.benchmark]);

  const stats = useMemo(() => {
    if (!basket.data) return null;
    const weights = basket.data.symbols.map((s) => positions.find((x) => x.symbol === s)?.value ?? 0);
    return basketStats(basket.data, weights, rf);
  }, [basket.data, positions, rf]);

  if (!p.txns.length) return <Card><Empty title="Add holdings first"><p>Risk measures need at least one holding.</p></Empty></Card>;
  if (!v) return loading ? <Loading label="Fetching live prices…" height={160} /> : null;
  if (basket.loading && !basket.data) return <Loading label="Loading price history…" height={200} />;
  if (basket.error) return <ErrorNote error={basket.error} retry={basket.reload} />;
  if (!basket.data || !stats || !stats.perf) return <Note kind="warn">Not enough shared price history across these holdings to measure risk. Try a shorter look-back.</Note>;

  const b = basket.data;
  const perf = stats.perf;
  const total = positions.filter((x) => b.symbols.includes(x.symbol)).reduce((s, x) => s + x.value!, 0);
  const w = b.symbols.map((s) => (positions.find((x) => x.symbol === s)?.value ?? 0) / total);
  const order = b.symbols.map((_, i) => i).sort((i, j) => stats.riskShare[j] - stats.riskShare[i]);
  const heat = order.slice(0, 14);
  const dayVar = stats.var95 ? stats.var95.var * v.holdingsValue : null;
  const beta = stats.regression?.beta;
  const benchName = benchmarkName(p.benchmark);

  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">
          How your <b>current mix</b> would have behaved from {fmtDate(stats.dates[0])} to {fmtDate(stats.dates[stats.dates.length - 1])} ({stats.observations} trading days). Cash is excluded.
          {b.aligned.limitedBy ? ` The window starts when ${shortSymbol(b.aligned.limitedBy)} began trading.` : ''}
        </span>
        <Seg options={[{ value: '1y', label: '1 year' }, { value: '2y', label: '2 years' }, { value: '5y', label: '5 years' }]} value={look} onChange={setLook} label="Look-back period" />
      </div>
      {b.failed.length > 0 && <Note kind="warn">Left out (no history): {b.failed.map((f) => f.symbol).join(', ')}.</Note>}
      <Stats>
        <Stat label="Volatility" tip="How much the portfolio's value swings in a typical year (annualised standard deviation of daily returns). The NIFTY 50 has usually been around 15–20%." value={pct(perf.volatility)} sub={stats.benchPerf ? `${benchName}: ${pct(stats.benchPerf.volatility)}` : undefined} />
        <Stat label="Beta" tip={`How much the portfolio tends to move when the ${benchName} moves 1%. Above 1 means it amplifies the market; below 1 means it is calmer.`} value={beta !== undefined ? num(beta, 2) : '—'} sub={beta !== undefined ? (beta > 1.1 ? 'more sensitive than the market' : beta < 0.9 ? 'calmer than the market' : 'moves with the market') : 'no benchmark data'} />
        <Stat label="Deepest fall" tip="Largest peak-to-trough drop in this period. Ask yourself whether you could have sat through it without selling." value={pct(perf.maxDrawdown)} tone="neg" sub={`${fmtDate(perf.drawdownPeak)} → ${fmtDate(perf.drawdownTrough)}`} />
        <Stat label="Sharpe ratio" tip={`Return earned above the risk-free rate (${pct(rf)}) per unit of volatility. Above 1 is good; below 0 means a fixed deposit did better.`} value={num(perf.sharpe, 2)} />
        <Stat label="Sortino ratio" tip="Like Sharpe, but only downward swings count as risk." value={num(perf.sortino, 2)} />
        <Stat label="Bad-day loss (95% VaR)" tip="On 19 days out of 20 the portfolio lost less than this in a day; on the worst 1 in 20 it lost more. Based on what actually happened in this period." value={stats.var95 ? pct(stats.var95.var, 2) : '—'} sub={dayVar !== null ? `about ${money(dayVar, p.currency, 0)} today` : undefined} />
      </Stats>
      <div className="grid cols-2">
        <Card title="Where the risk comes from" sub="share of total risk against share of money">
          <BarList
            items={order.map((i) => ({
              label: shortSymbol(b.symbols[i]),
              title: `${nameOf(b.symbols[i])}: ${pct(w[i])} of money, ${pct(stats.riskShare[i])} of risk`,
              share: Math.max(0, stats.riskShare[i]),
              mark: w[i],
              display: pct(stats.riskShare[i], 0),
              color: stats.riskShare[i] > w[i] * 1.25 ? 'var(--s2)' : 'var(--s1)',
            }))}
          />
          <p className="tiny muted mt-s">Bar = share of portfolio risk. Black tick = share of money. Orange bars carry noticeably more risk than their weight.</p>
        </Card>
        <Card title="More measures">
          <KV
            rows={[
              ['Return per year in this period', signedPct(perf.cagr), { tone: tone(perf.cagr) }],
              [`${benchName} return per year`, stats.benchPerf ? signedPct(stats.benchPerf.cagr) : '—'],
              ['Alpha (per year)', stats.regression ? signedPct(stats.regression.alpha) : '—', { tip: 'Return not explained by market moves, after allowing for beta. Noisy over short periods: treat with caution.' }],
              ['Moves explained by the market (R²)', stats.regression ? pct(stats.regression.r2, 0) : '—', { tip: 'How much of the portfolio’s day-to-day movement is just the market moving.' }],
              ['Tracking error', stats.tracking ? pct(stats.tracking.trackingError) : '—', { tip: 'How far the portfolio strays from the benchmark in a typical year.' }],
              ['Average loss on the worst 5% of days (CVaR)', stats.var95 ? pct(stats.var95.cvar, 2) : '—'],
              ['1-in-100 bad day (99% VaR)', stats.var99 ? pct(stats.var99.var, 2) : '—'],
              ['Diversification ratio', times(stats.diversification), { tip: 'Average volatility of the holdings divided by the portfolio’s volatility. 1.0× means no benefit from mixing; higher is better.' }],
              ['Months with a gain', pct(perf.positiveMonths, 0)],
            ]}
          />
          <div className="row mt">
            <Link className="btn sm" to={`/risk?portfolio=${p.id}`}>
              Stress-test in the Risk lab
            </Link>
            <Link className="btn sm" to={`/optimizer?portfolio=${p.id}`}>
              Optimise the weights
            </Link>
          </div>
        </Card>
      </div>
      {heat.length > 1 && (
        <Card title="How your stocks move together" sub="correlation of daily returns">
          <Heatmap labels={heat.map((i) => shortSymbol(b.symbols[i]))} matrix={heat.map((i) => heat.map((j) => stats.corr[i][j]))} />
          <p className="tiny muted mt-s">
            +1 (blue) means two stocks rise and fall together, so holding both adds little safety. Values near 0 mean they move independently, which is what makes diversification work.
            {b.symbols.length > heat.length ? ` Showing the ${heat.length} holdings that carry the most risk.` : ''}
          </p>
        </Card>
      )}
      <p className="plain">In plain words: risk here means how bumpy the ride is and how deep the falls can get. These figures describe the past for the mix you hold today; the future will differ, and calm periods understate real risk.</p>
    </div>
  );
}

/* ---------- Tax & income ---------- */

export function TaxTab({ p, live, loading }: TabProps) {
  useStore((s) => s.symbolMeta);
  const ledger = useMemo(() => buildLedger(p.txns), [p.txns]);
  const v = live?.valuation;
  const indian = p.currency === 'INR';
  const byFy = useMemo(() => {
    const map = new Map<string, { stcg: number; ltcg: number; proceeds: number }>();
    for (const r of ledger.realised) {
      const e = map.get(r.financialYear) ?? { stcg: 0, ltcg: 0, proceeds: 0 };
      if (r.longTerm) e.ltcg += r.gain;
      else e.stcg += r.gain;
      e.proceeds += r.proceeds;
      map.set(r.financialYear, e);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [ledger]);

  const first = sortTxns(p.txns).find((t) => t.type === 'buy')?.date;
  const heldEver = useMemo(() => [...new Set(p.txns.filter((t) => t.type === 'buy').map((t) => t.symbol))], [p.txns]);
  const divs = useAsync(first && heldEver.length ? () => dividendEvents(heldEver, first, (s) => { const c = live?.quotes[s]?.currency; return c && c !== p.currency ? live?.fx[c] ?? 1 : 1; }) : null, [heldEver.join(','), first, live?.fetchedAt ? 1 : 0]);
  const estimated = useMemo(() => (divs.data ? estimateDividends(p.txns, divs.data) : []), [divs.data, p.txns]);
  const estBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of estimated) m.set(e.symbol, (m.get(e.symbol) ?? 0) + e.amount);
    return m;
  }, [estimated]);
  const last12 = estimated.filter((e) => Date.parse(e.date) > Date.now() - 365 * 86_400_000).reduce((s, e) => s + e.amount, 0);

  if (!p.txns.length) return <Card><Empty title="Add holdings first"><p>Tax and income are worked out from your transactions.</p></Empty></Card>;

  const lt = v?.positions.reduce((s, x) => s + (x.longTermGain ?? 0), 0) ?? 0;
  const st = v?.positions.reduce((s, x) => s + (x.shortTermGain ?? 0), 0) ?? 0;
  const ifSold = equityCapitalGainsTax(st, lt);
  const losers = (v?.positions ?? []).filter((x) => (x.unrealised ?? 0) < 0).sort((a, b) => (a.unrealised ?? 0) - (b.unrealised ?? 0));

  return (
    <div className="stack">
      {!indian && <Note kind="warn">The tax estimates below use Indian rules for listed equity. This portfolio is in {p.currency}, so treat the gains as accurate and the tax as not applicable.</Note>}
      <div className="grid cols-2">
        <Card title="If you sold everything today" sub="unrealised gains by holding period">
          {!v ? (
            loading ? <Loading /> : <p className="muted">Needs live prices.</p>
          ) : (
            <>
              <KV
                rows={[
                  ['Short-term gain (held 12 months or less)', signedMoney(st, p.currency, 0), { tone: tone(st), tip: 'Taxed at 20% for listed shares and equity funds.' }],
                  ['Long-term gain (held more than 12 months)', signedMoney(lt, p.currency, 0), { tone: tone(lt), tip: 'Taxed at 12.5% on the amount above ₹1.25 lakh per financial year.' }],
                  indian && ['Tax on short-term gain', money(ifSold.stcgTax, p.currency, 0)],
                  indian && ['Tax on long-term gain', money(ifSold.ltcgTax, p.currency, 0)],
                  indian && ['Health and education cess (4%)', money(ifSold.cess, p.currency, 0)],
                  indian && ['Estimated tax', money(ifSold.total, p.currency, 0), { total: true }],
                  indian && v.holdingsValue > 0 && ['You would keep', money(v.holdingsValue - ifSold.total, p.currency, 0), { total: true }],
                ]}
              />
              {indian && lt > 0 && lt < EQUITY_CG.ltcgExemption && <p className="tiny muted mt-s">Your long-term gains are inside the ₹1.25 lakh yearly exemption, so they would be tax-free if nothing else was sold this year.</p>}
            </>
          )}
        </Card>
        <Card title="Gains already booked" sub="by Indian financial year (April to March)" flush>
          {byFy.length === 0 ? (
            <Empty title="No sales recorded">
              <p>When you record a sale, the gain is split into short-term and long-term here using first-in-first-out, as the tax rules require.</p>
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="r">Short-term</th>
                    <th className="r">Long-term</th>
                    {indian && <th className="r">Est. tax</th>}
                  </tr>
                </thead>
                <tbody>
                  {byFy.map(([fy, g]) => (
                    <tr key={fy}>
                      <td>FY {fy}</td>
                      <td className={'r ' + tone(g.stcg)}>{signedMoney(g.stcg, p.currency, 0)}</td>
                      <td className={'r ' + tone(g.ltcg)}>{signedMoney(g.ltcg, p.currency, 0)}</td>
                      {indian && <td className="r">{money(equityCapitalGainsTax(g.stcg, g.ltcg).total, p.currency, 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {indian && <Note>{EQUITY_CG.note} Sales before 23 July 2024 were taxed at the older rates (15% and 10%), which this estimate does not apply.</Note>}
      {indian && losers.length > 0 && (
        <Card title="Positions at a loss" sub="candidates for tax-loss harvesting" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="r">Unrealised loss</th>
                  <th className="r">of which short-term</th>
                  <th className="r">of which long-term</th>
                </tr>
              </thead>
              <tbody>
                {losers.map((x) => (
                  <tr key={x.symbol}>
                    <td>
                      {shortSymbol(x.symbol)}
                      <span className="sub">{nameOf(x.symbol)}</span>
                    </td>
                    <td className="r neg">{signedMoney(x.unrealised, p.currency, 0)}</td>
                    <td className={'r ' + tone(x.shortTermGain)}>{signedMoney(x.shortTermGain, p.currency, 0)}</td>
                    <td className={'r ' + tone(x.longTermGain)}>{signedMoney(x.longTermGain, p.currency, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ padding: '10px 14px' }}>
            Selling a loser books a loss that reduces tax on your gains this year (short-term losses offset any gain; long-term losses offset only long-term gains), and unused losses carry forward for eight years if you file on time. Only
            do this if you no longer want the stock, or are happy to buy it back at the market price.
          </p>
        </Card>
      )}
      <Card title="Dividend income" sub="recorded by you, and estimated from each stock's ex-dividend history" flush>
        {divs.loading && !divs.data ? (
          <Loading />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="r">Recorded</th>
                  <th className="r">Estimated since you bought</th>
                </tr>
              </thead>
              <tbody>
                {heldEver.map((s) => (
                  <tr key={s}>
                    <td>{shortSymbol(s)}</td>
                    <td className="r">{ledger.holdings[s]?.dividends ? money(ledger.holdings[s].dividends, p.currency, 0) : '—'}</td>
                    <td className="r">{estBySymbol.get(s) ? money(estBySymbol.get(s)!, p.currency, 0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="r">{money(Object.values(ledger.holdings).reduce((s, h) => s + h.dividends, 0), p.currency, 0)}</td>
                  <td className="r">{money(estimated.reduce((s, e) => s + e.amount, 0), p.currency, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="small muted" style={{ padding: '10px 14px' }}>
          Estimated dividends in the last 12 months: <b>{money(last12, p.currency, 0)}</b>
          {v && v.holdingsValue > 0 ? ` (${pct(last12 / v.holdingsValue, 2)} of today's value)` : ''}. Estimates are per-share payouts multiplied by the shares you held before each ex-date, before any tax deducted at source. In India
          dividends are added to your income and taxed at your slab rate.
        </p>
      </Card>
    </div>
  );
}
