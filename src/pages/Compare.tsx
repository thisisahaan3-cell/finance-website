import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasketPicker, useBasket } from '../components/Basket';
import { Heatmap, LineChart, seriesColor } from '../components/charts';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, Loading, Note, Seg, Source } from '../components/ui';
import { loadBasket } from '../lib/analytics';
import { getFundamentals, type Range } from '../lib/data/api';
import { shortSymbol } from '../lib/data/symbols';
import { performance } from '../lib/finance/backtest';
import { correlationFromCov, covarianceMatrix } from '../lib/finance/stats';
import { compact, date as fmtDate, num, pct, signedPct, times, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

export default function Compare() {
  const basket = useBasket('compare', [
    { symbol: 'RELIANCE.NS', weight: 0 },
    { symbol: 'TCS.NS', weight: 0 },
    { symbol: '^NSEI', weight: 0 },
  ]);
  const [inp, set] = useSaved<{ range: Range }>('compare', { range: '5y' });
  const rf = useStore((s) => s.settings.riskFree);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const list = params.get('symbols');
    if (!list) return;
    basket.setItems([...new Set(list.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 8).map((symbol) => ({ symbol, weight: 0 })));
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbols = basket.items.map((i) => i.symbol);
  const data = useAsync(symbols.length ? () => loadBasket(symbols, inp.range, 'INR', null) : null, [symbols.join(','), inp.range]);
  const funda = useAsync(symbols.length ? () => getFundamentals(symbols.filter((s) => !s.startsWith('^') && !s.includes('='))) : null, [symbols.join(',')]);

  const calc = useMemo(() => {
    const b = data.data;
    if (!b || b.aligned.dates.length < 3) return null;
    const n = b.symbols.length;
    const dates = b.aligned.dates;
    const cols = b.symbols.map((_, i) => b.aligned.matrix.map((r) => r[i]));
    const perf = cols.map((c) => performance(dates, c, rf));
    const rows: number[][] = [];
    for (let t = 1; t < dates.length; t++) rows.push(b.aligned.matrix[t].slice(0, n).map((v, i) => v / b.aligned.matrix[t - 1][i] - 1));
    return { b, dates, index: cols.map((c) => c.map((v) => (v / c[0]) * 100)), perf, corr: n > 1 && rows.length > 20 ? correlationFromCov(covarianceMatrix(rows)) : null };
  }, [data.data, rf]);

  const metric = (label: string, tip: string, get: (i: number) => React.ReactNode) => ({ label, tip, get });
  const rowsDef = calc
    ? [
        metric('Total return', 'Growth over the whole period, dividends included, measured in rupees.', (i) => <span className={tone(calc.perf[i]?.totalReturn)}>{signedPct(calc.perf[i]?.totalReturn)}</span>),
        metric('Return per year', 'Compound annual growth rate.', (i) => <span className={tone(calc.perf[i]?.cagr)}>{signedPct(calc.perf[i]?.cagr)}</span>),
        metric('Volatility', 'Typical yearly swing.', (i) => pct(calc.perf[i]?.volatility)),
        metric('Deepest fall', 'Largest peak-to-trough drop in the period.', (i) => <span className="neg">{pct(calc.perf[i]?.maxDrawdown)}</span>),
        metric('Sharpe ratio', 'Return above the risk-free rate per unit of volatility.', (i) => num(calc.perf[i]?.sharpe, 2)),
        metric('Best year', 'Best full calendar year.', (i) => (calc.perf[i]?.bestYear ? `${signedPct(calc.perf[i]!.bestYear!.ret, 0)} (${calc.perf[i]!.bestYear!.year})` : '—')),
        metric('Worst year', 'Worst full calendar year.', (i) => (calc.perf[i]?.worstYear ? `${signedPct(calc.perf[i]!.worstYear!.ret, 0)} (${calc.perf[i]!.worstYear!.year})` : '—')),
      ]
    : [];
  const fd = (s: string) => funda.data?.[s];
  const fundRows: [string, (s: string) => React.ReactNode][] = [
    ['Sector', (s) => fd(s)?.sector ?? '—'],
    ['Market value', (s) => compact(fd(s)?.marketCap, fd(s)?.currency)],
    ['P/E ratio', (s) => (fd(s)?.trailingPE ? num(fd(s)!.trailingPE, 1) : '—')],
    ['Price to book', (s) => (fd(s)?.priceToBook ? num(fd(s)!.priceToBook, 1) : '—')],
    ['EV / EBITDA', (s) => (fd(s)?.evToEbitda ? num(fd(s)!.evToEbitda, 1) : '—')],
    ['Return on equity', (s) => pct(fd(s)?.roe)],
    ['Net profit margin', (s) => pct(fd(s)?.profitMargin)],
    ['Sales growth', (s) => <span className={tone(fd(s)?.revenueGrowth)}>{signedPct(fd(s)?.revenueGrowth)}</span>],
    ['Profit growth', (s) => <span className={tone(fd(s)?.earningsGrowth)}>{signedPct(fd(s)?.earningsGrowth)}</span>],
    ['Debt to equity', (s) => (fd(s)?.debtToEquity != null ? times(fd(s)!.debtToEquity, 2) : '—')],
    ['Dividend yield', (s) => pct(fd(s)?.dividendYield, 2)],
  ];
  const companies = calc ? calc.b.symbols.filter((s) => fd(s)?.ok) : [];

  return (
    <Page tool="compare">
      <div className="split">
        <Card title="What to compare" sub="up to 8">
          <BasketPicker items={basket.items} onChange={basket.setItems} noWeights max={8} onLoadPortfolio={basket.fromPortfolio} seeding={basket.seeding} seedError={basket.seedError} />
        </Card>
        <div className="stack">
          {!symbols.length && (
            <Card>
              <Empty title="Add two or more things to compare">
                <p>Stocks, ETFs, indices, gold, currencies: anything with a price history. Everything is converted to rupees so the comparison is fair for an Indian investor.</p>
              </Empty>
            </Card>
          )}
          {data.loading && !data.data && <Loading label="Loading price history…" height={160} />}
          {data.error && <ErrorNote error={data.error} retry={data.reload} />}
          {data.data?.failed.length ? <Note kind="warn">No history for {data.data.failed.map((f) => f.symbol).join(', ')}.</Note> : null}
          {calc && (
            <>
              <Card
                title="Growth of 100"
                sub={`${fmtDate(calc.dates[0])} to ${fmtDate(calc.dates[calc.dates.length - 1])}, in rupees, dividends reinvested`}
                right={<Seg options={[{ value: '1y', label: '1Y' }, { value: '2y', label: '2Y' }, { value: '5y', label: '5Y' }, { value: '10y', label: '10Y' }, { value: 'max', label: 'All' }]} value={inp.range} onChange={(range) => set({ range: range as Range })} label="Period" />}
              >
                <LineChart x={calc.dates} series={calc.b.symbols.map((s, i) => ({ name: shortSymbol(s), values: calc.index[i], color: seriesColor(i) }))} yFormat={(v) => num(v, 0)} height={320} />
                {calc.b.aligned.limitedBy && <p className="tiny muted">The comparison starts when {shortSymbol(calc.b.aligned.limitedBy)} has data, so that every line covers the same period.</p>}
              </Card>
              <Card title="Returns and risk" sub="same period for all" flush>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Measure</th>
                        {calc.b.symbols.map((s, i) => (
                          <th className="r" key={s}>
                            <i className="swatch line" style={{ background: seriesColor(i), marginRight: 5, verticalAlign: 'middle' }} />
                            <Link to={`/stock/${encodeURIComponent(s)}`}>{shortSymbol(s)}</Link>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowsDef.map((r) => (
                        <tr key={r.label}>
                          <td title={r.tip}>{r.label}</td>
                          {calc.b.symbols.map((s, i) => (
                            <td className="r" key={s}>
                              {r.get(i)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {companies.length > 0 && (
                <Card title="Business and valuation" sub="latest figures" flush>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Measure</th>
                          {companies.map((s) => (
                            <th className="r" key={s}>
                              {shortSymbol(s)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fundRows.map(([label, get]) => (
                          <tr key={label}>
                            <td>{label}</td>
                            {companies.map((s) => (
                              <td className="r" key={s}>
                                {get(s)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {calc.corr && (
                <Card title="How they move together" sub="correlation of daily returns">
                  <Heatmap labels={calc.b.symbols.map(shortSymbol)} matrix={calc.corr} />
                  <p className="tiny muted mt-s">Pairs with low or negative correlation make better partners in a portfolio: when one falls the other often does not.</p>
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
