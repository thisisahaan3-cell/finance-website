import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { Card, CellInput, KV, MoneyField, Note, NumberField, PercentField, Stat, Stats, Tabs } from '../components/ui';
import { breakEven, straightLine, wdvRateFor, writtenDownValue } from '../lib/finance/corporate';
import { irr, mirr, npv, paybackPeriod, profitabilityIndex } from '../lib/finance/tvm';
import { compact, money, num, pct, times, tone } from '../lib/format';
import { attempt } from '../lib/hooks';
import { useSaved } from '../lib/store';

type TabId = 'project' | 'breakeven' | 'depreciation';

function Project() {
  const [v, set, reset] = useSaved('project', { flows: [-1_000_000, 250_000, 300_000, 350_000, 400_000, 450_000], rate: 0.12, finance: 0.1, reinvest: 0.1 });
  const flows = v.flows;
  const value = npv(v.rate, flows);
  const r = irr(flows);
  const m = mirr(flows, v.finance, v.reinvest);
  const pb = paybackPeriod(flows);
  const dpb = paybackPeriod(flows, v.rate);
  const pi = profitabilityIndex(v.rate, flows);
  const profile = useMemo(() => Array.from({ length: 41 }, (_, i) => i * 0.01).map((rate) => ({ rate, npv: npv(rate, flows) })), [flows]);
  const cumulative = flows.reduce<number[]>((acc, f, t) => [...acc, (acc[t - 1] ?? 0) + f / Math.pow(1 + v.rate, t)], []);
  return (
    <div className="split">
      <div className="stack">
        <Card title="Cash flows" sub="money out is negative, money in is positive" right={<button className="btn sm ghost" onClick={reset}>Reset</button>} flush>
          <table className="tbl compact">
            <thead>
              <tr>
                <th>When</th>
                <th className="r">Cash flow (₹)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flows.map((f, i) => (
                <tr key={i}>
                  <td>{i === 0 ? 'Today (investment)' : `End of year ${i}`}</td>
                  <td className="r">
                    <CellInput width={130} label={`Cash flow in year ${i}`} value={f} onChange={(n) => n !== null && set({ flows: flows.map((x, k) => (k === i ? n : x)) })} />
                  </td>
                  <td className="r">
                    {i > 1 && i === flows.length - 1 && (
                      <button className="btn sm ghost icon" aria-label="Remove the last year" onClick={() => set({ flows: flows.slice(0, -1) })}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 10 }}>
            <button className="btn sm" disabled={flows.length >= 41} onClick={() => set({ flows: [...flows, flows[flows.length - 1] ?? 0] })}>
              Add a year
            </button>
          </div>
        </Card>
        <Card title="Rates">
          <div className="form">
            <PercentField label="Required return (discount rate)" value={v.rate} onChange={(rate) => set({ rate })} min={-0.5} max={2} tip="The return you could earn elsewhere at similar risk: the hurdle this project must clear. For a company, usually its WACC." />
            <div className="form two">
              <PercentField label="Borrowing rate" value={v.finance} onChange={(finance) => set({ finance })} min={0} max={1} tip="Used by MIRR for the money put in." />
              <PercentField label="Reinvestment rate" value={v.reinvest} onChange={(reinvest) => set({ reinvest })} min={0} max={1} tip="Used by MIRR: what the cash coming out can realistically earn." />
            </div>
          </div>
        </Card>
      </div>
      <div className="stack">
        <Stats>
          <Stat big label="Net present value" tip="All cash flows converted to today's money and added up. Positive means the project earns more than your required return." value={money(value, 'INR', 0)} tone={tone(value)} sub={value >= 0 ? 'creates value: accept' : 'destroys value: reject'} />
          <Stat big label="IRR" tip="The discount rate at which NPV is exactly zero: the project's own yearly return." value={r.rate !== null ? pct(r.rate, 2) : 'n/a'} tone={r.rate !== null ? tone(r.rate - v.rate) : ''} sub={r.rate !== null ? (r.rate >= v.rate ? 'above the required return' : 'below the required return') : undefined} />
          <Stat label="MIRR" tip="A more realistic IRR: assumes cash received is reinvested at the reinvestment rate, not at the IRR itself." value={m !== null ? pct(m, 2) : 'n/a'} />
          <Stat label="Payback" tip="Years until the cash received equals the cash invested. Ignores the time value of money and everything after payback." value={pb !== null ? `${num(pb, 1)} yrs` : 'never'} />
          <Stat label="Discounted payback" tip="Payback measured in today's money." value={dpb !== null ? `${num(dpb, 1)} yrs` : 'never'} />
          <Stat label="Profitability index" tip="Present value of future cash ÷ the investment. Above 1 is worth doing; useful for ranking projects when money is limited." value={pi !== null ? times(pi, 2) : 'n/a'} />
        </Stats>
        {r.note && <Note kind={r.rate === null ? 'err' : 'warn'}>{r.note}</Note>}
        <div className="grid cols-2">
          <Card title="NPV at different required returns" sub="where the line crosses zero is the IRR">
            <LineChart x={profile.map((p) => pct(p.rate, 0))} series={[{ name: 'NPV', values: profile.map((p) => p.npv) }]} zeroLine height={220} hideLegend />
          </Card>
          <Card title="Running total in today's money" sub="crosses zero at the discounted payback">
            <BarChart data={cumulative.map((c, i) => ({ label: `Y${i}`, value: c, note: i === 0 ? 'Today' : `After year ${i}` }))} signed height={220} />
          </Card>
        </div>
        <p className="plain">
          In plain words: a rupee next year is worth less than a rupee today, because today's rupee could be invested meanwhile. NPV shrinks each future cash flow accordingly and adds everything up. When NPV and IRR disagree about which of
          two projects is better, trust NPV: it measures value in rupees, while IRR only measures a rate.
        </p>
      </div>
    </div>
  );
}

function BreakEven() {
  const [v, set] = useSaved('breakeven', { fixed: 1_200_000, price: 500, variable: 300, units: 9000, interest: 150_000 });
  const res = attempt(() => breakEven({ fixedCosts: v.fixed, pricePerUnit: v.price, variableCostPerUnit: v.variable, expectedUnits: v.units, interest: v.interest }));
  const r = res.value;
  const maxUnits = Math.max(v.units * 1.5, (r?.breakEvenUnits ?? 0) * 2, 10);
  const xs = Array.from({ length: 21 }, (_, i) => (maxUnits * i) / 20);
  return (
    <div className="split">
      <Card title="The business">
        <div className="form">
          <MoneyField label="Fixed costs per year" value={v.fixed} onChange={(fixed) => set({ fixed })} min={0} decimals={0} tip="Costs that do not change with sales: rent, salaries, insurance." />
          <div className="form two">
            <MoneyField label="Selling price per unit" value={v.price} onChange={(price) => set({ price })} min={0} />
            <MoneyField label="Variable cost per unit" value={v.variable} onChange={(variable) => set({ variable })} min={0} tip="Costs that rise with each unit sold: materials, packaging, commission." />
          </div>
          <NumberField label="Units you expect to sell" value={v.units} onChange={(units) => set({ units })} min={0} decimals={0} grouping="IN" />
          <MoneyField label="Interest on loans per year" value={v.interest} onChange={(interest) => set({ interest })} min={0} decimals={0} />
        </div>
      </Card>
      <div className="stack">
        {res.error && <Note kind="err">{res.error}</Note>}
        {r && (
          <>
            <Stats>
              <Stat big label="Break-even sales" value={`${num(r.breakEvenUnits, 0)} units`} sub={`${compact(r.breakEvenRevenue)} of revenue`} />
              <Stat label="Contribution per unit" tip="Selling price minus variable cost: what each sale contributes towards fixed costs and then profit." value={money(r.contributionPerUnit, 'INR', 2)} sub={`${pct(r.contributionMargin, 0)} of the price`} />
              <Stat label="Operating profit at expected sales" value={money(r.profitAtExpected, 'INR', 0)} tone={tone(r.profitAtExpected)} />
              <Stat label="Margin of safety" tip="How far sales can fall before the business starts losing money." value={pct(r.marginOfSafety, 0)} tone={tone(r.marginOfSafety)} />
            </Stats>
            <Card title="Revenue and total cost as sales grow" sub="profit begins where the lines cross">
              <LineChart
                x={xs.map((u) => num(u, 0))}
                series={[
                  { name: 'Revenue', values: xs.map((u) => u * v.price) },
                  { name: 'Total cost', values: xs.map((u) => v.fixed + u * v.variable), color: 'var(--s2)' },
                ]}
                height={250}
                xFormat={(u) => `${u} units`}
              />
            </Card>
            <Card title="Leverage: how sensitive is profit?">
              <KV
                rows={[
                  ['Operating leverage', r.dol !== null ? times(r.dol, 2) : 'n/a', { tip: 'Contribution ÷ operating profit. A value of 3× means a 10% rise in sales lifts operating profit by 30%, and a 10% fall cuts it by 30%.' }],
                  ['Financial leverage', r.dfl !== null ? times(r.dfl, 2) : 'n/a', { tip: 'Operating profit ÷ profit after interest. Debt magnifies swings in what is left for the owners.' }],
                  ['Combined leverage', r.dcl !== null ? times(r.dcl, 2) : 'n/a', { total: true, tip: 'The two multiplied: the % change in profit before tax for each 1% change in sales.' }],
                ]}
              />
              <p className="small muted mt-s">
                {r.dcl !== null
                  ? `A 10% change in sales would change profit before tax by about ${pct(r.dcl * 0.1, 0)}. High fixed costs and high debt both make good years better and bad years much worse.`
                  : 'Leverage is undefined at or below break-even, because there is no profit to magnify.'}
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Depreciation() {
  const [v, set] = useSaved('depreciation', { cost: 1_000_000, salvage: 100_000, life: 8, wdvRate: 0.15 });
  const slm = attempt(() => straightLine(v.cost, v.salvage, v.life));
  const wdv = attempt(() => writtenDownValue(v.cost, v.wdvRate, v.life));
  const matching = wdvRateFor(v.cost, v.salvage, v.life);
  const years = slm.value?.map((r) => String(r.year)) ?? [];
  return (
    <div className="split">
      <Card title="The asset">
        <div className="form">
          <MoneyField label="Cost" value={v.cost} onChange={(cost) => set({ cost })} min={0} decimals={0} />
          <MoneyField label="Value at the end of its life" value={v.salvage} onChange={(salvage) => set({ salvage })} min={0} decimals={0} tip="Scrap or resale value (salvage value)." />
          <NumberField label="Useful life" suffix="yrs" value={v.life} onChange={(life) => set({ life })} min={1} max={60} decimals={0} />
          <PercentField label="Written-down-value rate" value={v.wdvRate} onChange={(wdvRate) => set({ wdvRate })} min={0.01} max={0.99} tip="Income-tax block rates in India include 15% for general plant and machinery, 40% for computers, and 10% for buildings and furniture." />
          {matching !== null && (
            <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => set({ wdvRate: Number(matching.toFixed(4)) })}>
              Use {pct(matching, 1)}: the rate that reaches the end value in {v.life} years
            </button>
          )}
        </div>
      </Card>
      <div className="stack">
        {(slm.error || wdv.error) && <Note kind="err">{slm.error ?? wdv.error}</Note>}
        {slm.value && wdv.value && (
          <>
            <Card title="Book value over time">
              <LineChart
                x={['0', ...years]}
                series={[
                  { name: 'Straight line', values: [v.cost, ...slm.value.map((r) => r.closing)] },
                  { name: 'Written-down value', values: [v.cost, ...wdv.value.map((r) => r.closing)], color: 'var(--s2)' },
                ]}
                height={230}
                xFormat={(y) => `Year ${y}`}
              />
            </Card>
            <Card title="Year-by-year charge" flush>
              <div className="tbl-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="r">Straight line: charge</th>
                      <th className="r">Book value</th>
                      <th className="r">Written-down: charge</th>
                      <th className="r">Book value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slm.value.map((r, i) => (
                      <tr key={r.year}>
                        <td>{r.year}</td>
                        <td className="r">{money(r.depreciation, 'INR', 0)}</td>
                        <td className="r">{money(r.closing, 'INR', 0)}</td>
                        <td className="r">{money(wdv.value![i].depreciation, 'INR', 0)}</td>
                        <td className="r">{money(wdv.value![i].closing, 'INR', 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="plain">
              In plain words: depreciation spreads the cost of an asset over the years it is used. Straight line charges the same every year. Written-down value charges more in the early years, which lowers taxable profit sooner; this is why
              Indian tax law uses it. Either way no cash leaves the business when depreciation is charged: the cash left when the asset was bought.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Corporate() {
  const [params, setParams] = useSearchParams();
  const tab = (['project', 'breakeven', 'depreciation'].includes(params.get('tab') ?? '') ? params.get('tab') : 'project') as TabId;
  return (
    <Page tool="corporate">
      <Tabs
        tabs={[
          { value: 'project', label: 'Is a project worth it? (NPV, IRR)' },
          { value: 'breakeven', label: 'Break-even and leverage' },
          { value: 'depreciation', label: 'Depreciation' },
        ]}
        value={tab}
        onChange={(t) => setParams(t === 'project' ? {} : { tab: t }, { replace: true })}
      />
      {tab === 'project' && <Project />}
      {tab === 'breakeven' && <BreakEven />}
      {tab === 'depreciation' && <Depreciation />}
    </Page>
  );
}
