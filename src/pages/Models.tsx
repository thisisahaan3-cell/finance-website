import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasketPicker, useBasket } from '../components/Basket';
import { Page } from '../components/Page';
import { Card, Empty, ErrorNote, KV, Loading, Note, NumberField, PercentField, SelectField, Stat, Stats, Tabs } from '../components/ui';
import { getFundamentals, getQuotes, type Fundamentals } from '../lib/data/api';
import { shortSymbol } from '../lib/data/symbols';
import { costOfEquity, gordonGrowth, grahamNumber, marginOfSafety, pegRatio, releverBeta, summariseMultiple, twoStageDdm, unleverBeta, wacc } from '../lib/finance/valuation';
import { compact, num, pct, signedPct, times, tone } from '../lib/format';
import { attempt, useAsync } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

type TabId = 'comps' | 'ddm' | 'capital' | 'checks';

/* ---------- Relative valuation ---------- */

const MULTIPLES: { key: 'pe' | 'pb' | 'ev' | 'ps'; label: string; get: (f: Fundamentals) => number | null | undefined; tip: string }[] = [
  { key: 'pe', label: 'P/E', get: (f) => f.trailingPE, tip: 'Price ÷ earnings per share' },
  { key: 'pb', label: 'P/B', get: (f) => f.priceToBook, tip: 'Price ÷ book value per share' },
  { key: 'ev', label: 'EV/EBITDA', get: (f) => f.evToEbitda, tip: 'Enterprise value ÷ EBITDA' },
  { key: 'ps', label: 'P/S', get: (f) => f.priceToSales ?? (f.marketCap && f.totalRevenue ? f.marketCap / f.totalRevenue : null), tip: 'Market value ÷ revenue' },
];

function Comps() {
  const basket = useBasket('comps', [
    { symbol: 'TCS.NS', weight: 0 },
    { symbol: 'INFY.NS', weight: 0 },
    { symbol: 'HCLTECH.NS', weight: 0 },
    { symbol: 'WIPRO.NS', weight: 0 },
    { symbol: 'TECHM.NS', weight: 0 },
  ]);
  const [target, setTarget] = useState<string>('');
  const symbols = basket.items.map((i) => i.symbol);
  const subject = symbols.includes(target) ? target : symbols[0];
  const data = useAsync(symbols.length ? async () => ({ f: await getFundamentals(symbols), q: (await getQuotes(symbols)).quotes }) : null, [symbols.join(',')]);
  const rows = data.data ? symbols.map((s) => data.data!.f[s]).filter((f): f is Fundamentals => !!f?.ok) : [];
  const peers = rows.filter((f) => f.symbol !== subject);
  const me = rows.find((f) => f.symbol === subject);
  const price = subject ? data.data?.q[subject]?.regularMarketPrice : undefined;

  return (
    <div className="split">
      <Card title="Company and its peers" sub="pick businesses that are genuinely alike">
        <BasketPicker items={basket.items} onChange={basket.setItems} noWeights max={12} types={['EQUITY']} />
        {symbols.length > 1 && (
          <div className="mt">
            <SelectField label="Company being valued" value={subject ?? ''} onChange={setTarget} options={symbols.map((s) => ({ value: s, label: shortSymbol(s) }))} hint="The others are used as the yardstick." />
          </div>
        )}
      </Card>
      <div className="stack">
        {symbols.length < 3 && <Card><Empty title="Add a company and at least two peers"><p>Relative valuation asks: if this company were priced like similar businesses, what would its share be worth?</p></Empty></Card>}
        {data.loading && !data.data && <Loading height={140} />}
        {data.error && <ErrorNote error={data.error} retry={data.reload} />}
        {me && peers.length >= 2 && (
          <>
            <Card title={`If ${shortSymbol(subject!)} were priced like its peers`} sub={price ? `today's price ${num(price, 2)} ${me.currency ?? ''}` : undefined} flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Multiple</th>
                      <th className="r">{shortSymbol(subject!)} today</th>
                      <th className="r">Peers: low</th>
                      <th className="r">Peers: median</th>
                      <th className="r">Peers: high</th>
                      <th className="r">Price at peer median</th>
                      <th className="r">Against today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MULTIPLES.map((m) => {
                      const mine = m.get(me);
                      const s = summariseMultiple(peers.map(m.get));
                      // price scales in proportion to the multiple (EV-based multiples are approximated the same way)
                      const implied = s && mine && mine > 0 && price ? (price * s.median) / mine : null;
                      return (
                        <tr key={m.key}>
                          <td title={m.tip}>
                            {m.label}
                            <span className="sub">{m.tip}</span>
                          </td>
                          <td className="r strong">{mine && mine > 0 ? times(mine, 1) : 'n/a'}</td>
                          <td className="r">{s ? times(s.low, 1) : '—'}</td>
                          <td className="r">{s ? times(s.median, 1) : '—'}</td>
                          <td className="r">{s ? times(s.high, 1) : '—'}</td>
                          <td className="r">{implied ? num(implied, 2) : '—'}</td>
                          <td className={'r ' + tone(implied && price ? implied / price - 1 : null)}>{implied && price ? signedPct(implied / price - 1) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ padding: '10px 14px' }}>
                “n/a” means the multiple does not apply (for example a loss-making company has no P/E). For EV/EBITDA the implied price is an approximation that ignores the effect of debt on the share price; it is close when debt is small.
              </p>
            </Card>
            <Card title="The peer group in detail" flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th className="r">Market value</th>
                      {MULTIPLES.map((m) => (
                        <th className="r" key={m.key}>{m.label}</th>
                      ))}
                      <th className="r">ROE</th>
                      <th className="r">Net margin</th>
                      <th className="r">Sales growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.symbol} style={f.symbol === subject ? { background: 'var(--accent-soft)' } : undefined}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(f.symbol)}`}>{shortSymbol(f.symbol)}</Link>
                          <span className="sub">{f.name}</span>
                        </td>
                        <td className="r">{compact(f.marketCap, f.currency)}</td>
                        {MULTIPLES.map((m) => {
                          const v = m.get(f);
                          return <td className="r" key={m.key}>{v && v > 0 ? num(v, 1) : '—'}</td>;
                        })}
                        <td className="r">{pct(f.roe)}</td>
                        <td className="r">{pct(f.profitMargin)}</td>
                        <td className={'r ' + tone(f.revenueGrowth)}>{signedPct(f.revenueGrowth)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="plain">
              In plain words: a company usually deserves a higher multiple than its peers if it grows faster, earns higher returns, or carries less risk. If it trades at a premium without those, it may be expensive; at a discount with them,
              it may be a bargain. If the whole group is overpriced, this method will not tell you: use the DCF for that.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Dividend discount ---------- */

function Ddm() {
  const [v, set] = useSaved('ddm', { dividend: 20, required: 0.12, growth: 0.06, highGrowth: 0.14, highYears: 5, price: 400 });
  const gordon = gordonGrowth(v.dividend * (1 + v.growth), v.required, v.growth);
  const two = twoStageDdm(v.dividend, v.highGrowth, v.highYears, v.growth, v.required);
  const impliedReturn = v.price > 0 ? (v.dividend * (1 + v.growth)) / v.price + v.growth : null;
  return (
    <div className="split">
      <Card title="Inputs">
        <div className="form">
          <NumberField label="Dividend per share, last 12 months" prefix="₹" value={v.dividend} onChange={(dividend) => set({ dividend })} min={0} />
          <PercentField label="Return you require" value={v.required} onChange={(required) => set({ required })} min={0.01} max={0.5} tip="The yearly return that would make this share worth owning for you, given its risk. Often the cost of equity from CAPM." />
          <PercentField label="Dividend growth forever" value={v.growth} onChange={(growth) => set({ growth })} min={-0.1} max={0.2} tip="Must stay below your required return, and should not exceed the economy's long-run growth." />
          <div className="form two">
            <PercentField label="Faster growth at first" value={v.highGrowth} onChange={(highGrowth) => set({ highGrowth })} min={-0.2} max={1} />
            <NumberField label="For how many years" suffix="yrs" value={v.highYears} onChange={(highYears) => set({ highYears })} min={0} max={40} decimals={0} />
          </div>
          <NumberField label="Share price today" prefix="₹" value={v.price} onChange={(price) => set({ price })} min={0} />
        </div>
      </Card>
      <div className="stack">
        {v.required <= v.growth && <Note kind="err">The growth rate must be below the required return. A dividend growing as fast as (or faster than) your discount rate would be worth an infinite amount, which cannot be right.</Note>}
        <Stats>
          <Stat big label="Steady growth model" tip="Gordon growth: next year's dividend ÷ (required return − growth)." value={gordon !== null ? `₹${num(gordon, 2)}` : '—'} sub={gordon !== null && v.price > 0 ? `${signedPct(gordon / v.price - 1)} against price` : undefined} tone={gordon !== null && v.price > 0 ? tone(gordon - v.price) : ''} />
          <Stat big label="Two-stage model" tip="Fast growth for a few years, then steady growth forever." value={two !== null ? `₹${num(two, 2)}` : '—'} sub={two !== null && v.price > 0 ? `${signedPct(two / v.price - 1)} against price` : undefined} tone={two !== null && v.price > 0 ? tone(two - v.price) : ''} />
          <Stat label="Return implied by today's price" tip="Dividend yield next year plus growth: the return you would earn if dividends grow as assumed and the yield stays the same." value={pct(impliedReturn)} sub={impliedReturn !== null ? (impliedReturn >= v.required ? 'meets your required return' : 'below your required return') : undefined} tone={impliedReturn !== null ? tone(impliedReturn - v.required) : ''} />
        </Stats>
        <Card title="The working">
          <div className="formula" style={{ whiteSpace: 'pre-wrap' }}>
            {`Steady growth:  value = D₁ ÷ (r − g) = ${num(v.dividend * (1 + v.growth), 2)} ÷ (${pct(v.required)} − ${pct(v.growth)})${gordon !== null ? ` = ₹${num(gordon, 2)}` : ''}\nTwo-stage:      value = Σ dividends for ${v.highYears} years growing ${pct(v.highGrowth)}, discounted at ${pct(v.required)}\n                        + steady-growth value at year ${v.highYears}, discounted back`}
          </div>
          <p className="small muted mt-s">
            Dividend models suit mature companies that pay out a large, steady share of profit: utilities, large banks, consumer staples, PSUs. They undervalue companies that reinvest their profits instead. Notice how sensitive the answer is:
            change growth by one point and watch the value move.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Cost of capital ---------- */

function Capital() {
  const settings = useStore((s) => s.settings);
  const [v, set] = useSaved('wacc', { rf: settings.riskFree, beta: 1.1, erp: 0.06, extra: 0, equity: 8000, debt: 2000, costOfDebt: 0.09, tax: 0.25, peerBeta: 1.2, peerDe: 0.6, ownDe: 0.25 });
  const ke = costOfEquity(v.rf, v.beta, v.erp, v.extra);
  const w = attempt(() => wacc({ equityValue: v.equity, debtValue: v.debt, costOfEquity: ke, costOfDebt: v.costOfDebt, taxRate: v.tax }));
  const assetBeta = unleverBeta(v.peerBeta, v.peerDe, v.tax);
  const relevered = releverBeta(assetBeta, v.ownDe, v.tax);
  return (
    <div className="split">
      <div className="stack">
        <Card title="Cost of equity (CAPM)">
          <div className="form two">
            <PercentField label="Risk-free rate" value={v.rf} onChange={(rf) => set({ rf })} min={0} max={0.25} tip="Yield on a 10-year government bond: what you can earn without taking risk." />
            <NumberField label="Beta" value={v.beta} onChange={(beta) => set({ beta })} min={0} max={5} tip="How sensitive the share is to the market. Find it on any stock's Returns & risk tab." />
            <PercentField label="Equity risk premium" value={v.erp} onChange={(erp) => set({ erp })} min={0} max={0.2} tip="Extra return investors expect from the share market over government bonds. 5–7% is commonly assumed for India." />
            <PercentField label="Extra premium (optional)" value={v.extra} onChange={(extra) => set({ extra })} min={0} max={0.2} tip="Some analysts add 1–3% for small or illiquid companies." />
          </div>
        </Card>
        <Card title="Capital structure">
          <div className="form two">
            <NumberField label="Market value of equity" prefix="₹" value={v.equity} onChange={(equity) => set({ equity })} min={0} grouping="IN" hint="Any unit, as long as debt uses the same" />
            <NumberField label="Debt" prefix="₹" value={v.debt} onChange={(debt) => set({ debt })} min={0} grouping="IN" />
            <PercentField label="Interest rate on debt" value={v.costOfDebt} onChange={(costOfDebt) => set({ costOfDebt })} min={0} max={0.4} />
            <PercentField label="Tax rate" value={v.tax} onChange={(tax) => set({ tax })} min={0} max={0.6} tip="Interest is tax-deductible, so debt costs less after tax." />
          </div>
        </Card>
      </div>
      <div className="stack">
        <Stats>
          <Stat big label="Cost of equity" value={pct(ke, 2)} sub="return shareholders require" />
          <Stat big label="WACC" tip="Weighted average cost of capital: the blended return required by everyone who funds the company. Use it as the discount rate in a DCF." value={w.value ? pct(w.value.wacc, 2) : '—'} />
          <Stat label="After-tax cost of debt" value={w.value ? pct(w.value.afterTaxCostOfDebt, 2) : '—'} />
          <Stat label="Equity : debt" value={w.value ? `${pct(w.value.equityWeight, 0)} : ${pct(w.value.debtWeight, 0)}` : '—'} />
        </Stats>
        {w.error && <Note kind="err">{w.error}</Note>}
        <Card title="The working">
          <div className="formula" style={{ whiteSpace: 'pre-wrap' }}>
            {`Cost of equity = risk-free + beta × premium${v.extra ? ' + extra' : ''}\n               = ${pct(v.rf)} + ${num(v.beta, 2)} × ${pct(v.erp)}${v.extra ? ` + ${pct(v.extra)}` : ''} = ${pct(ke, 2)}\n\nWACC = E/(D+E) × cost of equity + D/(D+E) × cost of debt × (1 − tax)${w.value ? `\n     = ${pct(w.value.equityWeight, 1)} × ${pct(ke, 2)} + ${pct(w.value.debtWeight, 1)} × ${pct(v.costOfDebt)} × (1 − ${pct(v.tax, 0)}) = ${pct(w.value.wacc, 2)}` : ''}`}
          </div>
          <Link className="btn sm mt-s" to="/valuation/dcf">Use this in a DCF</Link>
        </Card>
        <Card title="Borrowing a beta from peers" sub="for a company with no reliable beta of its own">
          <div className="form three">
            <NumberField label="Peers' average beta" value={v.peerBeta} onChange={(peerBeta) => set({ peerBeta })} min={0} max={5} />
            <NumberField label="Peers' debt ÷ equity" suffix="×" value={v.peerDe} onChange={(peerDe) => set({ peerDe })} min={0} max={20} />
            <NumberField label="Your company's debt ÷ equity" suffix="×" value={v.ownDe} onChange={(ownDe) => set({ ownDe })} min={0} max={20} />
          </div>
          <div className="mt">
            <KV
              rows={[
                ['Beta of the business itself (debt removed)', num(assetBeta, 2), { tip: 'Unlevered beta = peer beta ÷ (1 + (1 − tax) × debt/equity). Removes the extra swing that comes from the peers’ borrowing.' }],
                ['Beta for your company (its own debt added back)', num(relevered, 2), { total: true }],
              ]}
            />
            <button className="btn sm mt-s" onClick={() => set({ beta: Number(relevered.toFixed(2)) })}>Use {num(relevered, 2)} as the beta above</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Quick checks ---------- */

function Checks() {
  const [v, set] = useSaved('checks', { price: 1500, eps: 60, book: 300, growth: 12, bond: 0.068, value: 1900 });
  const pe = v.eps > 0 ? v.price / v.eps : null;
  const graham = grahamNumber(v.eps, v.book);
  const peg = pe ? pegRatio(pe, v.growth) : null;
  const ey = v.price > 0 && v.eps > 0 ? v.eps / v.price : null;
  const mos = marginOfSafety(v.value, v.price);
  return (
    <div className="split">
      <Card title="Per-share figures">
        <div className="form two">
          <NumberField label="Share price" prefix="₹" value={v.price} onChange={(price) => set({ price })} min={0} />
          <NumberField label="Earnings per share" prefix="₹" value={v.eps} onChange={(eps) => set({ eps })} hint="Last 12 months" />
          <NumberField label="Book value per share" prefix="₹" value={v.book} onChange={(book) => set({ book })} />
          <NumberField label="Expected profit growth" suffix="%" value={v.growth} onChange={(growth) => set({ growth })} hint="Per year, next 3–5 years" />
          <PercentField label="10-year government bond yield" value={v.bond} onChange={(bond) => set({ bond })} min={0} max={0.3} />
          <NumberField label="Your estimate of value" prefix="₹" value={v.value} onChange={(value) => set({ value })} min={0} hint="From a DCF or peers" />
        </div>
        <p className="tiny muted mt-s">Find these on any company's Stock research page.</p>
      </Card>
      <div className="stack">
        <Stats>
          <Stat label="P/E ratio" value={pe ? times(pe, 1) : 'n/a'} sub={pe ? `pays back in ${num(pe, 0)} years of today's profit` : 'no profit'} />
          <Stat label="Earnings yield" tip="Profit per share ÷ price: the P/E turned upside down, so it can be compared with a bond yield." value={pct(ey, 2)} sub={ey !== null ? `${signedPct(ey - v.bond, 2)} against the bond` : undefined} tone={ey !== null ? tone(ey - v.bond) : ''} />
          <Stat label="PEG ratio" tip="P/E ÷ growth rate. Around 1 suggests you are paying a fair price for the growth; well above 2 is rich." value={peg ? num(peg, 2) : 'n/a'} tone={peg ? (peg <= 1 ? 'pos' : peg > 2 ? 'neg' : '') : ''} />
          <Stat label="Graham number" tip="Benjamin Graham's ceiling for a defensive investor: √(22.5 × EPS × book value), which is a P/E of 15 times a P/B of 1.5." value={graham ? `₹${num(graham, 0)}` : 'n/a'} sub={graham && v.price > 0 ? (v.price <= graham ? 'price is below it' : `price is ${pct(v.price / graham - 1, 0)} above it`) : undefined} tone={graham && v.price > 0 ? tone(graham - v.price) : ''} />
          <Stat label="Margin of safety" tip="(Value − price) ÷ value. A cushion against your estimate being wrong." value={pct(mos, 0)} tone={tone(mos)} sub={mos !== null ? (mos >= 0.25 ? 'a comfortable cushion' : mos > 0 ? 'thin cushion' : 'price is above your value') : undefined} />
        </Stats>
        <Card title="How to use these">
          <ul className="small dim" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
            <li><b>Earnings yield against bonds</b>: if a share's earnings yield is below what a risk-free government bond pays, you are relying entirely on growth to be compensated for the risk.</li>
            <li><b>PEG</b> rewards growth, but the growth figure is a forecast and forecasts are usually too rosy. It is meaningless for shrinking or cyclical profits.</li>
            <li><b>Graham number</b> was designed for asset-heavy companies in the 1940s–70s. Good modern businesses (software, brands) need few assets and will nearly always look expensive on it.</li>
            <li><b>Margin of safety</b> is the most durable idea in investing: never pay full price for an estimate.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function Models() {
  const [params, setParams] = useSearchParams();
  const tab = (['comps', 'ddm', 'capital', 'checks'].includes(params.get('tab') ?? '') ? params.get('tab') : 'comps') as TabId;
  const tabs = useMemo(
    () => [
      { value: 'comps' as TabId, label: 'Compare with peers' },
      { value: 'ddm' as TabId, label: 'Dividend discount' },
      { value: 'capital' as TabId, label: 'Cost of capital (WACC, CAPM)' },
      { value: 'checks' as TabId, label: 'Quick checks' },
    ],
    [],
  );
  return (
    <Page tool="models">
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams(t === 'comps' ? {} : { tab: t }, { replace: true })} />
      {tab === 'comps' && <Comps />}
      {tab === 'ddm' && <Ddm />}
      {tab === 'capital' && <Capital />}
      {tab === 'checks' && <Checks />}
    </Page>
  );
}
