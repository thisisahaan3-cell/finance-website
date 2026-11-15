import { useSearchParams } from 'react-router-dom';
import { LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { Card, Check, KV, MoneyField, Note, SelectField, Stat, Stats, Tabs } from '../components/ui';
import { compareRegimes, computeRegime, EQUITY_CG, equityCapitalGainsTax, TAX_YEARS, type AgeBand, type OldRegimeDeductions, type RegimeTax } from '../lib/finance/tax';
import { compact, money, num, pct } from '../lib/format';
import { useSaved } from '../lib/store';

interface Inputs {
  yearId: string;
  age: AgeBand;
  salary: number;
  otherIncome: number;
  employerNps: number;
  d: Required<OldRegimeDeductions>;
  stcg: number;
  ltcg: number;
}

const DEFAULTS: Inputs = {
  yearId: TAX_YEARS[0].id,
  age: 'below60',
  salary: 1_800_000,
  otherIncome: 50_000,
  employerNps: 0,
  d: { sec80C: 150_000, nps80CCD1B: 0, healthSelf: 25_000, healthParents: 0, parentsSenior: false, hraExempt: 0, homeLoanInterest: 0, savingsInterest: 10_000, other: 0 },
  stcg: 80_000,
  ltcg: 300_000,
};

function RegimeCard({ title, t, best }: { title: string; t: RegimeTax; best: boolean }) {
  return (
    <Card title={title} right={best ? <span className="badge pos">Lower tax</span> : undefined}>
      <KV
        rows={[
          ['Total income', money(t.grossIncome, 'INR', 0)],
          ...t.deductions.map((x) => [`Less: ${x.label}`, money(-x.amount, 'INR', 0)] as [string, string]),
          ['Taxable income', money(t.taxableIncome, 'INR', 0), { total: true }],
          ['Tax on slabs', money(t.taxBeforeRebate, 'INR', 0)],
          t.rebate > 0 ? ['Less: rebate (section 87A)', money(-t.rebate, 'INR', 0), { tip: 'A rebate wipes out the tax for lower incomes. In the new regime it also softens the step just above the limit (marginal relief).' }] : null,
          t.surcharge > 0 ? ['Surcharge', money(t.surcharge, 'INR', 0), { tip: 'An extra charge on high incomes (above ₹50 lakh).' }] : null,
          ['Health and education cess (4%)', money(t.cess, 'INR', 0)],
          ['Total tax', money(t.totalTax, 'INR', 0), { total: true }],
        ]}
      />
      <table className="tbl compact mt">
        <thead>
          <tr>
            <th>Slab</th>
            <th className="r">Rate</th>
            <th className="r">Income in slab</th>
            <th className="r">Tax</th>
          </tr>
        </thead>
        <tbody>
          {t.slabLines.map((l) => (
            <tr key={l.from} className={l.amount === 0 ? 'muted' : ''}>
              <td>
                {compact(l.from, 'INR', 2)} – {Number.isFinite(l.to) ? compact(l.to, 'INR', 2) : 'above'}
              </td>
              <td className="r">{pct(l.rate, 0)}</td>
              <td className="r">{money(l.amount, 'INR', 0)}</td>
              <td className="r">{money(l.tax, 'INR', 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Income({ v, set }: { v: Inputs; set: (p: Partial<Inputs>) => void }) {
  const year = TAX_YEARS.find((y) => y.id === v.yearId) ?? TAX_YEARS[0];
  const input = { yearId: year.id, age: v.age, salary: v.salary, otherIncome: v.otherIncome, employerNps: v.employerNps, deductions: v.d };
  const c = compareRegimes(input);
  const best = c.better === 'new' ? c.newRegime : c.oldRegime;
  const setD = (patch: Partial<Inputs['d']>) => set({ d: { ...v.d, ...patch } });
  // tax at different salary levels, both regimes, same deductions
  const top = Math.max(3_000_000, v.salary * 1.6);
  const xs = Array.from({ length: 41 }, (_, i) => (top * i) / 40);
  const curve = xs.map((s) => ({ n: computeRegime({ ...input, salary: s }, 'new').totalTax, o: computeRegime({ ...input, salary: s }, 'old').totalTax }));

  return (
    <div className="split wide">
      <div className="stack">
        <Card title="About you">
          <div className="form">
            <div className="form two">
              <SelectField label="Financial year" value={v.yearId} onChange={(yearId) => set({ yearId })} options={TAX_YEARS.map((y) => ({ value: y.id, label: `${y.label} (${y.assessmentYear.replace(/ \(.*/, '')})` }))} />
              <SelectField label="Your age" value={v.age} onChange={(age) => set({ age })} options={[{ value: 'below60', label: 'Under 60' }, { value: '60to79', label: '60 to 79' }, { value: '80plus', label: '80 or older' }]} tip="Senior citizens get a higher tax-free limit in the old regime only." />
            </div>
            <MoneyField label="Salary or pension for the year" value={v.salary} onChange={(salary) => set({ salary })} min={0} decimals={0} tip="Gross salary before any deductions (your cost-to-company minus the employer's PF and gratuity contributions)." />
            <MoneyField label="Other income" value={v.otherIncome} onChange={(otherIncome) => set({ otherIncome })} min={0} decimals={0} tip="Bank interest, rent, freelance income and dividends. Not capital gains on shares: those are taxed separately (next tab)." />
            <MoneyField label="Employer's contribution to NPS" value={v.employerNps} onChange={(employerNps) => set({ employerNps })} min={0} decimals={0} tip="Section 80CCD(2). One of the few deductions allowed in both regimes." />
          </div>
        </Card>
        <Card title="Deductions" sub="count only in the old regime">
          <div className="form two">
            <MoneyField label="80C investments" value={v.d.sec80C} onChange={(sec80C) => setD({ sec80C })} min={0} decimals={0} tip="EPF, PPF, ELSS funds, life insurance premiums, children's tuition fees, home-loan principal. Capped at ₹1.5 lakh." />
            <MoneyField label="Own NPS contribution" value={v.d.nps80CCD1B} onChange={(nps80CCD1B) => setD({ nps80CCD1B })} min={0} decimals={0} tip="Section 80CCD(1B): an extra ₹50,000 on top of 80C." />
            <MoneyField label="Health insurance: self and family" value={v.d.healthSelf} onChange={(healthSelf) => setD({ healthSelf })} min={0} decimals={0} tip="Section 80D. Up to ₹25,000 (₹50,000 if you are 60 or older)." />
            <MoneyField label="Health insurance: parents" value={v.d.healthParents} onChange={(healthParents) => setD({ healthParents })} min={0} decimals={0} />
            <MoneyField label="HRA exemption" value={v.d.hraExempt} onChange={(hraExempt) => setD({ hraExempt })} min={0} decimals={0} tip="The exempt part of house rent allowance, as worked out by your employer (the least of: HRA received, rent paid minus 10% of basic pay, and 50% of basic pay in metros or 40% elsewhere)." />
            <MoneyField label="Home-loan interest" value={v.d.homeLoanInterest} onChange={(homeLoanInterest) => setD({ homeLoanInterest })} min={0} decimals={0} tip="Section 24(b), for a home you live in. Capped at ₹2 lakh." />
            <MoneyField label="Savings / deposit interest" value={v.d.savingsInterest} onChange={(savingsInterest) => setD({ savingsInterest })} min={0} decimals={0} tip="80TTA: up to ₹10,000 of savings-account interest. For seniors, 80TTB: up to ₹50,000 including fixed deposits." />
            <MoneyField label="Other deductions" value={v.d.other} onChange={(other) => setD({ other })} min={0} decimals={0} tip="Donations (80G), education-loan interest (80E) and others." />
          </div>
          <div className="mt-s">
            <Check label="My parents are 60 or older" checked={v.d.parentsSenior} onChange={(parentsSenior) => setD({ parentsSenior })} />
          </div>
        </Card>
      </div>
      <div className="stack">
        <Stats>
          <Stat big label="Better for you" value={c.better === 'new' ? 'New regime' : 'Old regime'} tone="pos" sub={c.saving > 0 ? `saves ${money(c.saving, 'INR', 0)} a year` : 'both come to the same'} />
          <Stat big label="Tax for the year" value={money(best.totalTax, 'INR', 0)} sub={`${pct(best.effectiveRate)} of your income`} />
          <Stat label="Take-home per month" value={money(best.monthlyTakeHome, 'INR', 0)} sub="before PF and other payroll deductions" />
          <Stat label="Tax on your next ₹100" tip="Your marginal rate: what a raise or extra income would be taxed at, including cess." value={`₹${num(best.marginalRate * 100, 1)}`} />
        </Stats>
        <Note>
          <b>{year.label}.</b> {year.note}
        </Note>
        <div className="grid cols-2">
          <RegimeCard title="New regime" t={c.newRegime} best={c.better === 'new'} />
          <RegimeCard title="Old regime" t={c.oldRegime} best={c.better === 'old'} />
        </div>
        <Card title="Tax at different salary levels" sub="with the deductions you have entered">
          <LineChart x={xs.map((s) => compact(s, 'INR', 1))} series={[{ name: 'New regime', values: curve.map((p) => p.n) }, { name: 'Old regime', values: curve.map((p) => p.o), color: 'var(--s2)' }]} height={230} />
          <p className="tiny muted">The old regime only wins when your deductions are large. Where the lines cross is your break-even.</p>
        </Card>
        <p className="plain">
          In plain words: India taxes income in slices. Only the part of your income inside each slab is taxed at that slab's rate, so a raise never reduces your take-home pay. The new regime has lower rates and almost no deductions; the old
          regime has higher rates but lets you subtract investments, insurance, rent and home-loan interest.
        </p>
        <p className="tiny muted">An estimate for resident individuals. Not included: capital gains and other special-rate income, HRA worked out from rent, losses brought forward, and the alternative minimum tax. Check with a tax professional before filing.</p>
      </div>
    </div>
  );
}

function Gains({ v, set }: { v: Inputs; set: (p: Partial<Inputs>) => void }) {
  const r = equityCapitalGainsTax(v.stcg, v.ltcg);
  const net = v.stcg + v.ltcg - r.total;
  return (
    <div className="split">
      <Card title="Gains on shares and equity funds this year">
        <div className="form">
          <MoneyField label="Short-term gains" value={v.stcg} onChange={(stcg) => set({ stcg })} decimals={0} tip="Profit on shares or equity funds sold within 12 months of buying. Enter a loss as a negative number." />
          <MoneyField label="Long-term gains" value={v.ltcg} onChange={(ltcg) => set({ ltcg })} decimals={0} tip="Profit on shares or equity funds held for more than 12 months." />
          <p className="tiny muted">Your Portfolio studio works these out from your trades automatically (Tax &amp; income tab).</p>
        </div>
      </Card>
      <div className="stack">
        <Stats>
          <Stat big label="Tax on these gains" value={money(r.total, 'INR', 0)} sub={v.stcg + v.ltcg > 0 ? `${pct(r.total / (v.stcg + v.ltcg))} of the gains` : undefined} />
          <Stat label="You keep" value={money(net, 'INR', 0)} />
        </Stats>
        <Card title="The working">
          <KV
            rows={[
              ['Short-term gains taxed at 20%', money(Math.max(0, r.stcgTax / EQUITY_CG.stcgRate), 'INR', 0)],
              ['Tax on short-term gains', money(r.stcgTax, 'INR', 0)],
              ['Long-term gains', money(Math.max(0, v.ltcg + Math.min(0, v.stcg)), 'INR', 0)],
              ['Less: yearly exemption', money(-Math.min(EQUITY_CG.ltcgExemption, Math.max(0, v.ltcg + Math.min(0, v.stcg))), 'INR', 0)],
              ['Long-term gains taxed at 12.5%', money(r.ltcgTaxable, 'INR', 0)],
              ['Tax on long-term gains', money(r.ltcgTax, 'INR', 0)],
              ['Cess (4%)', money(r.cess, 'INR', 0)],
              ['Total', money(r.total, 'INR', 0), { total: true }],
            ]}
          />
        </Card>
        <Note>{EQUITY_CG.note}</Note>
        <Card title="Things worth knowing">
          <ul className="small dim" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
            <li>The ₹1.25 lakh exemption is per person, per financial year, and cannot be carried forward. Booking long-term gains up to the limit each year (and buying back) resets your cost at no tax.</li>
            <li>A short-term loss can be set off against any capital gain; a long-term loss only against long-term gains. Unused losses carry forward for eight years if the return is filed on time.</li>
            <li>The section 87A rebate does not apply to these gains: they are taxed even if your other income is below the rebate limit (though the basic exemption limit can still be used by residents).</li>
            <li>Intraday trades and futures and options are business income, not capital gains, and are taxed at your slab rate.</li>
            <li>Debt funds bought after 1 April 2023 are taxed at your slab rate whatever the holding period.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function Tax() {
  const [v, set, reset] = useSaved<Inputs>('tax', DEFAULTS);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'gains' ? 'gains' : 'income';
  return (
    <Page tool="tax" actions={<button className="btn sm" onClick={reset}>Reset</button>}>
      <Tabs tabs={[{ value: 'income', label: 'Income tax: old against new regime' }, { value: 'gains', label: 'Tax on share-market gains' }]} value={tab} onChange={(t) => setParams(t === 'income' ? {} : { tab: t }, { replace: true })} />
      {tab === 'income' ? <Income v={v} set={set} /> : <Gains v={v} set={set} />}
    </Page>
  );
}
