import { useState } from 'react';
import { LineChart, StackedColumns } from '../components/charts';
import { Page } from '../components/Page';
import { Card, KV, MoneyField, Note, NumberField, PercentField, Seg, SelectField, Stat, Stats } from '../components/ui';
import { download, toCsv } from '../lib/csv';
import { amortise, flatToReducingRate, loanFromEmi } from '../lib/finance/loans';
import { compact, duration, money, num, pct } from '../lib/format';
import { attempt } from '../lib/hooks';
import { useSaved } from '../lib/store';

interface Inputs {
  kind: 'home' | 'car' | 'personal' | 'education';
  principal: number;
  rate: number;
  years: number;
  extraMonthly: number;
  lump: number;
  lumpMonth: number;
  prepayMode: 'reduce-tenure' | 'reduce-emi';
  moratorium: number;
  moratoriumInterest: 'accrue' | 'pay';
  affordEmi: number;
  flatRate: number;
}

const PRESETS: Record<Inputs['kind'], Partial<Inputs>> = {
  home: { principal: 5_000_000, rate: 0.085, years: 20, moratorium: 0 },
  car: { principal: 800_000, rate: 0.095, years: 5, moratorium: 0 },
  personal: { principal: 300_000, rate: 0.13, years: 3, moratorium: 0 },
  education: { principal: 1_500_000, rate: 0.105, years: 10, moratorium: 30 },
};

export default function Loan() {
  const [v, set, reset] = useSaved<Inputs>('loan', { kind: 'home', principal: 5_000_000, rate: 0.085, years: 20, extraMonthly: 0, lump: 0, lumpMonth: 12, prepayMode: 'reduce-tenure', moratorium: 0, moratoriumInterest: 'accrue', affordEmi: 40_000, flatRate: 0.08 });
  const [view, setView] = useState<'yearly' | 'monthly'>('yearly');
  const months = Math.round(v.years * 12);
  const base = attempt(() => amortise({ principal: v.principal, annualRate: v.rate, months, moratoriumMonths: v.moratorium, moratoriumInterest: v.moratoriumInterest }));
  const hasPrepay = v.extraMonthly > 0 || v.lump > 0;
  const withPre = attempt(() => amortise({ principal: v.principal, annualRate: v.rate, months, moratoriumMonths: v.moratorium, moratoriumInterest: v.moratoriumInterest, extraMonthly: v.extraMonthly, prepayments: v.lump > 0 ? [{ month: v.lumpMonth, amount: v.lump }] : [], prepayMode: v.prepayMode }));
  const b = base.value;
  const r = withPre.value ?? b;
  const reducing = flatToReducingRate(v.flatRate, months);
  const exportCsv = () => r && download('loan_schedule.csv', toCsv(['month', 'opening_balance', 'payment', 'interest', 'principal', 'prepayment', 'closing_balance'], r.schedule.map((x) => [x.month, x.opening.toFixed(2), x.payment.toFixed(2), x.interest.toFixed(2), x.principal.toFixed(2), x.prepayment.toFixed(2), x.closing.toFixed(2)])));

  return (
    <Page tool="loan" actions={<button className="btn sm" onClick={reset}>Reset</button>}>
      <div className="split">
        <div className="stack">
          <Card title="The loan">
            <div className="form">
              <div className="field">
                <span className="label">Type</span>
                <Seg options={[{ value: 'home', label: 'Home' }, { value: 'car', label: 'Car' }, { value: 'personal', label: 'Personal' }, { value: 'education', label: 'Education' }]} value={v.kind} onChange={(kind) => set({ kind, ...PRESETS[kind] })} />
                <span className="hint">Choosing a type fills in typical figures, which you can change.</span>
              </div>
              <MoneyField label="Amount borrowed" value={v.principal} onChange={(principal) => set({ principal })} min={1} decimals={0} />
              <div className="form two">
                <PercentField label="Interest rate per year" value={v.rate} onChange={(rate) => set({ rate })} min={0} max={0.6} tip="The reducing-balance rate your lender quotes. Interest is charged each month on what you still owe." />
                <NumberField label="Repayment period" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={0.25} max={40} decimals={1} />
              </div>
              {v.kind === 'education' && (
                <div className="form two">
                  <NumberField label="No repayments for" suffix="months" value={v.moratorium} onChange={(moratorium) => set({ moratorium })} min={0} max={120} decimals={0} tip="The moratorium: course length plus the grace period (usually 6–12 months) before EMIs begin." />
                  <SelectField label="Interest during that time" value={v.moratoriumInterest} onChange={(moratoriumInterest) => set({ moratoriumInterest })} options={[{ value: 'accrue', label: 'Added to the loan' }, { value: 'pay', label: 'Paid every month' }]} tip="Banks charge simple interest during the moratorium. If unpaid, it is added to what you owe when EMIs start." />
                </div>
              )}
            </div>
          </Card>
          <Card title="Pay it off faster" sub="optional">
            <div className="form">
              <MoneyField label="Extra paid every month" value={v.extraMonthly} onChange={(extraMonthly) => set({ extraMonthly })} min={0} decimals={0} />
              <div className="form two">
                <MoneyField label="One-off part payment" value={v.lump} onChange={(lump) => set({ lump })} min={0} decimals={0} />
                <NumberField label="Paid in month" value={v.lumpMonth} onChange={(lumpMonth) => set({ lumpMonth })} min={1} max={480} decimals={0} />
              </div>
              <SelectField label="After a part payment" value={v.prepayMode} onChange={(prepayMode) => set({ prepayMode })} options={[{ value: 'reduce-tenure', label: 'Keep the EMI, finish sooner' }, { value: 'reduce-emi', label: 'Keep the period, lower the EMI' }]} hint="Finishing sooner saves more interest." />
            </div>
          </Card>
        </div>
        <div className="stack">
          {(base.error || withPre.error) && <Note kind="err">{base.error ?? withPre.error}</Note>}
          {b && r && (
            <>
              <Stats>
                <Stat big label="Monthly payment (EMI)" value={money(b.emi, 'INR', 0)} sub={v.moratorium > 0 ? `starting after ${v.moratorium} months` : undefined} />
                <Stat label="Total interest" value={compact(r.totalInterest)} sub={`${pct(r.totalInterest / v.principal, 0)} of the amount borrowed`} tone="neg" />
                <Stat label="Total you repay" value={compact(r.totalPaid)} />
                <Stat label="Loan finished in" value={duration(r.monthsTaken / 12)} />
                {hasPrepay && <Stat big label="Paying extra saves" value={compact(b.totalInterest - r.totalInterest)} tone="pos" sub={`and ${duration((b.monthsTaken - r.monthsTaken) / 12)} sooner`} />}
              </Stats>
              {v.moratorium > 0 && v.moratoriumInterest === 'accrue' && <Note kind="warn">Interest of {money(b.principalAtStart - v.principal, 'INR', 0)} builds up during the {v.moratorium}-month moratorium and is added to the loan, so EMIs are calculated on {money(b.principalAtStart, 'INR', 0)}. Paying the interest as you go avoids this.</Note>}
              <Card title="Where each year's payments go" sub="interest first, then the loan itself">
                <StackedColumns categories={r.yearly.map((y) => String(y.year))} series={[{ name: 'Interest', values: r.yearly.map((y) => y.interest), color: 'var(--s2)' }, { name: 'Loan repaid', values: r.yearly.map((y) => y.principal), color: 'var(--s1)' }]} height={230} />
              </Card>
              <Card title="Amount still owed">
                <LineChart
                  x={[0, ...b.yearly.map((y) => y.year)]}
                  series={[
                    ...(hasPrepay ? [{ name: 'With extra payments', values: [v.principal, ...b.yearly.map((y) => r.yearly[y.year - 1]?.closing ?? 0)] }] : []),
                    { name: hasPrepay ? 'Regular EMIs only' : 'Balance', values: [v.principal, ...b.yearly.map((y) => y.closing)], color: hasPrepay ? 'var(--text-3)' : undefined },
                  ]}
                  area={!hasPrepay}
                  height={220}
                  hideLegend={!hasPrepay}
                  xFormat={(y) => `Year ${y}`}
                />
              </Card>
              <Card title="Repayment schedule" right={<><Seg options={[{ value: 'yearly', label: 'By year' }, { value: 'monthly', label: 'By month' }]} value={view} onChange={setView} /><button className="btn sm" onClick={exportCsv}>Export CSV</button></>} flush>
                <div className="tbl-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table className="tbl compact">
                    <thead>
                      <tr>
                        <th>{view === 'yearly' ? 'Year' : 'Month'}</th>
                        {view === 'monthly' && <th className="r">Payment</th>}
                        <th className="r">Interest</th>
                        <th className="r">Loan repaid</th>
                        <th className="r">Still owed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view === 'yearly'
                        ? r.yearly.map((y) => (
                            <tr key={y.year}>
                              <td>{y.year}</td>
                              <td className="r">{money(y.interest, 'INR', 0)}</td>
                              <td className="r">{money(y.principal, 'INR', 0)}</td>
                              <td className="r">{money(y.closing, 'INR', 0)}</td>
                            </tr>
                          ))
                        : r.schedule.map((m) => (
                            <tr key={m.month}>
                              <td>{m.month}</td>
                              <td className="r">{money(m.payment + m.prepayment, 'INR', 0)}</td>
                              <td className="r">{money(m.interest, 'INR', 0)}</td>
                              <td className="r">{money(m.principal + m.prepayment, 'INR', 0)}</td>
                              <td className="r">{money(m.closing, 'INR', 0)}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
          <div className="grid cols-2">
            <Card title="How much can I borrow?">
              <div className="form">
                <MoneyField label="EMI you can afford" value={v.affordEmi} onChange={(affordEmi) => set({ affordEmi })} min={0} decimals={0} tip="Lenders usually want all your EMIs together to stay under about 40–50% of take-home pay." />
                <KV rows={[[`Loan this supports at ${pct(v.rate)} over ${num(v.years, 0)} years`, money(loanFromEmi(v.affordEmi, v.rate, months), 'INR', 0), { total: true }]]} />
              </div>
            </Card>
            <Card title="Quoted a “flat” rate?">
              <div className="form">
                <PercentField label="Flat rate quoted" value={v.flatRate} onChange={(flatRate) => set({ flatRate })} min={0} max={0.6} tip="A flat rate charges interest on the full amount for the whole period, even as you repay. Common in car and consumer loans, and it understates the true cost." />
                <KV rows={[['True (reducing-balance) rate', reducing !== null ? pct(reducing, 2) : '—', { total: true }]]} />
                <p className="tiny muted">Always compare loans on the reducing-balance rate.</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
