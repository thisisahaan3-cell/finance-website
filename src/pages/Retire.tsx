import { Link } from 'react-router-dom';
import { LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { Card, KV, MoneyField, Note, NumberField, PercentField, Stat, Stats } from '../components/ui';
import { requiredSip, sip } from '../lib/finance/tvm';
import { compact, money, num, pct } from '../lib/format';
import { useSaved, useStore } from '../lib/store';

interface Inputs {
  age: number;
  retireAge: number;
  lifeAge: number;
  expenses: number;
  inflation: number;
  preReturn: number;
  postReturn: number;
  saved: number;
  monthly: number;
  stepUp: number;
  otherIncome: number;
}

/** Corpus needed at retirement to fund inflation-linked spending until `years` later, earning `r` (annual rates, monthly steps). */
export function corpusNeeded(monthlySpend: number, years: number, r: number, inflation: number): number {
  const months = Math.round(years * 12);
  const rm = Math.pow(1 + r, 1 / 12) - 1;
  const gm = Math.pow(1 + inflation, 1 / 12) - 1;
  let pv = 0;
  let spend = monthlySpend;
  for (let m = 0; m < months; m++) {
    pv += spend / Math.pow(1 + rm, m);
    spend *= 1 + gm;
  }
  return pv;
}

export default function Retire() {
  const settings = useStore((s) => s.settings);
  const [v, set, reset] = useSaved<Inputs>('retire', { age: 30, retireAge: 60, lifeAge: 90, expenses: 60_000, inflation: settings.inflation > 0 ? Math.max(settings.inflation, 0.06) : 0.06, preReturn: 0.11, postReturn: 0.075, saved: 500_000, monthly: 20_000, stepUp: 0.06, otherIncome: 0 });
  const yearsToRetire = Math.max(0, v.retireAge - v.age);
  const yearsInRetirement = Math.max(0, v.lifeAge - v.retireAge);
  const valid = v.retireAge > v.age && v.lifeAge > v.retireAge;
  const spendAtRetire = Math.max(0, v.expenses - v.otherIncome) * Math.pow(1 + v.inflation, yearsToRetire);
  const need = valid ? corpusNeeded(spendAtRetire, yearsInRetirement, v.postReturn, v.inflation) : 0;
  const plan = valid ? sip({ monthly: v.monthly, annualRate: v.preReturn, years: yearsToRetire, stepUp: v.stepUp, initial: v.saved, convention: 'effective' }) : null;
  const have = plan?.value ?? 0;
  const gap = need - have;
  const required = valid ? requiredSip(need, { annualRate: v.preReturn, years: yearsToRetire, stepUp: v.stepUp, initial: v.saved, convention: 'effective' }) : null;
  const realPost = (1 + v.postReturn) / (1 + v.inflation) - 1;
  const multiple = v.expenses > 0 ? need / Math.pow(1 + v.inflation, yearsToRetire) / (Math.max(1, v.expenses - v.otherIncome) * 12) : null;

  // year-by-year path: build up, then draw down month by month (same timing as the corpus calculation)
  const ages: number[] = [];
  const path: number[] = [];
  if (valid && plan) {
    ages.push(v.age);
    path.push(v.saved);
    plan.schedule.forEach((y) => {
      ages.push(v.age + y.year);
      path.push(y.value);
    });
    const rm = Math.pow(1 + v.postReturn, 1 / 12) - 1;
    const gm = Math.pow(1 + v.inflation, 1 / 12) - 1;
    let bal = have;
    let spend = spendAtRetire;
    for (let y = 1; y <= yearsInRetirement; y++) {
      for (let m = 0; m < 12; m++) {
        bal = Math.max(0, bal - spend) * (1 + rm);
        spend *= 1 + gm;
      }
      ages.push(v.retireAge + y);
      path.push(bal < 1 ? 0 : bal);
    }
  }
  const runsOutAt = path.findIndex((b, i) => ages[i] > v.retireAge && b <= 0);

  return (
    <Page tool="retire" actions={<button className="btn sm" onClick={reset}>Reset</button>}>
      <div className="split">
        <div className="stack">
          <Card title="You">
            <div className="form three">
              <NumberField label="Age now" value={v.age} onChange={(age) => set({ age })} min={15} max={80} decimals={0} />
              <NumberField label="Retire at" value={v.retireAge} onChange={(retireAge) => set({ retireAge })} min={30} max={85} decimals={0} />
              <NumberField label="Plan until age" value={v.lifeAge} onChange={(lifeAge) => set({ lifeAge })} min={60} max={110} decimals={0} tip="Plan for a long life. Running out of money at 85 is a far worse mistake than leaving some behind." />
            </div>
          </Card>
          <Card title="Spending in retirement">
            <div className="form">
              <MoneyField label="Monthly expenses, at today's prices" value={v.expenses} onChange={(expenses) => set({ expenses })} min={0} decimals={0} tip="What your household would spend each month if you retired today. Leave out EMIs and children's costs that will have ended; add more for healthcare and travel." />
              <MoneyField label="Pension or rent you will receive, today's prices" value={v.otherIncome} onChange={(otherIncome) => set({ otherIncome })} min={0} decimals={0} />
              <PercentField label="Inflation" value={v.inflation} onChange={(inflation) => set({ inflation })} min={0} max={0.2} tip="How fast your cost of living rises. 6% is a common planning assumption for India; healthcare usually rises faster." />
            </div>
          </Card>
          <Card title="Saving and investing">
            <div className="form two">
              <MoneyField label="Already saved for retirement" value={v.saved} onChange={(saved) => set({ saved })} min={0} decimals={0} tip="EPF, PPF, NPS, mutual funds and shares set aside for retirement." />
              <MoneyField label="Invested every month" value={v.monthly} onChange={(monthly) => set({ monthly })} min={0} decimals={0} />
              <PercentField label="Yearly raise in that amount" value={v.stepUp} onChange={(stepUp) => set({ stepUp })} min={0} max={0.3} />
              <PercentField label="Return before retirement" value={v.preReturn} onChange={(preReturn) => set({ preReturn })} min={0} max={0.3} tip="While you are working you can hold more in shares, so a higher return is reasonable." />
              <PercentField label="Return after retirement" value={v.postReturn} onChange={(postReturn) => set({ postReturn })} min={0} max={0.3} tip="In retirement more money sits in safer assets, so assume a lower return." />
            </div>
          </Card>
        </div>
        <div className="stack">
          {!valid && <Note kind="err">Retirement age must be above your current age, and the planning age above the retirement age.</Note>}
          {valid && plan && (
            <>
              <Stats>
                <Stat big label="You will need" tip="The pot required on the day you retire to pay your inflation-linked expenses until the planning age." value={compact(need)} sub={`at age ${v.retireAge}`} />
                <Stat big label="You are on track for" value={compact(have)} tone={gap <= 0 ? 'pos' : 'neg'} sub={gap <= 0 ? `${compact(-gap)} more than needed` : `${compact(gap)} short`} />
                <Stat label="Monthly investment needed" value={required !== null ? money(required, 'INR', 0) : '—'} sub={required !== null ? (required <= v.monthly ? 'you already invest enough' : `${money(required - v.monthly, 'INR', 0)} more than now`) : undefined} tone={required !== null && required <= v.monthly ? 'pos' : ''} />
                <Stat label="First year's spending" value={`${compact(spendAtRetire)} / month`} sub={`today's ${compact(Math.max(0, v.expenses - v.otherIncome))} after ${yearsToRetire} years of inflation`} />
              </Stats>
              <Card title="Your money over your lifetime" sub="building up while working, drawing down in retirement">
                <LineChart x={ages} series={[{ name: 'Savings', values: path }]} area height={270} hideLegend xFormat={(a) => `Age ${a}`} />
                <p className="small muted">
                  {runsOutAt > 0 ? `On this plan the money runs out at about age ${ages[runsOutAt]}, ${v.lifeAge - ages[runsOutAt]} years before the planning age.` : `On this plan the money lasts to age ${v.lifeAge}, with ${compact(path[path.length - 1])} left over.`}
                </p>
              </Card>
              <Card title="The working">
                <KV
                  rows={[
                    ['Years until retirement', num(yearsToRetire, 0)],
                    ['Years in retirement', num(yearsInRetirement, 0)],
                    ['Return after inflation, in retirement', pct(realPost, 2), { tip: '(1 + return) ÷ (1 + inflation) − 1. If this is zero or negative, your savings must cover every year of spending with no help from growth.' }],
                    ['Pot needed, as a multiple of yearly spending', multiple !== null ? `${num(multiple, 0)}×` : '—', { tip: 'A common rule of thumb is 25–33 times your yearly expenses.' }],
                    ['Total you will have put in', compact(plan.invested)],
                    ['Growth on your investments', compact(plan.gain)],
                  ]}
                />
                <div className="row mt">
                  <Link className="btn sm" to="/simulate">Stress-test this with the Future simulator</Link>
                </div>
              </Card>
              <p className="plain">
                In plain words: retirement planning is two sums. First, how big a pot will pay for your lifestyle for {yearsInRetirement} years as prices keep rising? Second, will what you are saving grow into that pot? If there is a gap, the
                choices are to invest more, raise it faster each year, retire later, or spend less. Starting early matters most: money invested at 30 has thirty years to compound.
              </p>
              <p className="tiny muted">Assumes the same return every year and ignores tax. Real returns arrive unevenly, and poor returns just after you retire do the most damage.</p>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
