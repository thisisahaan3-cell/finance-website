import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, Loading, Note, Seg, Source, Tip } from '../components/ui';
import { getFundamentals, screen, type Fundamentals, type ScreenSpec } from '../lib/data/api';
import { shortSymbol } from '../lib/data/symbols';
import { download, toCsv } from '../lib/csv';
import { compact, num, pct, signedPct, times, tone } from '../lib/format';
import { useAsync, useDebounced } from '../lib/hooks';
import { toggleWatch, useSaved, useStore } from '../lib/store';

type Market = ScreenSpec['market'];
type Unit = 'cap' | 'pct' | 'x' | 'de' | 'num' | 'price';

interface FilterDef {
  field: string;
  label: string;
  group: string;
  unit: Unit;
  tip: string;
}

const FILTERS: FilterDef[] = [
  { field: 'marketCap', label: 'Market value', group: 'Size', unit: 'cap', tip: 'Total market value of the company. In India: large caps are roughly above ₹1,00,000 Cr, mid caps ₹30,000–1,00,000 Cr, small caps below that.' },
  { field: 'avgVolume', label: 'Average daily volume (shares)', group: 'Size', unit: 'num', tip: 'Shares traded per day on average over three months. Low volume makes a stock hard to buy and sell at a fair price.' },
  { field: 'pe', label: 'P/E ratio', group: 'Valuation', unit: 'x', tip: 'Price ÷ earnings per share. Set a minimum of 0 to leave out loss-making companies.' },
  { field: 'pb', label: 'Price to book', group: 'Valuation', unit: 'x', tip: 'Price ÷ net assets per share.' },
  { field: 'peg', label: 'PEG ratio', group: 'Valuation', unit: 'x', tip: 'P/E ÷ expected growth. Around 1 or below suggests growth at a reasonable price.' },
  { field: 'evEbitda', label: 'EV / EBITDA', group: 'Valuation', unit: 'x', tip: 'Enterprise value ÷ operating profit before depreciation. Fairer than P/E when comparing companies with different debt.' },
  { field: 'ps', label: 'Price to sales', group: 'Valuation', unit: 'x', tip: 'Market value ÷ yearly revenue.' },
  { field: 'roe', label: 'Return on equity', group: 'Profitability', unit: 'pct', tip: "Net profit ÷ shareholders' equity. Above 15% is a common mark of a good business." },
  { field: 'roce', label: 'Return on capital', group: 'Profitability', unit: 'pct', tip: 'Profit earned on all capital used, borrowed or owned.' },
  { field: 'roa', label: 'Return on assets', group: 'Profitability', unit: 'pct', tip: 'Net profit ÷ total assets.' },
  { field: 'netMargin', label: 'Net profit margin', group: 'Profitability', unit: 'pct', tip: 'Net profit ÷ revenue.' },
  { field: 'ebitdaMargin', label: 'EBITDA margin', group: 'Profitability', unit: 'pct', tip: 'Operating profit before depreciation ÷ revenue.' },
  { field: 'revenueGrowth', label: 'Revenue growth (1 year)', group: 'Growth', unit: 'pct', tip: 'Change in sales over the last twelve months.' },
  { field: 'profitGrowth', label: 'Net profit growth (1 year)', group: 'Growth', unit: 'pct', tip: 'Change in net profit over the last twelve months.' },
  { field: 'epsGrowth', label: 'EPS growth (1 year)', group: 'Growth', unit: 'pct', tip: 'Change in earnings per share over the last twelve months.' },
  { field: 'quarterlyRevenueGrowth', label: 'Revenue growth (latest quarter)', group: 'Growth', unit: 'pct', tip: 'Latest quarter against the same quarter a year earlier.' },
  { field: 'debtToEquity', label: 'Debt to equity', group: 'Financial health', unit: 'de', tip: "Total debt ÷ shareholders' equity. Not meaningful for banks and lenders." },
  { field: 'currentRatio', label: 'Current ratio', group: 'Financial health', unit: 'x', tip: 'Current assets ÷ current liabilities.' },
  { field: 'interestCover', label: 'Interest cover', group: 'Financial health', unit: 'x', tip: 'Operating profit ÷ interest expense.' },
  { field: 'dividendYield', label: 'Dividend yield', group: 'Dividends & ownership', unit: 'pct', tip: 'Expected yearly dividend ÷ price.' },
  { field: 'promoterHolding', label: 'Promoter / insider holding', group: 'Dividends & ownership', unit: 'pct', tip: 'Share of the company held by promoters and insiders.' },
  { field: 'institutionalHolding', label: 'Institutional holding', group: 'Dividends & ownership', unit: 'pct', tip: 'Share held by funds and other institutions.' },
  { field: 'change52w', label: 'Price change, 1 year', group: 'Price', unit: 'pct', tip: 'Share price change over the past 52 weeks.' },
  { field: 'change', label: 'Price change, today', group: 'Price', unit: 'pct', tip: "Today's price change." },
  { field: 'price', label: 'Share price', group: 'Price', unit: 'price', tip: 'Latest share price. A low price does not mean a cheap company.' },
  { field: 'beta', label: 'Beta', group: 'Price', unit: 'num', tip: 'Sensitivity to the overall market. Below 1 is calmer than the market.' },
];
const DEF = Object.fromEntries(FILTERS.map((f) => [f.field, f]));

const SECTORS = ['Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Consumer Defensive', 'Industrials', 'Energy', 'Basic Materials', 'Communication Services', 'Utilities', 'Real Estate'];

interface Row {
  field: string;
  min: number | null;
  max: number | null;
}

interface State {
  market: Market;
  sectors: string[];
  filters: Row[];
  sort: string;
  dir: 'asc' | 'desc';
}

const CAP_UNIT: Record<Market, { mult: number; label: string }> = { NSE: { mult: 1e7, label: '₹ Cr' }, BSE: { mult: 1e7, label: '₹ Cr' }, US: { mult: 1e9, label: '$ bn' }, UK: { mult: 1e9, label: '£ bn' } };

const PRESETS: { name: string; blurb: string; filters: Row[]; sort: string }[] = [
  { name: 'Quality', blurb: 'Profitable, efficient, lightly indebted', sort: 'marketCap', filters: [{ field: 'roe', min: 18, max: null }, { field: 'debtToEquity', min: null, max: 0.5 }, { field: 'netMargin', min: 10, max: null }, { field: 'marketCap', min: 5000, max: null }] },
  { name: 'Value', blurb: 'Modest price for decent profitability', sort: 'pe', filters: [{ field: 'pe', min: 0, max: 15 }, { field: 'pb', min: null, max: 3 }, { field: 'roe', min: 12, max: null }, { field: 'marketCap', min: 5000, max: null }] },
  { name: 'Growth', blurb: 'Sales and profit rising fast', sort: 'revenueGrowth', filters: [{ field: 'revenueGrowth', min: 20, max: null }, { field: 'profitGrowth', min: 20, max: null }, { field: 'roe', min: 12, max: null }, { field: 'marketCap', min: 2000, max: null }] },
  { name: 'Dividend income', blurb: 'Meaningful yield from sturdy companies', sort: 'dividendYield', filters: [{ field: 'dividendYield', min: 3, max: null }, { field: 'debtToEquity', min: null, max: 1 }, { field: 'marketCap', min: 10000, max: null }] },
  { name: 'Growth at a fair price', blurb: 'Growing, but not at any price', sort: 'marketCap', filters: [{ field: 'peg', min: 0, max: 1.2 }, { field: 'epsGrowth', min: 12, max: null }, { field: 'roe', min: 15, max: null }] },
  { name: 'Large and steady', blurb: 'Big companies that swing less than the market', sort: 'marketCap', filters: [{ field: 'marketCap', min: 100000, max: null }, { field: 'beta', min: null, max: 0.9 }] },
];

const DEFAULT: State = { market: 'NSE', sectors: [], filters: PRESETS[0].filters, sort: 'marketCap', dir: 'desc' };
const PAGE = 50;

function toSpec(s: State, offset: number): ScreenSpec {
  const cap = CAP_UNIT[s.market].mult;
  const conv = (f: Row) => {
    const unit = DEF[f.field]?.unit;
    const k = unit === 'cap' ? cap : unit === 'de' ? 100 : 1;
    return { field: f.field, min: f.min === null ? null : f.min * k, max: f.max === null ? null : f.max * k };
  };
  return { market: s.market, sectors: s.sectors, filters: s.filters.filter((f) => f.min !== null || f.max !== null).map(conv), sort: s.sort, dir: s.dir, offset, size: PAGE };
}

function unitLabel(unit: Unit, market: Market): string {
  return unit === 'cap' ? CAP_UNIT[market].label : unit === 'pct' ? '%' : unit === 'x' || unit === 'de' ? '×' : '';
}

export default function Screener() {
  const [state, set, reset] = useSaved<State>('screener', DEFAULT);
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState('');
  const watch = useStore((s) => s.watchlist);
  const applied = useDebounced(JSON.stringify(state), 600);
  useEffect(() => setOffset(0), [applied]);
  const spec = useMemo(() => toSpec(JSON.parse(applied) as State, offset), [applied, offset]);
  const res = useAsync(() => screen(spec), [JSON.stringify(spec)]);
  const quotes = useMemo(() => (res.data?.quotes ?? []).filter((q) => state.market !== 'UK' || q.currency === 'GBP'), [res.data, state.market]);
  const symbols = quotes.map((q) => q.symbol);
  const deep = useAsync(symbols.length ? () => getFundamentals(symbols) : null, [symbols.join(',')]);
  const f = (s: string): Fundamentals | undefined => deep.data?.[s];

  const setFilter = (i: number, patch: Partial<Row>) => set({ filters: state.filters.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const groups = [...new Set(FILTERS.map((x) => x.group))];
  const unused = FILTERS.filter((x) => !state.filters.some((y) => y.field === x.field));
  const capUnit = CAP_UNIT[state.market];

  const exportCsv = () => {
    download(
      'screen_results.csv',
      toCsv(
        ['symbol', 'name', 'sector', 'industry', 'price', 'currency', 'market_cap', 'pe', 'pb', 'dividend_yield_pct', 'roe_pct', 'net_margin_pct', 'revenue_growth_pct', 'debt_to_equity', 'change_52w_pct'],
        quotes.map((q) => {
          const d = f(q.symbol);
          return [q.symbol, q.longName ?? q.shortName ?? '', d?.sector ?? '', d?.industry ?? '', q.regularMarketPrice ?? '', q.currency ?? '', q.marketCap ?? '', q.trailingPE ?? '', q.priceToBook ?? '', q.dividendYield ?? '', d?.roe != null ? d.roe * 100 : '', d?.profitMargin != null ? d.profitMargin * 100 : '', d?.revenueGrowth != null ? d.revenueGrowth * 100 : '', d?.debtToEquity ?? '', q.fiftyTwoWeekChangePercent ?? ''];
        }),
      ),
    );
  };

  const sortBy = (field: string) => set(state.sort === field ? { dir: state.dir === 'asc' ? 'desc' : 'asc' } : { sort: field, dir: 'desc' });
  const mark = (field: string) => (state.sort === field ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sth = (field: string, label: string) => (
    <th className="r sortable" onClick={() => sortBy(field)}>
      {label}
      {mark(field)}
    </th>
  );

  return (
    <Page tool="screener" actions={<button className="btn sm" onClick={reset}>Reset</button>}>
      <div className="split wide">
        <div className="stack">
          <Card title="Start from an idea">
            <div className="stack" style={{ gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.name} className="btn" style={{ justifyContent: 'space-between', height: 'auto', padding: '7px 10px', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => set({ filters: p.filters.filter((x) => state.market === 'NSE' || state.market === 'BSE' || x.field !== 'marketCap'), sort: p.sort, dir: p.sort === 'pe' ? 'asc' : 'desc' })}>
                  <span className="strong">{p.name}</span>
                  <span className="small muted">{p.blurb}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Filters" sub="all must be true">
            <div className="form">
              <div className="field">
                <span className="label">Market</span>
                <Seg options={[{ value: 'NSE', label: 'NSE' }, { value: 'BSE', label: 'BSE' }, { value: 'US', label: 'United States' }, { value: 'UK', label: 'United Kingdom' }]} value={state.market} onChange={(market) => set({ market })} />
              </div>
              {state.filters.map((row, i) => {
                const d = DEF[row.field];
                if (!d) return null;
                const u = unitLabel(d.unit, state.market);
                return (
                  <div className="field" key={row.field}>
                    <span className="label">
                      {d.label}
                      {u ? ` (${u})` : ''} <Tip text={d.tip} />
                    </span>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input className="input num" inputMode="decimal" placeholder="at least" aria-label={`${d.label}, minimum`} value={row.min ?? ''} onChange={(e) => setFilter(i, { min: e.target.value === '' ? null : Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : row.min })} />
                      <span className="muted small">to</span>
                      <input className="input num" inputMode="decimal" placeholder="at most" aria-label={`${d.label}, maximum`} value={row.max ?? ''} onChange={(e) => setFilter(i, { max: e.target.value === '' ? null : Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : row.max })} />
                      <button className="btn icon ghost" aria-label={`Remove the ${d.label} filter`} onClick={() => set({ filters: state.filters.filter((_, k) => k !== i) })}>
                        ×
                      </button>
                    </div>
                    {row.min !== null && row.max !== null && row.min > row.max && <span className="err">The minimum is above the maximum.</span>}
                  </div>
                );
              })}
              <div className="field">
                <label htmlFor="addfilter">Add a filter</label>
                <select
                  id="addfilter"
                  className="select"
                  value={adding}
                  onChange={(e) => {
                    if (e.target.value) set({ filters: [...state.filters, { field: e.target.value, min: null, max: null }] });
                    setAdding('');
                  }}
                >
                  <option value="">Choose a measure…</option>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {unused.filter((x) => x.group === g).map((x) => (
                        <option key={x.field} value={x.field}>
                          {x.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field">
                <span className="label">Sectors {state.sectors.length ? `(${state.sectors.length} chosen)` : '(all)'}</span>
                <div className="chips">
                  {SECTORS.map((s) => (
                    <button key={s} className={'chip' + (state.sectors.includes(s) ? ' on' : '')} aria-pressed={state.sectors.includes(s)} onClick={() => set({ sectors: state.sectors.includes(s) ? state.sectors.filter((x) => x !== s) : [...state.sectors, s] })}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="stack">
          {res.error && <ErrorNote error={res.error} retry={res.reload} />}
          <Card
            title={res.data ? `${num(res.data.total, 0)} compan${res.data.total === 1 ? 'y' : 'ies'} match` : 'Results'}
            sub={res.data && res.data.total > 0 ? `showing ${offset + 1}–${Math.min(offset + PAGE, res.data.total)}` : undefined}
            right={
              <>
                {res.loading && <span className="spinner" aria-label="Loading" />}
                <button className="btn sm" disabled={!quotes.length} onClick={exportCsv}>
                  Export CSV
                </button>
              </>
            }
            flush
          >
            {res.loading && !res.data ? (
              <Loading label="Screening…" height={200} />
            ) : quotes.length === 0 && !res.error ? (
              <Empty title="Nothing matches all of these filters">
                <p>Loosen one filter at a time to see which one is doing the excluding. Very strict screens often return nothing: no company is perfect on every measure.</p>
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Company</th>
                      {sth('price', 'Price')}
                      {sth('marketCap', `Value (${capUnit.label})`)}
                      {sth('pe', 'P/E')}
                      {sth('pb', 'P/B')}
                      {sth('roe', 'ROE')}
                      {sth('netMargin', 'Net margin')}
                      {sth('revenueGrowth', 'Sales growth')}
                      {sth('debtToEquity', 'Debt/eq.')}
                      {sth('dividendYield', 'Yield')}
                      {sth('change52w', '1-yr change')}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q) => {
                      const d = f(q.symbol);
                      const lazy = (v: React.ReactNode) => (deep.loading && !d ? <span className="muted">…</span> : v);
                      return (
                        <tr key={q.symbol}>
                          <td>
                            <Link to={`/stock/${encodeURIComponent(q.symbol)}`} className="strong">
                              {shortSymbol(q.symbol)}
                            </Link>
                            <span className="sub">
                              {q.longName ?? q.shortName}
                              {d?.sector ? ` · ${d.sector}` : ''}
                            </span>
                          </td>
                          <td className="r">{num(q.regularMarketPrice, 2)}</td>
                          <td className="r">{q.marketCap ? num(q.marketCap / capUnit.mult, state.market === 'US' || state.market === 'UK' ? 1 : 0) : '—'}</td>
                          <td className="r">{q.trailingPE ? num(q.trailingPE, 1) : '—'}</td>
                          <td className="r">{q.priceToBook ? num(q.priceToBook, 1) : '—'}</td>
                          <td className="r">{lazy(pct(d?.roe))}</td>
                          <td className="r">{lazy(pct(d?.profitMargin))}</td>
                          <td className={'r ' + tone(d?.revenueGrowth)}>{lazy(signedPct(d?.revenueGrowth))}</td>
                          <td className="r">{lazy(d?.debtToEquity != null ? times(d.debtToEquity, 2) : '—')}</td>
                          <td className="r">{q.dividendYield ? `${num(q.dividendYield, 2)}%` : '—'}</td>
                          <td className={'r ' + tone(q.fiftyTwoWeekChangePercent)}>{q.fiftyTwoWeekChangePercent != null ? signedPct(q.fiftyTwoWeekChangePercent / 100, 0) : '—'}</td>
                          <td className="r">
                            <button className={'btn sm ghost' + (watch.includes(q.symbol) ? ' on' : '')} aria-pressed={watch.includes(q.symbol)} title={watch.includes(q.symbol) ? 'Remove from watchlist' : 'Add to watchlist'} onClick={() => toggleWatch(q.symbol)}>
                              {watch.includes(q.symbol) ? '✓' : '+'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {res.data && res.data.total > PAGE && (
              <div className="row between" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
                <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  ← Previous
                </button>
                <span className="small muted">
                  Page {Math.floor(offset / PAGE) + 1} of {Math.ceil(res.data.total / PAGE)}
                </span>
                <button className="btn sm" disabled={offset + PAGE >= res.data.total} onClick={() => setOffset(offset + PAGE)}>
                  Next →
                </button>
              </div>
            )}
          </Card>
          {deep.error && <Note kind="warn">The profitability columns could not be loaded ({deep.error}). The filters themselves were still applied.</Note>}
          <Note>
            Click a column heading to sort the whole result set. A screen narrows thousands of companies to a shortlist worth reading about; it does not tell you what to buy. Numbers are trailing twelve-month figures from the data provider
            and occasionally contain errors, so check a company's own page before relying on one. {compact(1e12, 'INR', 0)} = ₹1 lakh crore.
          </Note>
          <Source at={res.data?.fetchedAt} />
        </div>
      </div>
    </Page>
  );
}
