import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart, BarList } from '../components/charts';
import { Page } from '../components/Page';
import { TickerSearch } from '../components/TickerSearch';
import { Card, CellInput, Check, KV, Note, NumberField, PercentField, Seg, Stat, Stats, Tip, toast } from '../components/ui';
import { getFinancials, getQuotes, getSummary } from '../lib/data/api';
import { fxSymbol } from '../lib/data/symbols';
import { seriesCagr } from '../lib/finance/ratios';
import { costOfEquity, dcf, dcfSensitivity, impliedGrowth, marginOfSafety, wacc as waccCalc, type DcfInput } from '../lib/finance/valuation';
import { currencySymbol, num, pct, signedPct, times, tone } from '../lib/format';
import { attempt } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

interface State extends DcfInput {
  company: string;
  symbol: string;
  /** currency of the model (the company's reporting currency) */
  currency: string;
  /** 'cr' = crore, 'mn' = million */
  unit: 'cr' | 'mn';
  marketPrice: number;
  /** price currency per 1 unit of the reporting currency */
  fxToPrice: number;
  priceCurrency: string;
  // cost of capital builder
  rf: number;
  beta: number;
  erp: number;
  costOfDebt: number;
  debtWeight: number;
  // scenario shifts
  bearGrowth: number;
  bearMargin: number;
  bearWacc: number;
  bullGrowth: number;
  bullMargin: number;
  bullWacc: number;
}

const EXAMPLE: State = {
  company: 'Example company',
  symbol: '',
  currency: 'INR',
  unit: 'cr',
  baseRevenue: 10_000,
  years: 10,
  growthStart: 0.14,
  growthEnd: 0.06,
  marginStart: 0.18,
  marginEnd: 0.2,
  taxRate: 0.25,
  daPct: 0.03,
  capexPct: 0.05,
  nwcPct: 0.1,
  wacc: 0.115,
  terminalMethod: 'growth',
  terminalGrowth: 0.05,
  exitMultiple: 14,
  midYear: true,
  netDebt: 800,
  otherClaims: 0,
  nonOperatingAssets: 0,
  sharesOutstanding: 50,
  marketPrice: 320,
  fxToPrice: 1,
  priceCurrency: 'INR',
  rf: 0.065,
  beta: 1,
  erp: 0.06,
  costOfDebt: 0.09,
  debtWeight: 0.15,
  bearGrowth: -0.04,
  bearMargin: -0.03,
  bearWacc: 0.01,
  bullGrowth: 0.03,
  bullMargin: 0.02,
  bullWacc: -0.005,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Dcf() {
  const settings = useStore((s) => s.settings);
  const [st, set, reset] = useSaved<State>('dcf', { ...EXAMPLE, rf: settings.riskFree });
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  const loadCompany = async (symbol: string) => {
    setBusy(true);
    setLoadError(null);
    setLoadNote(null);
    try {
      const [sum, fin] = await Promise.all([getSummary(symbol), getFinancials(symbol)]);
      const a = fin.annual;
      const n = a.dates.length - 1;
      const at = (key: string) => {
        for (let i = n; i >= 0; i--) if (typeof a.items[key]?.[i] === 'number') return a.items[key][i] as number;
        return null;
      };
      const currency = fin.currency ?? sum.fin.financialCurrency ?? sum.price.currency ?? 'INR';
      const priceCurrency = sum.price.currency ?? currency;
      const unit: 'cr' | 'mn' = currency === 'INR' ? 'cr' : 'mn';
      const k = unit === 'cr' ? 1e7 : 1e6;
      const revenue = fin.ttm.TotalRevenue ?? at('TotalRevenue');
      if (!revenue || revenue <= 0) throw new Error('The data provider has no revenue figure for this company, so a DCF cannot be prefilled.');
      const latestRev = at('TotalRevenue') ?? revenue;
      const opInc = at('OperatingIncome') ?? at('EBIT');
      const margin = opInc !== null && latestRev > 0 ? clamp(opInc / latestRev, 0.01, 0.6) : 0.15;
      const da = at('DepreciationAndAmortization') ?? at('ReconciledDepreciation');
      const capex = at('CapitalExpenditure');
      const debt = at('TotalDebt') ?? sum.fin.totalDebt ?? 0;
      const cash = at('CashAndCashEquivalents') ?? sum.fin.totalCash ?? 0;
      const shares = sum.stats.sharesOutstanding ?? at('OrdinarySharesNumber');
      if (!shares) throw new Error('The share count is missing for this company. Enter the figures by hand instead.');
      const g = seriesCagr(a.items.TotalRevenue ?? [], a.dates);
      const growthStart = g ? clamp(g.rate, 0.03, 0.25) : 0.1;
      let fxToPrice = 1;
      if (currency !== priceCurrency) {
        const fx = await getQuotes([fxSymbol(currency, priceCurrency)]);
        fxToPrice = fx.quotes[fxSymbol(currency, priceCurrency)]?.regularMarketPrice ?? 1;
      }
      const beta = typeof sum.detail.beta === 'number' && sum.detail.beta > 0.3 && sum.detail.beta < 2.5 ? sum.detail.beta : 1;
      const mcap = sum.price.marketCap ? sum.price.marketCap / fxToPrice : null;
      const debtWeight = mcap && debt > 0 ? clamp(debt / (debt + mcap), 0, 0.8) : 0;
      const ke = costOfEquity(st.rf, beta, st.erp);
      const w = clamp(ke * (1 - debtWeight) + st.costOfDebt * (1 - 0.25) * debtWeight, 0.06, 0.2);
      set({
        company: sum.price.longName ?? sum.price.shortName ?? symbol,
        symbol,
        currency,
        unit,
        priceCurrency,
        fxToPrice,
        baseRevenue: Number((revenue / k).toFixed(1)),
        growthStart: Number(growthStart.toFixed(3)),
        growthEnd: Number(Math.min(growthStart, 0.06).toFixed(3)),
        marginStart: Number(margin.toFixed(3)),
        marginEnd: Number(margin.toFixed(3)),
        taxRate: clamp(at('TaxRateForCalcs') ?? 0.25, 0.1, 0.4),
        daPct: da !== null && latestRev > 0 ? Number(clamp(da / latestRev, 0, 0.3).toFixed(3)) : 0.03,
        capexPct: capex !== null && latestRev > 0 ? Number(clamp(Math.abs(capex) / latestRev, 0, 0.4).toFixed(3)) : 0.05,
        netDebt: Number(((debt - cash) / k).toFixed(1)),
        otherClaims: 0,
        nonOperatingAssets: 0,
        sharesOutstanding: Number((shares / k).toFixed(3)),
        marketPrice: Number((sum.price.regularMarketPrice ?? 0).toFixed(2)),
        beta: Number(beta.toFixed(2)),
        debtWeight: Number(debtWeight.toFixed(3)),
        wacc: Number(w.toFixed(4)),
      });
      setLoadNote(
        `Filled in from ${symbol}'s latest reported figures. Growth starts at the past revenue growth rate${g ? ` (${pct(g.rate)} a year over ${num(g.years, 0)} years, capped between 3% and 25%)` : ''} and margins stay at the latest level. These are starting points, not forecasts: change them to reflect your own view.` +
          (sum.profile?.sector === 'Financial Services' ? ' Note: this is a bank or lender. A cash-flow DCF like this one does not suit financial companies, because debt is part of their operations.' : ''),
      );
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setBusy(false);
  };

  useEffect(() => {
    const s = params.get('symbol');
    if (!s) return;
    void loadCompany(s.toUpperCase());
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useMemo(() => attempt(() => dcf(st)), [st]);
  const r = result.value;
  const sym = currencySymbol(st.currency).trim();
  const unitName = st.unit === 'cr' ? 'crore' : 'million';
  const perShareInPrice = r ? r.valuePerShare * st.fxToPrice : null;
  const upside = perShareInPrice !== null && st.marketPrice > 0 ? perShareInPrice / st.marketPrice - 1 : null;
  const mos = perShareInPrice !== null ? marginOfSafety(perShareInPrice, st.marketPrice) : null;
  const priceSym = currencySymbol(st.priceCurrency).trim();

  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => st.wacc + d);
  const seconds = st.terminalMethod === 'growth' ? [-0.01, -0.005, 0, 0.005, 0.01].map((d) => st.terminalGrowth + d) : [-4, -2, 0, 2, 4].map((d) => st.exitMultiple + d);
  const grid = useMemo(() => dcfSensitivity(st, waccs, seconds), [st]);
  const implied = useMemo(() => (st.marketPrice > 0 ? impliedGrowth(st, st.marketPrice / st.fxToPrice) : null), [st]);

  const scenario = (dg: number, dm: number, dw: number) =>
    attempt(() => dcf({ ...st, growthStart: st.growthStart + dg, growthEnd: st.growthEnd + dg / 2, marginStart: st.marginStart + dm, marginEnd: st.marginEnd + dm, wacc: st.wacc + dw })).value;
  const bear = scenario(st.bearGrowth, st.bearMargin, st.bearWacc);
  const bull = scenario(st.bullGrowth, st.bullMargin, st.bullWacc);

  const ke = costOfEquity(st.rf, st.beta, st.erp);
  const built = attempt(() => waccCalc({ equityValue: 1 - st.debtWeight, debtValue: st.debtWeight, costOfEquity: ke, costOfDebt: st.costOfDebt, taxRate: st.taxRate })).value;
  const money0 = (v: number) => `${sym}${num(v, 0, st.currency)}`;

  return (
    <Page
      tool="dcf"
      actions={
        <button className="btn sm" onClick={() => { reset(); setLoadNote(null); setLoadError(null); }}>
          Reset to example
        </button>
      }
    >
      <Card title="Start from a real company" sub="optional" className="mb">
        <div className="row top">
          <div className="grow" style={{ maxWidth: 480 }}>
            <TickerSearch types={['EQUITY']} placeholder="Search a company to prefill its numbers…" onPick={(x) => void loadCompany(x.symbol)} />
          </div>
          <span className="small muted">{busy ? 'Loading financials…' : <>Now valuing: <b>{st.company}</b>{st.symbol ? <> · <Link to={`/stock/${encodeURIComponent(st.symbol)}`}>{st.symbol}</Link></> : ''}. Amounts in {sym} {unitName}.</>}</span>
        </div>
        {loadError && <Note kind="err" className="mt-s">{loadError}</Note>}
        {loadNote && <Note className="mt-s">{loadNote}</Note>}
      </Card>

      <div className="split wide">
        <div className="stack">
          <Card title="1. The business" sub="how fast it grows and how profitable it is">
            <div className="form two">
              <NumberField label={`Revenue, last 12 months (${sym} ${st.unit})`} value={st.baseRevenue} onChange={(baseRevenue) => set({ baseRevenue })} min={0} grouping={st.currency === 'INR' ? 'IN' : 'US'} />
              <NumberField label="Years forecast in detail" suffix="yrs" value={st.years} onChange={(years) => set({ years })} min={1} max={30} decimals={0} tip="After this the company is assumed to settle into steady, slow growth forever (the terminal value). 5–10 years is typical." />
              <PercentField label="Revenue growth, year 1" value={st.growthStart} onChange={(growthStart) => set({ growthStart })} min={-0.5} max={1} />
              <PercentField label="Revenue growth, final year" value={st.growthEnd} onChange={(growthEnd) => set({ growthEnd })} min={-0.5} max={1} tip="Growth fades in a straight line from the first-year rate to this rate. No company grows fast forever." />
              <PercentField label="Operating margin, year 1" value={st.marginStart} onChange={(marginStart) => set({ marginStart })} min={-0.5} max={0.9} tip="Operating profit (EBIT) as a share of revenue." />
              <PercentField label="Operating margin, final year" value={st.marginEnd} onChange={(marginEnd) => set({ marginEnd })} min={-0.5} max={0.9} />
            </div>
          </Card>
          <Card title="2. Turning profit into cash" sub="tax and reinvestment">
            <div className="form two">
              <PercentField label="Tax rate" value={st.taxRate} onChange={(taxRate) => set({ taxRate })} min={0} max={0.6} tip="Indian companies pay about 25% (22% base rate plus surcharge and cess under the concessional regime)." />
              <PercentField label="Depreciation, % of revenue" value={st.daPct} onChange={(daPct) => set({ daPct })} min={0} max={0.5} tip="A non-cash charge, so it is added back to profit." />
              <PercentField label="Capital spending, % of revenue" value={st.capexPct} onChange={(capexPct) => set({ capexPct })} min={0} max={0.6} tip="Cash spent on plant, equipment and software to keep the business growing." />
              <PercentField label="Working capital per ₹1 of new sales" value={st.nwcPct} onChange={(nwcPct) => set({ nwcPct })} min={-0.5} max={1} tip="Growing sales tie up cash in stock and unpaid customer bills. 10% means every extra ₹100 of sales needs ₹10 of working capital." />
            </div>
          </Card>
          <Card title="3. Discount rate and terminal value" sub="the two assumptions that move the answer most">
            <div className="form">
              <PercentField label="Discount rate (WACC)" value={st.wacc} onChange={(wacc) => set({ wacc })} min={0.01} max={0.5} tip="The yearly return investors need for taking this risk. Future cash is worth less than cash today; this rate says how much less. For Indian companies 10–13% is a common range." />
              <details>
                <summary className="link-btn" style={{ cursor: 'pointer' }}>Build the discount rate step by step</summary>
                <div className="form two mt-s">
                  <PercentField label="Risk-free rate" value={st.rf} onChange={(rf) => set({ rf })} min={0} max={0.2} tip="Yield on a 10-year government bond." />
                  <NumberField label="Beta" value={st.beta} onChange={(beta) => set({ beta })} min={0} max={4} tip="How much more or less the share swings than the market. 1 = the same." />
                  <PercentField label="Equity risk premium" value={st.erp} onChange={(erp) => set({ erp })} min={0} max={0.2} tip="Extra return investors demand from shares over government bonds." />
                  <PercentField label="Cost of debt (before tax)" value={st.costOfDebt} onChange={(costOfDebt) => set({ costOfDebt })} min={0} max={0.3} />
                  <PercentField label="Debt as a share of capital" value={st.debtWeight} onChange={(debtWeight) => set({ debtWeight })} min={0} max={0.95} tip="Debt ÷ (debt + market value of equity)." />
                </div>
                <div className="formula mt-s" style={{ whiteSpace: 'pre-wrap' }}>
                  {`Cost of equity = ${pct(st.rf)} + ${num(st.beta, 2)} × ${pct(st.erp)} = ${pct(ke)}\nWACC = ${pct(1 - st.debtWeight, 0)} × ${pct(ke)} + ${pct(st.debtWeight, 0)} × ${pct(st.costOfDebt)} × (1 − ${pct(st.taxRate, 0)}) = ${built ? pct(built.wacc, 2) : '—'}`}
                </div>
                {built && (
                  <button className="btn sm mt-s" onClick={() => { set({ wacc: Number(built.wacc.toFixed(4)) }); toast('Discount rate updated'); }}>
                    Use {pct(built.wacc, 2)} as the discount rate
                  </button>
                )}
              </details>
              <div className="field">
                <span className="label">Value after the forecast years <Tip text="Most of a company's value usually lies beyond the forecast. You can assume cash flows grow slowly forever, or that the business is sold at a multiple of its profit." /></span>
                <Seg options={[{ value: 'growth', label: 'Grows forever at a steady rate' }, { value: 'multiple', label: 'Sold at a multiple' }]} value={st.terminalMethod} onChange={(terminalMethod) => set({ terminalMethod })} />
              </div>
              {st.terminalMethod === 'growth' ? (
                <PercentField label="Growth forever (terminal growth)" value={st.terminalGrowth} onChange={(terminalGrowth) => set({ terminalGrowth })} min={-0.05} max={0.15} tip="Should not exceed the long-run growth of the economy. For India, 4–6% in rupee terms is defensible; anything above the discount rate is impossible." />
              ) : (
                <NumberField label="Exit multiple (EV / EBITDA)" suffix="×" value={st.exitMultiple} onChange={(exitMultiple) => set({ exitMultiple })} min={0.5} max={100} decimals={1} />
              )}
              <Check label="Cash arrives through the year, not all at year-end" checked={st.midYear} onChange={(midYear) => set({ midYear })} tip="The mid-year convention: discounts each year's cash flow by half a year less. More realistic, and raises the value slightly." />
            </div>
          </Card>
          <Card title="4. From business value to value per share">
            <div className="form two">
              <NumberField label={`Net debt (${sym} ${st.unit})`} value={st.netDebt} onChange={(netDebt) => set({ netDebt })} grouping={st.currency === 'INR' ? 'IN' : 'US'} tip="Debt minus cash. Enter a negative number if the company has more cash than debt." />
              <NumberField label={`Shares outstanding (${st.unit})`} value={st.sharesOutstanding} onChange={(sharesOutstanding) => set({ sharesOutstanding })} min={0} decimals={3} />
              <NumberField label={`Other claims (${sym} ${st.unit})`} value={st.otherClaims} onChange={(otherClaims) => set({ otherClaims })} min={0} tip="Minority interests and preference shares: owed before ordinary shareholders." />
              <NumberField label={`Investments not in cash flows (${sym} ${st.unit})`} value={st.nonOperatingAssets} onChange={(nonOperatingAssets) => set({ nonOperatingAssets })} min={0} tip="Stakes in other companies, surplus land and similar assets whose income is not in the forecast." />
              <NumberField label={`Share price today (${st.priceCurrency})`} value={st.marketPrice} onChange={(marketPrice) => set({ marketPrice })} min={0} prefix={priceSym} />
            </div>
          </Card>
        </div>

        <div className="stack">
          {result.error && <Note kind="err">{result.error}</Note>}
          {r && (
            <>
              <Stats>
                <Stat big label="Estimated value per share" value={`${priceSym}${num(perShareInPrice, 2)}`} sub={st.fxToPrice !== 1 ? `${sym}${num(r.valuePerShare, 2)} converted at ${num(st.fxToPrice, 2)}` : 'under these assumptions'} />
                <Stat big label="Against today's price" value={upside !== null ? signedPct(upside) : '—'} tone={tone(upside)} sub={st.marketPrice > 0 ? `price ${priceSym}${num(st.marketPrice, 2)}` : 'enter a share price'} />
                <Stat label="Margin of safety" tip="How far the price is below your estimate of value. Because every estimate is uncertain, careful investors want a cushion of 20–30% or more before buying." value={mos !== null ? pct(mos, 0) : '—'} tone={tone(mos)} />
                <Stat label="Value of the business (EV)" value={`${money0(r.enterpriseValue)} ${st.unit}`} />
                <Stat label="Value of the shares (equity)" value={`${money0(r.equityValue)} ${st.unit}`} />
              </Stats>
              {r.equityValue <= 0 && <Note kind="err">The debt is larger than the value of the business under these assumptions, so the shares come out as worth nothing or less.</Note>}

              <div className="grid cols-2">
                <Card title="Where the value comes from">
                  <BarList
                    max={1}
                    items={[
                      { label: `Cash flows, years 1–${st.years}`, share: Math.max(0, 1 - r.terminalShare), display: pct(1 - r.terminalShare, 0), color: 'var(--s1)' },
                      { label: 'Everything after (terminal value)', share: Math.max(0, r.terminalShare), display: pct(r.terminalShare, 0), color: 'var(--s2)' },
                    ]}
                  />
                  <p className="small muted mt-s">
                    {r.terminalShare > 0.75
                      ? `${pct(r.terminalShare, 0)} of the value rests on what happens after year ${st.years}: the part nobody can forecast. Treat the answer as a rough range.`
                      : 'A healthy share of the value comes from the years you have forecast in detail.'}
                  </p>
                  <KV
                    rows={[
                      [`Present value of years 1–${st.years}`, `${money0(r.sumPv)} ${st.unit}`],
                      ['Present value of terminal value', `${money0(r.pvTerminal)} ${st.unit}`],
                      ['Value of the business', `${money0(r.enterpriseValue)} ${st.unit}`, { total: true }],
                      ['Less net debt', `${money0(-st.netDebt)} ${st.unit}`],
                      st.otherClaims ? ['Less other claims', `${money0(-st.otherClaims)} ${st.unit}`] : null,
                      st.nonOperatingAssets ? ['Plus investments', `${money0(st.nonOperatingAssets)} ${st.unit}`] : null,
                      ['Value of the shares', `${money0(r.equityValue)} ${st.unit}`, { total: true }],
                      [st.terminalMethod === 'growth' ? 'Implied exit multiple (EV/EBITDA)' : 'Implied growth forever', st.terminalMethod === 'growth' ? times(r.impliedExitMultiple, 1) : pct(r.impliedTerminalGrowth), { tip: 'A cross-check: the terminal value expressed the other way. If this looks unreasonable, so is the terminal assumption.' }],
                    ]}
                  />
                </Card>
                <Card title="What is the market assuming?" sub="reverse DCF">
                  {implied !== null ? (
                    <>
                      <div className="num" style={{ fontSize: 26, fontWeight: 600 }}>{pct(implied)} a year</div>
                      <p className="small dim">
                        is the steady revenue growth over the next {st.years} years that would justify today's price of {priceSym}
                        {num(st.marketPrice, 2)}, keeping your other assumptions.
                      </p>
                      <p className="small muted">
                        {implied > st.growthStart + 0.01
                          ? 'The market expects faster growth than you have assumed. Either it knows something, or the share is priced for perfection.'
                          : implied < st.growthEnd - 0.01
                            ? 'The market is pricing in slower growth than even your final-year rate. If your view is right, the share is cheap.'
                            : 'That is close to your own growth assumptions: the share looks about fairly priced on your numbers.'}
                      </p>
                    </>
                  ) : (
                    <p className="muted small">No growth rate between −50% and +150% reproduces today's price with these assumptions. Check the price, the debt and the discount rate.</p>
                  )}
                  <h4 className="mt mb-s">Free cash flow forecast</h4>
                  <BarChart data={r.years.map((y) => ({ label: `Y${y.year}`, value: y.fcff, note: `Year ${y.year}` }))} signed yFormat={(v) => num(v, 0)} height={150} />
                </Card>
              </div>

              <Card title="Sensitivity" sub={`value per share (${priceSym}) as the two key assumptions change`} flush>
                <div className="tbl-wrap">
                  <table className="tbl compact">
                    <thead>
                      <tr>
                        <th>Discount rate ↓ · {st.terminalMethod === 'growth' ? 'Growth forever' : 'Exit multiple'} →</th>
                        {seconds.map((s) => (
                          <th className="r" key={s}>
                            {st.terminalMethod === 'growth' ? pct(s) : times(s, 0)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {waccs.map((w, i) => (
                        <tr key={w}>
                          <td className="strong">{pct(w)}</td>
                          {grid[i].map((v, j) => {
                            const val = v === null ? null : v * st.fxToPrice;
                            const base = i === 2 && j === 2;
                            return (
                              <td key={j} className={'r ' + (val === null ? 'muted' : st.marketPrice > 0 ? (val >= st.marketPrice ? 'pos' : 'neg') : '') + (base ? ' strong' : '')} style={base ? { background: 'var(--accent-soft)' } : undefined}>
                                {val === null ? 'n/a' : num(val, val < 100 ? 1 : 0)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ padding: '10px 14px' }}>
                  The highlighted cell is your base case. Green cells are above today's price, red below. If a one-point change in the discount rate flips the answer, the valuation is too fragile to act on.
                </p>
              </Card>

              <Card title="Scenarios" sub="a pessimistic and an optimistic version of your case" flush>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th />
                        <th className="r">Pessimistic</th>
                        <th className="r">Your case</th>
                        <th className="r">Optimistic</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Change in growth (points)</td>
                        <td className="r"><CellInput label="Pessimistic change in growth, percentage points" scale={100} value={st.bearGrowth} onChange={(n) => n !== null && set({ bearGrowth: n })} /></td>
                        <td className="r muted">—</td>
                        <td className="r"><CellInput label="Optimistic change in growth, percentage points" scale={100} value={st.bullGrowth} onChange={(n) => n !== null && set({ bullGrowth: n })} /></td>
                      </tr>
                      <tr>
                        <td>Change in margin (points)</td>
                        <td className="r"><CellInput label="Pessimistic change in margin, percentage points" scale={100} value={st.bearMargin} onChange={(n) => n !== null && set({ bearMargin: n })} /></td>
                        <td className="r muted">—</td>
                        <td className="r"><CellInput label="Optimistic change in margin, percentage points" scale={100} value={st.bullMargin} onChange={(n) => n !== null && set({ bullMargin: n })} /></td>
                      </tr>
                      <tr>
                        <td>Change in discount rate (points)</td>
                        <td className="r"><CellInput label="Pessimistic change in discount rate, percentage points" scale={100} value={st.bearWacc} onChange={(n) => n !== null && set({ bearWacc: n })} /></td>
                        <td className="r muted">—</td>
                        <td className="r"><CellInput label="Optimistic change in discount rate, percentage points" scale={100} value={st.bullWacc} onChange={(n) => n !== null && set({ bullWacc: n })} /></td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Value per share ({priceSym})</td>
                        <td className="r">{bear ? num(bear.valuePerShare * st.fxToPrice, 2) : 'n/a'}</td>
                        <td className="r">{num(perShareInPrice, 2)}</td>
                        <td className="r">{bull ? num(bull.valuePerShare * st.fxToPrice, 2) : 'n/a'}</td>
                      </tr>
                      {st.marketPrice > 0 && (
                        <tr>
                          <td>Against today's price</td>
                          <td className={'r ' + tone(bear ? (bear.valuePerShare * st.fxToPrice) / st.marketPrice - 1 : null)}>{bear ? signedPct((bear.valuePerShare * st.fxToPrice) / st.marketPrice - 1) : '—'}</td>
                          <td className={'r ' + tone(upside)}>{signedPct(upside)}</td>
                          <td className={'r ' + tone(bull ? (bull.valuePerShare * st.fxToPrice) / st.marketPrice - 1 : null)}>{bull ? signedPct((bull.valuePerShare * st.fxToPrice) / st.marketPrice - 1) : '—'}</td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
                <p className="small muted" style={{ padding: '10px 14px' }}>A sensible purchase still looks acceptable in the pessimistic column. The growth change applies in full to year 1 and by half to the final year.</p>
              </Card>

              <Card title="Year-by-year forecast" sub={`${sym} ${unitName}`} flush>
                <div className="tbl-wrap">
                  <table className="tbl compact">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th className="r">Growth</th>
                        <th className="r">Revenue</th>
                        <th className="r">Margin</th>
                        <th className="r">EBIT</th>
                        <th className="r">After tax</th>
                        <th className="r">+ Depn.</th>
                        <th className="r">− Capex</th>
                        <th className="r">− Working cap.</th>
                        <th className="r">Free cash flow</th>
                        <th className="r">Discount factor</th>
                        <th className="r">Present value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.years.map((y) => (
                        <tr key={y.year}>
                          <td>{y.year}</td>
                          <td className="r">{pct(y.growth)}</td>
                          <td className="r">{num(y.revenue, 0, st.currency)}</td>
                          <td className="r">{pct(y.margin)}</td>
                          <td className="r">{num(y.ebit, 0, st.currency)}</td>
                          <td className="r">{num(y.nopat, 0, st.currency)}</td>
                          <td className="r">{num(y.da, 0, st.currency)}</td>
                          <td className="r">{num(y.capex, 0, st.currency)}</td>
                          <td className="r">{num(y.nwcChange, 0, st.currency)}</td>
                          <td className={'r strong ' + (y.fcff < 0 ? 'neg' : '')}>{num(y.fcff, 0, st.currency)}</td>
                          <td className="r">{num(y.discountFactor, 3)}</td>
                          <td className="r">{num(y.pv, 0, st.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
