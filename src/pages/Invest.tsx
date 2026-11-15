import { useSearchParams } from 'react-router-dom';
import { LineChart, StackedColumns } from '../components/charts';
import { Page } from '../components/Page';
import { Card, CellInput, Check, KV, MoneyField, Note, NumberField, PercentField, Stat, Stats, Tabs, TextField } from '../components/ui';
import { absoluteReturn, cagr, futureValue, realReturn, requiredLumpsum, requiredSip, sip, swp, xirr, yearsToMultiply, type DatedFlow } from '../lib/finance/tvm';
import { parseDate } from '../lib/csv';
import { compact, duration, money, num, pct, signedPct, times, todayIso, tone } from '../lib/format';
import { attempt } from '../lib/hooks';
import { uid, useSaved, useStore } from '../lib/store';

type TabId = 'sip' | 'lumpsum' | 'goal' | 'swp' | 'cagr' | 'xirr';

function Sip() {
  const infl = useStore((s) => s.settings.inflation);
  const [v, set, reset] = useSaved('sip', { monthly: 10_000, rate: 0.12, years: 15, stepUp: 0, initial: 0, effective: false, inflation: infl });
  const res = attempt(() => sip({ monthly: v.monthly, annualRate: v.rate, years: v.years, stepUp: v.stepUp, initial: v.initial, convention: v.effective ? 'effective' : 'nominal' }));
  const r = res.value;
  const real = r ? r.value / Math.pow(1 + v.inflation, v.years) : null;
  return (
    <div className="split">
      <Card title="Your plan" right={<button className="btn sm ghost" onClick={reset}>Reset</button>}>
        <div className="form">
          <MoneyField label="Invested every month" value={v.monthly} onChange={(monthly) => set({ monthly })} min={0} decimals={0} />
          <div className="form two">
            <PercentField label="Expected return per year" value={v.rate} onChange={(rate) => set({ rate })} min={-0.5} max={1} tip="An assumption, not a promise. Diversified Indian equity funds have often been modelled at 10–12%; debt funds at 6–7.5%." />
            <NumberField label="For how long" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={1} max={60} decimals={0} />
            <PercentField label="Raise the amount each year by" value={v.stepUp} onChange={(stepUp) => set({ stepUp })} min={0} max={0.5} tip="A step-up SIP: increase your instalment as your income grows. Even 5–10% a year makes a very large difference." />
            <MoneyField label="Lump sum added at the start" value={v.initial} onChange={(initial) => set({ initial })} min={0} decimals={0} />
            <PercentField label="Inflation" value={v.inflation} onChange={(inflation) => set({ inflation })} min={0} max={0.3} tip="Used to show what the final amount would buy in today's money." />
          </div>
          <Check label="Use exact annual compounding" checked={v.effective} onChange={(effective) => set({ effective })} tip="Off (default): monthly rate = yearly rate ÷ 12, the convention used by most Indian SIP calculators, which slightly overstates growth. On: twelve months compound to exactly the yearly rate." />
        </div>
      </Card>
      <div className="stack">
        {res.error && <Note kind="err">{res.error}</Note>}
        {r && (
          <>
            <Stats>
              <Stat big label="You would have" value={compact(r.value)} sub={money(r.value, 'INR', 0)} />
              <Stat label="You put in" value={compact(r.invested)} />
              <Stat label="Growth" value={compact(r.gain)} tone="pos" sub={`${times(r.invested > 0 ? r.value / r.invested : NaN, 1)} your money`} />
              <Stat label="In today's money" tip="The final amount reduced by inflation: what it would actually buy." value={compact(real)} sub={`at ${pct(v.inflation, 0)} inflation`} />
            </Stats>
            <Card title="Year by year" sub="what you put in, and what growth added">
              <StackedColumns categories={r.schedule.map((y) => String(y.year))} series={[{ name: 'Money you put in', values: r.schedule.map((y) => y.invested), color: 'var(--s1)' }, { name: 'Growth', values: r.schedule.map((y) => Math.max(0, y.gain)), color: 'var(--s3)' }]} height={250} />
            </Card>
            <p className="plain">
              In plain words: in the early years almost all the value is your own money. Later, growth on past growth (compounding) takes over{r.gain > r.invested ? `: by the end, growth (${compact(r.gain)}) is larger than everything you put in (${compact(r.invested)})` : ''}. Time in the market matters more than the amount.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Lumpsum() {
  const infl = useStore((s) => s.settings.inflation);
  const [v, set] = useSaved('lumpsum', { amount: 500_000, rate: 0.12, years: 10, inflation: infl });
  const fv = futureValue(v.amount, v.rate, v.years);
  const rr = realReturn(v.rate, v.inflation);
  const double = yearsToMultiply(2, v.rate);
  const years = Array.from({ length: Math.round(v.years) + 1 }, (_, i) => i);
  return (
    <div className="split">
      <Card title="One-time investment">
        <div className="form">
          <MoneyField label="Amount invested" value={v.amount} onChange={(amount) => set({ amount })} min={0} decimals={0} />
          <div className="form two">
            <PercentField label="Expected return per year" value={v.rate} onChange={(rate) => set({ rate })} min={-0.5} max={1} />
            <NumberField label="For how long" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={1} max={60} decimals={0} />
            <PercentField label="Inflation" value={v.inflation} onChange={(inflation) => set({ inflation })} min={0} max={0.3} />
          </div>
        </div>
      </Card>
      <div className="stack">
        <Stats>
          <Stat big label="It would grow to" value={compact(fv)} sub={money(fv, 'INR', 0)} />
          <Stat label="Growth" value={compact(fv - v.amount)} tone={tone(fv - v.amount)} sub={`${times(v.amount > 0 ? fv / v.amount : NaN, 1)} your money`} />
          <Stat label="In today's money" value={compact(fv / Math.pow(1 + v.inflation, v.years))} sub={rr !== null ? `real return ${pct(rr)} a year` : undefined} />
          <Stat label="Doubles every" tip="At this rate of return. A quick approximation is the rule of 72: 72 ÷ the return in percent." value={double ? duration(double) : 'never'} sub={v.rate > 0 ? `rule of 72: ${num(72 / (v.rate * 100), 1)} years` : undefined} />
        </Stats>
        <Card title="Growth over time" sub="nominal, and after inflation">
          <LineChart x={years} series={[{ name: 'Value', values: years.map((y) => futureValue(v.amount, v.rate, y)) }, { name: "In today's money", values: years.map((y) => futureValue(v.amount, v.rate, y) / Math.pow(1 + v.inflation, y)), color: 'var(--text-3)', dashed: true }]} area height={250} xFormat={(y) => `Year ${y}`} />
        </Card>
        <p className="plain">In plain words: the real return is what is left after inflation. A deposit paying 7% when prices rise 6% barely makes you richer; this is why long-term money needs assets that beat inflation by a clear margin.</p>
      </div>
    </div>
  );
}

function Goal() {
  const infl = useStore((s) => s.settings.inflation);
  const [v, set] = useSaved('goal', { costToday: 5_000_000, years: 12, inflation: infl, rate: 0.12, have: 200_000, stepUp: 0.05 });
  const target = v.costToday * Math.pow(1 + v.inflation, v.years);
  const need = requiredSip(target, { annualRate: v.rate, years: v.years, stepUp: v.stepUp, initial: v.have });
  const needFlat = requiredSip(target, { annualRate: v.rate, years: v.years, stepUp: 0, initial: v.have });
  const lump = requiredLumpsum(target, v.rate, v.years);
  const haveGrows = futureValue(v.have, v.rate, v.years);
  return (
    <div className="split">
      <Card title="The goal">
        <div className="form">
          <MoneyField label="What it costs today" value={v.costToday} onChange={(costToday) => set({ costToday })} min={0} decimals={0} tip="For example a child's college fees, a house down-payment or a car, at today's prices." />
          <div className="form two">
            <NumberField label="Years until you need it" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={1} max={60} decimals={0} />
            <PercentField label="Price rise per year" value={v.inflation} onChange={(inflation) => set({ inflation })} min={0} max={0.3} tip="Education and healthcare costs in India have typically risen faster than general inflation: 8–10% is often assumed." />
            <PercentField label="Expected return per year" value={v.rate} onChange={(rate) => set({ rate })} min={-0.2} max={1} tip="Use a lower, safer rate for goals under five years away: money needed soon should not be in shares." />
            <PercentField label="Yearly raise in your SIP" value={v.stepUp} onChange={(stepUp) => set({ stepUp })} min={0} max={0.5} />
          </div>
          <MoneyField label="Already saved for this" value={v.have} onChange={(have) => set({ have })} min={0} decimals={0} />
        </div>
      </Card>
      <div className="stack">
        <Stats>
          <Stat big label="Invest each month" value={need !== null ? money(need, 'INR', 0) : '—'} sub={v.stepUp > 0 ? `to start, rising ${pct(v.stepUp, 0)} a year` : 'kept the same every year'} />
          <Stat label="The goal will cost" tip="Today's cost grown by inflation." value={compact(target)} sub={`in ${num(v.years, 0)} years`} />
          <Stat label="Without a yearly raise" value={needFlat !== null ? money(needFlat, 'INR', 0) : '—'} sub="per month, flat" />
          <Stat label="Or one lump sum today" value={lump !== null ? compact(Math.max(0, lump - v.have)) : '—'} sub="on top of what you have" />
        </Stats>
        {haveGrows >= target && <Note kind="ok">What you have already saved is expected to grow to {compact(haveGrows)}, enough to cover the goal with no further investing, if the return assumption holds.</Note>}
        <Card title="The working">
          <KV
            rows={[
              ['Cost today', money(v.costToday, 'INR', 0)],
              [`Cost in ${num(v.years, 0)} years at ${pct(v.inflation, 0)} inflation`, money(target, 'INR', 0)],
              ['Your existing savings will grow to', money(haveGrows, 'INR', 0)],
              ['Gap to fill with monthly investing', money(Math.max(0, target - haveGrows), 'INR', 0), { total: true }],
            ]}
          />
          <p className="small muted mt-s">For a probability rather than a single answer (returns are never smooth), run this plan through the Future simulator.</p>
        </Card>
      </div>
    </div>
  );
}

function Swp() {
  const infl = useStore((s) => s.settings.inflation);
  const [v, set] = useSaved('swp', { corpus: 10_000_000, monthly: 50_000, rate: 0.08, years: 25, growth: infl });
  const res = attempt(() => swp({ corpus: v.corpus, monthlyWithdrawal: v.monthly, annualRate: v.rate, years: v.years, withdrawalGrowth: v.growth }));
  const r = res.value;
  const rate = v.corpus > 0 ? (v.monthly * 12) / v.corpus : null;
  return (
    <div className="split">
      <Card title="Regular withdrawals">
        <div className="form">
          <MoneyField label="Starting amount" value={v.corpus} onChange={(corpus) => set({ corpus })} min={0} decimals={0} />
          <MoneyField label="Withdrawn every month" value={v.monthly} onChange={(monthly) => set({ monthly })} min={0} decimals={0} />
          <div className="form two">
            <PercentField label="Return per year on the rest" value={v.rate} onChange={(rate) => set({ rate })} min={-0.2} max={0.5} />
            <NumberField label="For how long" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={1} max={60} decimals={0} />
            <PercentField label="Raise the withdrawal each year by" value={v.growth} onChange={(growth) => set({ growth })} min={0} max={0.3} tip="To keep up with rising prices. 0% means the same rupee amount for ever, which buys less each year." />
          </div>
        </div>
      </Card>
      <div className="stack">
        {res.error && <Note kind="err">{res.error}</Note>}
        {r && (
          <>
            <Stats>
              <Stat big label={r.depletedMonth ? 'Money runs out after' : 'Left at the end'} value={r.depletedMonth ? duration(r.depletedMonth / 12) : compact(r.endValue)} tone={r.depletedMonth ? 'neg' : 'pos'} sub={r.depletedMonth ? `short of the ${num(v.years, 0)} years planned` : `after ${num(v.years, 0)} years`} />
              <Stat label="Total withdrawn" value={compact(r.totalWithdrawn)} />
              <Stat label="First-year withdrawal rate" tip="First year's withdrawals ÷ starting amount. Studies of long retirements suggest roughly 3–4% a year, raised with inflation, has historically been sustainable; much above that risks running out." value={pct(rate)} tone={rate !== null && rate > 0.05 ? 'neg' : ''} />
            </Stats>
            <Card title="Balance over time">
              <LineChart x={[0, ...r.schedule.map((y) => y.year)]} series={[{ name: 'Balance', values: [v.corpus, ...r.schedule.map((y) => y.value)] }]} area height={240} hideLegend xFormat={(y) => `Year ${y}`} />
            </Card>
            <p className="plain">In plain words: this assumes the same return every year. Real markets do not behave that way, and a bad run early in retirement does far more damage than the same run later. Test the plan in the Future simulator before relying on it.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Cagr() {
  const [v, set] = useSaved('cagr', { start: 100_000, end: 250_000, years: 6 });
  const c = cagr(v.start, v.end, v.years);
  const a = absoluteReturn(v.start, v.end);
  return (
    <div className="split">
      <Card title="Growth between two values">
        <div className="form">
          <MoneyField label="Value at the start" value={v.start} onChange={(start) => set({ start })} min={0} />
          <MoneyField label="Value at the end" value={v.end} onChange={(end) => set({ end })} min={0} />
          <NumberField label="Years between them" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={0} max={100} />
        </div>
      </Card>
      <div className="stack">
        <Stats>
          <Stat big label="Growth per year (CAGR)" tip="The steady yearly rate that would turn the starting value into the ending value." value={c !== null ? signedPct(c, 2) : '—'} tone={tone(c)} />
          <Stat label="Total growth" value={a !== null ? signedPct(a) : '—'} tone={tone(a)} sub={a !== null && v.years > 0 ? `simple average ${signedPct(a / v.years)} a year` : undefined} />
          <Stat label="Multiple" value={v.start > 0 ? times(v.end / v.start, 2) : '—'} />
        </Stats>
        {c === null && <Note kind="warn">Enter a starting value and a number of years above zero.</Note>}
        <Card title="The working">
          <div className="formula">{`CAGR = (end ÷ start)^(1 ÷ years) − 1 = (${num(v.end, 0)} ÷ ${num(v.start, 0)})^(1 ÷ ${num(v.years, 2)}) − 1${c !== null ? ` = ${pct(c, 2)}` : ''}`}</div>
          <p className="small muted mt-s">
            CAGR is not the same as the simple average. Up 100% then down 50% averages +25% a year, yet you end exactly where you started: a CAGR of 0%. CAGR also hides the ride: two investments with the same CAGR can have very different
            ups and downs along the way. Use it only for a single starting amount; for several instalments use XIRR.
          </p>
        </Card>
      </div>
    </div>
  );
}

interface FlowRow {
  id: string;
  date: string;
  amount: number;
}

function Xirr() {
  const [v, set, reset] = useSaved<{ rows: FlowRow[] }>('xirr', {
    rows: [
      { id: 'a', date: '2023-01-10', amount: -100_000 },
      { id: 'b', date: '2023-07-10', amount: -50_000 },
      { id: 'c', date: '2024-03-15', amount: -75_000 },
      { id: 'd', date: '2025-01-20', amount: 30_000 },
      { id: 'e', date: todayIso(), amount: 280_000 },
    ],
  });
  const flows: DatedFlow[] = v.rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount)).map((r) => ({ date: r.date, amount: r.amount }));
  const res = xirr(flows);
  const put = flows.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
  const got = flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const paste = (text: string) => {
    const rows: FlowRow[] = [];
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(/[,\t;]/).map((x) => x.trim());
      const d = parseDate(parts[0] ?? '');
      const amt = Number((parts[1] ?? '').replace(/[,₹\s]/g, ''));
      if (d && Number.isFinite(amt) && amt !== 0) rows.push({ id: uid(), date: d, amount: amt });
    }
    if (rows.length) set({ rows });
  };
  return (
    <div className="split wide">
      <Card title="Dated cash flows" sub="money you put in is negative; money you received (or today's value) is positive" right={<button className="btn sm ghost" onClick={reset}>Example</button>} flush>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Date</th>
              <th className="r">Amount (₹)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input className="input" style={{ height: 28 }} type="date" aria-label="Date of this cash flow" value={r.date} onChange={(e) => set({ rows: v.rows.map((x) => (x.id === r.id ? { ...x, date: e.target.value } : x)) })} />
                </td>
                <td className="r">
                  <CellInput width={130} label="Amount" value={r.amount} onChange={(n) => n !== null && set({ rows: v.rows.map((x) => (x.id === r.id ? { ...x, amount: n } : x)) })} />
                </td>
                <td className="r">
                  <button className="btn sm ghost icon" aria-label="Remove this row" onClick={() => set({ rows: v.rows.filter((x) => x.id !== r.id) })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ padding: 10 }}>
          <button className="btn sm" onClick={() => set({ rows: [...v.rows, { id: uid(), date: todayIso(), amount: -10_000 }] })}>
            Add a row
          </button>
          <button className="btn sm ghost" onClick={() => set({ rows: [] })}>
            Clear
          </button>
        </div>
        <div style={{ padding: '0 10px 12px' }}>
          <TextField label="Or paste rows: date, amount (one per line)" value="" onChange={paste} placeholder="15/01/2024, -25000" hint="Paste from a spreadsheet; this replaces the rows above. Dates are read day-first." />
        </div>
      </Card>
      <div className="stack">
        <Stats>
          <Stat big label="Annual return (XIRR)" value={res.rate !== null ? signedPct(res.rate, 2) : 'n/a'} tone={tone(res.rate)} sub="per year, on the money while it was invested" />
          <Stat label="Total put in" value={compact(put)} />
          <Stat label="Total received" value={compact(got)} />
          <Stat label="Gain" value={compact(got - put)} tone={tone(got - put)} sub={put > 0 ? `${signedPct(got / put - 1)} on money put in` : undefined} />
        </Stats>
        {res.note && <Note kind={res.rate === null ? 'err' : 'warn'}>{res.note}</Note>}
        <Card title="What XIRR tells you">
          <p className="small dim">
            XIRR is the single yearly rate that, applied to every rupee from the day it went in to the day it came out, explains where you ended up. It is the right measure whenever money goes in or out at different times: SIPs, top-ups,
            partial withdrawals. It uses the same Actual/365 convention as Excel's XIRR function, so the answers will match.
          </p>
          <ul className="small dim" style={{ paddingLeft: 18, margin: 0 }}>
            <li>The last row should usually be today's value of the investment, as a positive number.</li>
            <li>Over periods shorter than a year XIRR annualises, which exaggerates: +5% in one month shows as about +80% a year.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function Invest() {
  const [params, setParams] = useSearchParams();
  const ids: TabId[] = ['sip', 'lumpsum', 'goal', 'swp', 'cagr', 'xirr'];
  const tab = (ids.includes(params.get('tab') as TabId) ? params.get('tab') : 'sip') as TabId;
  return (
    <Page tool="invest">
      <Tabs
        tabs={[
          { value: 'sip', label: 'SIP' },
          { value: 'lumpsum', label: 'Lump sum' },
          { value: 'goal', label: 'Plan for a goal' },
          { value: 'swp', label: 'Withdrawals (SWP)' },
          { value: 'cagr', label: 'CAGR' },
          { value: 'xirr', label: 'XIRR' },
        ]}
        value={tab}
        onChange={(t) => setParams(t === 'sip' ? {} : { tab: t }, { replace: true })}
      />
      {tab === 'sip' && <Sip />}
      {tab === 'lumpsum' && <Lumpsum />}
      {tab === 'goal' && <Goal />}
      {tab === 'swp' && <Swp />}
      {tab === 'cagr' && <Cagr />}
      {tab === 'xirr' && <Xirr />}
    </Page>
  );
}
