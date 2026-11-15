import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LineChart, RangeBar } from '../components/charts';
import { Page, Explain } from '../components/Page';
import { TickerSearch } from '../components/TickerSearch';
import { Card, ErrorNote, Loading, Modal, Note, Seg, Source, Stat, Stats, Tabs, Tip } from '../components/ui';
import { chartDates, getChart, getFinancials, getSummary, lastChange, type Chart, type Range } from '../lib/data/api';
import { benchmarkName, defaultBenchmark, POPULAR_GLOBAL, POPULAR_INDIA, shortSymbol } from '../lib/data/symbols';
import { compact, date as fmtDate, dateTime, money, num, pct, signedPct, times, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { rememberMeta, toggleWatch, useStore } from '../lib/store';
import { TxnForm } from './portfolio/TxnForm';
import { DividendsTab, FinancialsTab, PeersTab, RatiosTab, ReturnsTab } from './StockTabs';

type TabId = 'overview' | 'financials' | 'ratios' | 'returns' | 'dividends' | 'peers';
const RANGES: { value: string; label: string; range: Range; interval: string }[] = [
  { value: '1d', label: '1D', range: '1d', interval: '5m' },
  { value: '5d', label: '5D', range: '5d', interval: '15m' },
  { value: '1mo', label: '1M', range: '1mo', interval: '1d' },
  { value: '6mo', label: '6M', range: '6mo', interval: '1d' },
  { value: 'ytd', label: 'YTD', range: 'ytd', interval: '1d' },
  { value: '1y', label: '1Y', range: '1y', interval: '1d' },
  { value: '5y', label: '5Y', range: '5y', interval: '1d' },
  { value: 'max', label: 'All', range: 'max', interval: '1wk' },
];

function chartX(c: Chart): string[] {
  const intraday = c.interval !== '1d' && c.interval !== '1wk' && c.interval !== '1mo';
  return intraday ? c.t.map((t) => new Date((t + c.gmtoffset) * 1000).toISOString().slice(0, 16)) : chartDates(c);
}

function Landing() {
  const navigate = useNavigate();
  const watch = useStore((s) => s.watchlist);
  return (
    <Page tool="stock">
      <Card title="Find a company">
        <TickerSearch autoFocus onPick={(r) => navigate(`/stock/${encodeURIComponent(r.symbol)}`)} />
        <p className="tiny muted mt-s">Search by name or ticker. NSE tickers end in .NS and BSE tickers in .BO; US and UK stocks, ETFs, indices and currencies work too.</p>
        <div className="mt">
          <h4 className="mb-s">Popular in India</h4>
          <div className="chips">
            {POPULAR_INDIA.map((r) => (
              <Link key={r.symbol} className="chip" to={`/stock/${encodeURIComponent(r.symbol)}`}>
                {r.name}
              </Link>
            ))}
          </div>
          <h4 className="mb-s mt">Global</h4>
          <div className="chips">
            {POPULAR_GLOBAL.map((r) => (
              <Link key={r.symbol} className="chip" to={`/stock/${encodeURIComponent(r.symbol)}`}>
                {r.name}
              </Link>
            ))}
          </div>
          {watch.length > 0 && (
            <>
              <h4 className="mb-s mt">Your watchlist</h4>
              <div className="chips">
                {watch.map((s) => (
                  <Link key={s} className="chip" to={`/stock/${encodeURIComponent(s)}`}>
                    {shortSymbol(s)}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
      <Card title="What you will find on a stock's page" className="mt">
        <ol className="steps">
          <li><div><b>Overview</b>Price chart, the key numbers, and each one explained in a plain sentence.</div></li>
          <li><div><b>Financials</b>Income statement, balance sheet and cash flow for the last few years and quarters.</div></li>
          <li><div><b>Ratios and quality</b>Margins, return on equity, debt and growth worked out year by year, with a quality checklist.</div></li>
          <li><div><b>Returns and risk</b>How the share has done against its index over 1 month to 10 years, and how deep its falls have been.</div></li>
          <li><div><b>Dividends and peers</b>Payout history, and a side-by-side table against companies in the same industry.</div></li>
        </ol>
      </Card>
    </Page>
  );
}

export default function Stock() {
  const { symbol: raw } = useParams();
  if (!raw) return <Landing />;
  return <StockView key={raw} symbol={decodeURIComponent(raw).toUpperCase()} />;
}

function StockView({ symbol }: { symbol: string }) {
  const [params, setParams] = useSearchParams();
  const tab = (['overview', 'financials', 'ratios', 'returns', 'dividends', 'peers'].includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as TabId;
  const [rangeId, setRangeId] = useState('1y');
  const [versus, setVersus] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [choose, setChoose] = useState(false);
  const watching = useStore((s) => s.watchlist.includes(symbol));
  const portfolios = useStore((s) => s.portfolios);
  const navigate = useNavigate();
  const benchmark = defaultBenchmark(symbol);
  const rng = RANGES.find((r) => r.value === rangeId)!;

  const base = useAsync(() => getChart(symbol, '1y', '1d'), [symbol]);
  const chart = useAsync(() => getChart(symbol, rng.range, rng.interval), [symbol, rangeId]);
  const bench = useAsync(versus && rng.interval !== '5m' && rng.interval !== '15m' ? () => getChart(benchmark, rng.range, rng.interval) : null, [versus, benchmark, rangeId]);
  const summary = useAsync(() => getSummary(symbol), [symbol]);
  const isEquity = (base.data?.type ?? summary.data?.price?.quoteType ?? 'EQUITY') === 'EQUITY';
  const fin = useAsync(isEquity && (tab === 'financials' || tab === 'ratios') ? () => getFinancials(symbol) : null, [symbol, isEquity, tab === 'financials' || tab === 'ratios']);

  const s = summary.data;
  const c = base.data;
  useEffect(() => {
    if (c) rememberMeta(symbol, { name: c.name, currency: c.currency, type: c.type, sector: s?.profile?.sector ?? undefined, industry: s?.profile?.industry ?? undefined, marketCap: s?.price?.marketCap ?? undefined });
  }, [symbol, c, s]);

  const chg = c ? lastChange(c) : null;
  const ccy = c?.currency ?? s?.price?.currency ?? null;

  const plot = useMemo(() => {
    const d = chart.data;
    if (!d || !d.c.length) return null;
    const x = chartX(d);
    if (versus && bench.data?.c.length) {
      const bx = chartX(bench.data);
      let k = 0;
      let last = NaN;
      const b = x.map((day) => {
        while (k < bx.length && bx[k] <= day) last = bench.data!.adj[k++];
        return last;
      });
      const b0 = b.find((v) => Number.isFinite(v));
      return { x, pct: true, series: [{ name: shortSymbol(symbol), values: d.adj.map((v) => v / d.adj[0] - 1) }, { name: benchmarkName(benchmark), values: b.map((v) => (b0 && Number.isFinite(v) ? v / b0 - 1 : null)), color: 'var(--text-3)' }] };
    }
    return { x, pct: false, series: [{ name: 'Price', values: d.c }] };
  }, [chart.data, bench.data, versus, symbol, benchmark]);
  const periodReturn = chart.data && chart.data.c.length > 1 ? chart.data.adj[chart.data.adj.length - 1] / chart.data.adj[0] - 1 : null;

  if (base.error && !c) {
    return (
      <Page title={symbol} crumb="Stock research">
        <ErrorNote error={base.error.includes('delisted') || base.error.includes('No data') ? `No data found for “${symbol}”. Check the ticker: NSE symbols end in .NS (for example INFY.NS), BSE symbols in .BO.` : base.error} retry={base.reload} />
        <div className="mt" style={{ maxWidth: 480 }}>
          <TickerSearch onPick={(r) => navigate(`/stock/${encodeURIComponent(r.symbol)}`)} />
        </div>
      </Page>
    );
  }

  const d = s?.detail ?? {};
  const st = s?.stats ?? {};
  const f = s?.fin ?? {};
  const mcap: number | null = s?.price?.marketCap ?? d.marketCap ?? (st.sharesOutstanding && chg?.price ? st.sharesOutstanding * chg.price : null);
  const pe: number | undefined = d.trailingPE;
  const financial = s?.profile?.sector === 'Financial Services';

  const tabs: { value: TabId; label: string }[] = isEquity
    ? [
        { value: 'overview', label: 'Overview' },
        { value: 'financials', label: 'Financials' },
        { value: 'ratios', label: 'Ratios & quality' },
        { value: 'returns', label: 'Returns & risk' },
        { value: 'dividends', label: 'Dividends' },
        { value: 'peers', label: 'Peers' },
      ]
    : [
        { value: 'overview', label: 'Overview' },
        { value: 'returns', label: 'Returns & risk' },
      ];

  const sentences: string[] = [];
  if (isEquity && s) {
    if (pe && pe > 0) sentences.push(`Investors are paying ${num(pe, 1)} rupees for every rupee of the company's yearly profit (the P/E ratio). ${pe > 40 ? 'That is a high price, which only makes sense if profits grow fast.' : pe < 12 ? 'That is a low price: either a bargain, or the market expects profits to fall.' : ''}`);
    else if (st.trailingEps < 0) sentences.push('The company made a loss over the last twelve months, so a P/E ratio does not apply.');
    if (typeof f.returnOnEquity === 'number') sentences.push(`It earned ${num(f.returnOnEquity * 100, 1)} for every 100 of shareholders' money last year (return on equity). ${f.returnOnEquity > 0.2 ? 'Above 20% is the mark of a strong business.' : f.returnOnEquity < 0.1 ? 'Below 10% is weak: a bank deposit earns not much less, with no risk.' : ''}`);
    if (!financial && typeof f.debtToEquity === 'number') sentences.push(`For every 100 of shareholders' funds it carries ${num(f.debtToEquity, 0)} of debt. ${f.debtToEquity > 150 ? 'That is heavy borrowing, which magnifies both good and bad years.' : f.debtToEquity < 30 ? 'That is very little debt.' : ''}`);
    if (financial) sentences.push('This is a financial company: borrowing money is its raw material, so debt ratios, current ratio and EBITDA are not meaningful here. Look at return on equity, price-to-book and growth instead.');
    if (typeof d.dividendYield === 'number' && d.dividendYield > 0) sentences.push(`Its dividends pay about ${num(d.dividendYield * 100, 2)} a year for every 100 invested at today's price (dividend yield).`);
    if (typeof f.revenueGrowth === 'number') sentences.push(`Sales ${f.revenueGrowth >= 0 ? 'grew' : 'fell'} ${num(Math.abs(f.revenueGrowth) * 100, 1)}% compared with the same quarter a year ago.`);
  }
  if (c?.high52 && c.low52 && chg?.price) {
    const pos = (chg.price - c.low52) / (c.high52 - c.low52 || 1);
    sentences.push(`The price is ${pct(1 - chg.price / c.high52, 0)} below its highest point of the past year${pos < 0.15 ? ', close to its one-year low' : pos > 0.85 ? ', close to its one-year high' : ''}.`);
  }

  return (
    <Page
      title={c?.name ?? s?.price?.longName ?? symbol}
      crumb="Stock research"
      lede={
        <>
          <span className="strong">{symbol}</span> · {c?.exchange ?? '—'}
          {s?.profile?.sector ? ` · ${s.profile.sector}` : ''}
          {s?.profile?.industry ? ` · ${s.profile.industry}` : ''}
          {!isEquity && c?.type ? ` · ${c.type.toLowerCase()}` : ''}
        </>
      }
      actions={
        <>
          <button className={'btn sm' + (watching ? ' on' : '')} onClick={() => toggleWatch(symbol)} aria-pressed={watching}>
            {watching ? '✓ Watching' : 'Watch'}
          </button>
          {(c?.type === 'EQUITY' || c?.type === 'ETF' || c?.type === 'MUTUALFUND') && (
            <button className="btn sm primary" onClick={() => (portfolios.length === 1 ? setAdding(portfolios[0].id) : setChoose(true))}>
              Add to portfolio
            </button>
          )}
          <Link className="btn sm" to={`/compare?symbols=${encodeURIComponent(symbol)},${encodeURIComponent(benchmark)}`}>
            Compare
          </Link>
          {isEquity && !financial && (
            <Link className="btn sm" to={`/valuation/dcf?symbol=${encodeURIComponent(symbol)}`}>
              Value it (DCF)
            </Link>
          )}
        </>
      }
    >
      <div className="row mb" style={{ alignItems: 'baseline', gap: 12 }}>
        {base.loading && !c ? (
          <Loading label="Loading price…" />
        ) : (
          <>
            <span className="num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.01em' }}>{chg?.price != null ? money(chg.price, ccy, 2) : '—'}</span>
            <span className={'num strong ' + tone(chg?.change)} style={{ fontSize: 16 }}>
              {chg?.change != null ? `${chg.change > 0 ? '+' : ''}${num(chg.change, 2)} (${signedPct(chg.changePct, 2)})` : ''}
            </span>
            <span className="tiny muted">
              {c?.marketTime ? `as of ${dateTime(c.marketTime * 1000)}` : ''} · {ccy ?? ''}
              {s?.price?.exchangeDataDelayedBy ? ` · delayed ${s.price.exchangeDataDelayedBy} min` : ''}
            </span>
          </>
        )}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} />

      {tab === 'overview' && (
        <div className="stack">
          <Card
            title={versus ? 'Return compared with the index' : 'Price'}
            sub={periodReturn !== null ? `${signedPct(periodReturn)} over this period${rng.interval === '1d' || rng.interval === '1wk' ? ' incl. dividends' : ''}` : undefined}
            right={
              <>
                {rng.interval !== '5m' && rng.interval !== '15m' && (
                  <button className={'btn sm' + (versus ? ' on' : '')} onClick={() => setVersus((v) => !v)} aria-pressed={versus}>
                    vs {benchmarkName(benchmark)}
                  </button>
                )}
                <Seg options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={rangeId} onChange={setRangeId} label="Chart period" />
              </>
            }
          >
            {chart.loading && !chart.data ? <Loading height={300} /> : chart.error ? <ErrorNote error={chart.error} retry={chart.reload} /> : plot ? (
              <LineChart x={plot.x} series={plot.series} area={!plot.pct} zeroLine={plot.pct} yFormat={plot.pct ? (v) => pct(v, 0) : (v) => num(v, v < 10 ? 2 : v < 1000 ? 1 : 0)} height={300} hideLegend={!plot.pct} />
            ) : (
              <p className="muted">No price data for this period.</p>
            )}
          </Card>

          {summary.error && !s && <Note kind="warn">Company details could not be loaded ({summary.error}). Prices and returns still work.</Note>}
          <Stats>
            {isEquity && <Stat label="Market value" tip="Market capitalisation: the price of one share multiplied by all shares in existence. It is what the whole company costs at today's price." value={mcap ? compact(mcap, ccy) : '—'} />}
            {isEquity && <Stat label="P/E ratio" tip="Price ÷ earnings per share over the last 12 months. How many years of current profit you pay for the share. Compare with the company's own history and its peers, not across industries." value={pe ? num(pe, 1) : '—'} sub={d.forwardPE ? `${num(d.forwardPE, 1)} on next year's forecast profit` : undefined} />}
            {isEquity && <Stat label="Price to book" tip="Price ÷ net assets per share. Most useful for banks and asset-heavy businesses." value={st.priceToBook ? times(st.priceToBook, 1) : '—'} />}
            {isEquity && <Stat label="Return on equity" tip="Net profit ÷ shareholders' equity. How efficiently the company turns owners' money into profit." value={typeof f.returnOnEquity === 'number' ? pct(f.returnOnEquity) : '—'} />}
            {isEquity && <Stat label="Dividend yield" tip="Yearly dividend ÷ share price." value={typeof d.dividendYield === 'number' ? pct(d.dividendYield, 2) : '—'} sub={d.dividendRate ? `${money(d.dividendRate, ccy, 2)} a share` : undefined} />}
            <Stat
              label="52-week range"
              value={c?.low52 && c?.high52 ? `${num(c.low52, c.low52 < 100 ? 2 : 0)} – ${num(c.high52, c.high52 < 100 ? 2 : 0)}` : '—'}
              sub={c?.low52 && c?.high52 && chg?.price ? <RangeBar low={c.low52} high={c.high52} value={chg.price} /> : undefined}
            />
            {!isEquity && <Stat label="Day range" value={c?.dayLow && c?.dayHigh ? `${num(c.dayLow, 2)} – ${num(c.dayHigh, 2)}` : '—'} />}
            {!isEquity && <Stat label="Return over 1 year" value={c && c.adj.length > 1 ? signedPct(c.adj[c.adj.length - 1] / c.adj[0] - 1) : '—'} tone={c && c.adj.length > 1 ? tone(c.adj[c.adj.length - 1] / c.adj[0] - 1) : ''} />}
          </Stats>

          {sentences.length > 0 && (
            <Card title="In plain words">
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
                {sentences.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="tiny muted mt-s">These sentences restate the numbers; they are not a recommendation to buy or sell.</p>
            </Card>
          )}

          {isEquity && s && (
            <div className="grid cols-3">
              <Card title="Valuation">
                <dl className="kv">
                  <Row k="P/E (last 12 months)" v={pe ? num(pe, 1) : '—'} />
                  <Row k="P/E (forecast)" v={d.forwardPE ? num(d.forwardPE, 1) : '—'} tip="Uses analysts' profit forecasts, which are often too optimistic." />
                  <Row k="PEG ratio" v={st.pegRatio ? num(st.pegRatio, 2) : '—'} tip="P/E ÷ expected profit growth. Around 1 suggests the price is in line with growth." />
                  <Row k="Price to book" v={st.priceToBook ? times(st.priceToBook, 2) : '—'} />
                  <Row k="Price to sales" v={d.priceToSalesTrailing12Months ? times(d.priceToSalesTrailing12Months, 2) : '—'} />
                  <Row k="EV / EBITDA" v={st.enterpriseToEbitda ? times(st.enterpriseToEbitda, 1) : '—'} tip="Enterprise value (market value + debt − cash) ÷ operating profit before depreciation. Lets you compare companies with different amounts of debt." />
                  <Row k="Earnings per share" v={st.trailingEps != null ? money(st.trailingEps, s.fin.financialCurrency ?? ccy, 2) : '—'} />
                  <Row k="Book value per share" v={st.bookValue != null ? money(st.bookValue, s.fin.financialCurrency ?? ccy, 2) : '—'} />
                </dl>
              </Card>
              <Card title="Profitability and growth">
                <dl className="kv">
                  <Row k="Return on equity" v={pct(f.returnOnEquity)} />
                  <Row k="Return on assets" v={pct(f.returnOnAssets)} />
                  <Row k="Operating margin" v={pct(f.operatingMargins)} tip="Operating profit ÷ sales: what is left from each rupee of sales after running costs." />
                  <Row k="Net profit margin" v={pct(f.profitMargins)} />
                  <Row k="Sales growth (yearly)" v={signedPct(f.revenueGrowth)} tone={tone(f.revenueGrowth)} tip="Latest quarter against the same quarter a year earlier." />
                  <Row k="Profit growth (yearly)" v={signedPct(f.earningsGrowth)} tone={tone(f.earningsGrowth)} />
                  <Row k="Sales (12 months)" v={compact(f.totalRevenue, f.financialCurrency ?? ccy)} />
                  <Row k="Free cash flow" v={compact(f.freeCashflow, f.financialCurrency ?? ccy)} tip="Cash generated after investment in the business: what could be paid out to owners." />
                </dl>
              </Card>
              <Card title="Balance sheet and ownership">
                <dl className="kv">
                  <Row k="Debt to equity" v={financial ? 'n/a (lender)' : typeof f.debtToEquity === 'number' ? times(f.debtToEquity / 100, 2) : '—'} />
                  <Row k="Current ratio" v={financial ? 'n/a (lender)' : f.currentRatio ? times(f.currentRatio, 2) : '—'} tip="Short-term assets ÷ short-term liabilities. Above 1 means bills due within a year are covered." />
                  <Row k="Total debt" v={compact(f.totalDebt, f.financialCurrency ?? ccy)} />
                  <Row k="Cash" v={compact(f.totalCash, f.financialCurrency ?? ccy)} />
                  <Row k="Beta" v={d.beta != null ? num(d.beta, 2) : '—'} tip="Sensitivity to the market, as reported by the data provider. See Returns & risk for a beta against the Indian index." />
                  <Row k="Held by promoters / insiders" v={pct(st.heldPercentInsiders)} />
                  <Row k="Held by institutions" v={pct(st.heldPercentInstitutions)} />
                  <Row k="Payout ratio" v={pct(d.payoutRatio)} tip="Share of profit paid out as dividends." />
                </dl>
              </Card>
            </div>
          )}
          {s?.fin?.financialCurrency && ccy && s.fin.financialCurrency !== ccy && (
            <Note kind="warn">
              This company reports its accounts in {s.fin.financialCurrency} but its shares trade in {ccy}. Per-share accounting figures (earnings and book value per share) are in {s.fin.financialCurrency}; ratios are as calculated by the data provider.
            </Note>
          )}
          {s?.profile?.longBusinessSummary && (
            <Card title="What the company does">
              <p style={{ maxWidth: 900 }}>{s.profile.longBusinessSummary}</p>
              <p className="small muted">
                {[s.profile.city, s.profile.country].filter(Boolean).join(', ')}
                {s.profile.fullTimeEmployees ? ` · ${num(s.profile.fullTimeEmployees, 0)} employees` : ''}
                {s.profile.website ? (
                  <>
                    {' · '}
                    <a href={s.profile.website} target="_blank" rel="noreferrer noopener">
                      {String(s.profile.website).replace(/^https?:\/\//, '')}
                    </a>
                  </>
                ) : null}
                {s.nextEarnings ? ` · next results expected around ${fmtDate(new Date(s.nextEarnings * 1000).toISOString().slice(0, 10))}` : ''}
              </p>
            </Card>
          )}
        </div>
      )}
      {tab === 'financials' && <FinancialsTab fin={fin} financial={financial} />}
      {tab === 'ratios' && <RatiosTab fin={fin} summary={s} financial={financial} />}
      {tab === 'returns' && <ReturnsTab symbol={symbol} benchmark={benchmark} />}
      {tab === 'dividends' && <DividendsTab symbol={symbol} summary={s} currency={ccy} />}
      {tab === 'peers' && <PeersTab symbol={symbol} summary={s} />}

      <div className="mt">
        <Source at={summary.data?.fetchedAt ?? base.data?.fetchedAt} />
      </div>
      <Explain id={`stock-${tab}`} />

      {choose && (
        <Modal title="Add to which portfolio?" onClose={() => setChoose(false)}>
          {portfolios.length === 0 ? (
            <>
              <p>You have no portfolios yet.</p>
              <Link className="btn primary" to="/portfolio">
                Create a portfolio
              </Link>
            </>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {portfolios.map((p) => (
                <button key={p.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => { setChoose(false); setAdding(p.id); }}>
                  {p.name} <span className="muted">· {p.currency}</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
      {adding && portfolios.find((p) => p.id === adding) && <TxnForm portfolio={portfolios.find((p) => p.id === adding)!} symbol={symbol} type="buy" onClose={() => setAdding(null)} />}
    </Page>
  );
}

function Row({ k, v, tip, tone: t }: { k: string; v: React.ReactNode; tip?: string; tone?: string }) {
  return (
    <>
      <dt>
        {k}
        {tip && <Tip text={tip} />}
      </dt>
      <dd className={t}>{v}</dd>
    </>
  );
}
