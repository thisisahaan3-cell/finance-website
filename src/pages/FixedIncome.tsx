import { useSearchParams } from 'react-router-dom';
import { LineChart, StackedColumns } from '../components/charts';
import { Page } from '../components/Page';
import { Card, KV, MoneyField, Note, NumberField, PercentField, SelectField, Stat, Stats, Tabs } from '../components/ui';
import { bondAnalytics, bondPrice, bondYtm, fdMaturity, postTaxYield, ppf, rdMaturity } from '../lib/finance/fixedIncome';
import { realReturn } from '../lib/finance/tvm';
import { money, num, pct, signedPct, tone } from '../lib/format';
import { attempt } from '../lib/hooks';
import { useSaved, useStore } from '../lib/store';

type TabId = 'deposits' | 'bonds';

function Deposits() {
  const infl = useStore((s) => s.settings.inflation);
  const [v, set] = useSaved('deposits', { fd: 500_000, fdRate: 0.07, fdYears: 5, comp: '4', tax: 0.3, rd: 10_000, rdRate: 0.068, rdMonths: 36, ppfYearly: 150_000, ppfRate: 0.071, ppfYears: 15 });
  const fd = attempt(() => fdMaturity(v.fd, v.fdRate, v.fdYears, Number(v.comp)));
  const rd = attempt(() => rdMaturity(v.rd, v.rdRate, v.rdMonths));
  const pp = attempt(() => ppf(v.ppfYearly, v.ppfRate, v.ppfYears));
  const after = fd.value ? postTaxYield(fd.value.effectiveYield, v.tax) : null;
  const real = after !== null ? realReturn(after, infl) : null;
  return (
    <div className="stack">
      <div className="grid cols-3">
        <Card title="Fixed deposit (FD)">
          <div className="form">
            <MoneyField label="Amount deposited" value={v.fd} onChange={(x) => set({ fd: x })} min={0} decimals={0} />
            <div className="form two">
              <PercentField label="Interest rate" value={v.fdRate} onChange={(x) => set({ fdRate: x })} min={0} max={0.3} />
              <NumberField label="Period" suffix="yrs" value={v.fdYears} onChange={(x) => set({ fdYears: x })} min={0.1} max={30} />
            </div>
            <SelectField label="Interest added" value={v.comp} onChange={(comp) => set({ comp })} options={[{ value: '4', label: 'Every quarter (most banks)' }, { value: '12', label: 'Every month' }, { value: '2', label: 'Twice a year' }, { value: '1', label: 'Once a year' }]} />
            <PercentField label="Your income-tax rate" value={v.tax} onChange={(x) => set({ tax: x })} min={0} max={0.45} tip="FD interest is added to your income and taxed at your slab rate each year." />
          </div>
          {fd.value && (
            <div className="mt">
              <KV
                rows={[
                  ['Maturity value', money(fd.value.maturity, 'INR', 0), { total: true }],
                  ['Interest earned', money(fd.value.interest, 'INR', 0)],
                  ['Effective yearly yield', pct(fd.value.effectiveYield, 2), { tip: 'The quoted rate after allowing for interest being added during the year.' }],
                  ['Yield after tax', pct(after, 2)],
                  ['Yield after tax and inflation', signedPct(real, 2), { tone: tone(real), tip: `Using ${pct(infl, 0)} inflation from your settings. If this is negative, the deposit is losing purchasing power.` }],
                ]}
              />
            </div>
          )}
          {fd.error && <Note kind="err" className="mt-s">{fd.error}</Note>}
        </Card>
        <Card title="Recurring deposit (RD)">
          <div className="form">
            <MoneyField label="Deposited every month" value={v.rd} onChange={(x) => set({ rd: x })} min={0} decimals={0} />
            <div className="form two">
              <PercentField label="Interest rate" value={v.rdRate} onChange={(x) => set({ rdRate: x })} min={0} max={0.3} />
              <NumberField label="Period" suffix="months" value={v.rdMonths} onChange={(x) => set({ rdMonths: x })} min={1} max={240} decimals={0} />
            </div>
          </div>
          {rd.value && (
            <div className="mt">
              <KV
                rows={[
                  ['Maturity value', money(rd.value.maturity, 'INR', 0), { total: true }],
                  ['You deposit', money(rd.value.invested, 'INR', 0)],
                  ['Interest earned', money(rd.value.interest, 'INR', 0)],
                ]}
              />
              <p className="tiny muted mt-s">Each instalment earns interest compounded quarterly from the month it is paid, the method Indian banks use.</p>
            </div>
          )}
          {rd.error && <Note kind="err" className="mt-s">{rd.error}</Note>}
        </Card>
        <Card title="Public Provident Fund (PPF)">
          <div className="form">
            <MoneyField label="Deposited every year" value={v.ppfYearly} onChange={(x) => set({ ppfYearly: x })} min={0} max={150_000} decimals={0} hint="Limit: ₹1.5 lakh a year" />
            <div className="form two">
              <PercentField label="Interest rate" value={v.ppfRate} onChange={(x) => set({ ppfRate: x })} min={0} max={0.2} tip="Set by the government each quarter; 7.1% since April 2020. Check the current rate." />
              <NumberField label="Period" suffix="yrs" value={v.ppfYears} onChange={(x) => set({ ppfYears: x })} min={15} max={50} decimals={0} hint="15 years minimum" />
            </div>
          </div>
          {pp.value && (
            <div className="mt">
              <KV
                rows={[
                  ['Maturity value', money(pp.value.maturity, 'INR', 0), { total: true }],
                  ['You deposit', money(pp.value.invested, 'INR', 0)],
                  ['Interest earned (tax-free)', money(pp.value.interest, 'INR', 0)],
                ]}
              />
              <p className="tiny muted mt-s">Assumes each deposit is made by 5 April. PPF interest and maturity are tax-free, which makes its rate worth more than the same FD rate.</p>
            </div>
          )}
        </Card>
      </div>
      {pp.value && (
        <Card title="PPF growth" sub="deposits and tax-free interest">
          <StackedColumns categories={pp.value.schedule.map((y) => String(y.year))} series={[{ name: 'Your deposits', values: pp.value.schedule.map((y) => y.invested), color: 'var(--s1)' }, { name: 'Interest', values: pp.value.schedule.map((y) => y.value - y.invested), color: 'var(--s3)' }]} height={210} />
        </Card>
      )}
      <p className="plain">In plain words: deposits are safe and predictable, which makes them right for money you need within a few years and for your emergency fund. Over long periods their return after tax barely keeps up with rising prices, so they preserve money rather than grow it.</p>
    </div>
  );
}

function Bonds() {
  const [v, set] = useSaved('bond', { face: 1000, coupon: 0.0718, years: 10, freq: '2', mode: 'price' as 'price' | 'yield', price: 985, ytm: 0.074, shock: 0.01 });
  const b = { face: v.face, couponRate: v.coupon, years: v.years, frequency: Number(v.freq) };
  const ytm = v.mode === 'price' ? bondYtm(b, v.price) : v.ytm;
  const a = ytm !== null && v.face > 0 && v.years > 0 ? attempt(() => bondAnalytics(b, ytm)).value : null;
  const ys = Array.from({ length: 31 }, (_, i) => Math.max(0.0001, (ytm ?? 0.07) - 0.03 + i * 0.002));
  const repriced = a && ytm !== null ? bondPrice(b, ytm + v.shock) : null;
  return (
    <div className="split">
      <Card title="The bond">
        <div className="form">
          <div className="form two">
            <NumberField label="Face value" prefix="₹" value={v.face} onChange={(face) => set({ face })} min={0} grouping="IN" tip="The amount repaid at maturity. Coupons are a percentage of this." />
            <PercentField label="Coupon rate" value={v.coupon} onChange={(coupon) => set({ coupon })} min={0} max={0.5} tip="The yearly interest the bond pays, as a share of face value." />
            <NumberField label="Years to maturity" suffix="yrs" value={v.years} onChange={(years) => set({ years })} min={0.5} max={50} decimals={1} />
            <SelectField label="Coupons paid" value={v.freq} onChange={(freq) => set({ freq })} options={[{ value: '2', label: 'Twice a year (G-secs)' }, { value: '1', label: 'Once a year' }, { value: '4', label: 'Every quarter' }]} />
          </div>
          <SelectField label="I know the…" value={v.mode} onChange={(mode) => set({ mode })} options={[{ value: 'price', label: 'Market price (work out the yield)' }, { value: 'yield', label: 'Yield (work out the price)' }]} />
          {v.mode === 'price' ? <NumberField label="Market price" prefix="₹" value={v.price} onChange={(price) => set({ price })} min={0} /> : <PercentField label="Yield to maturity" value={v.ytm} onChange={(x) => set({ ytm: x })} min={-0.05} max={0.6} />}
          <PercentField label="If yields change by" value={v.shock} onChange={(shock) => set({ shock })} min={-0.1} max={0.1} tip="Try +1% or −1% to see how sensitive the price is." />
        </div>
      </Card>
      <div className="stack">
        {ytm === null && <Note kind="err">No yield reproduces that price for this bond. Check the price and the face value.</Note>}
        {a && ytm !== null && (
          <>
            <Stats>
              <Stat big label={v.mode === 'price' ? 'Yield to maturity' : 'Price'} tip="Yield to maturity: the yearly return if you buy at this price, hold to maturity and reinvest every coupon at the same yield." value={v.mode === 'price' ? pct(ytm, 3) : `₹${num(a.price, 2)}`} sub={a.price < v.face ? 'trading below face value (at a discount)' : a.price > v.face ? 'trading above face value (at a premium)' : 'at face value'} />
              <Stat label="Current yield" tip="Yearly coupon ÷ price. Ignores any gain or loss at maturity." value={pct(a.currentYield, 2)} />
              <Stat label="Duration" tip="Modified duration: the approximate % fall in price for a 1 percentage-point rise in yield. Longer duration = more interest-rate risk." value={num(a.modified, 2)} sub={`Macaulay ${num(a.macaulay, 2)} years`} />
              <Stat label="Convexity" tip="How much the duration itself changes as yields move. It makes the price fall a little less, and rise a little more, than duration alone predicts." value={num(a.convexity, 1)} />
            </Stats>
            <Card title="Price as yields change" sub="when interest rates rise, existing bonds fall in price">
              <LineChart x={ys.map((y) => pct(y, 1))} series={[{ name: 'Price', values: ys.map((y) => bondPrice(b, y)) }]} height={230} hideLegend yFormat={(p) => num(p, 0)} />
            </Card>
            <Card title={`If yields move ${signedPct(v.shock, 2)}`}>
              <KV
                rows={[
                  ['Price now', `₹${num(a.price, 2)}`],
                  ['Estimate from duration alone', `₹${num(a.price * (1 - a.modified * v.shock), 2)}`],
                  ['Estimate with convexity', `₹${num(a.priceForShift(v.shock), 2)}`],
                  ['Exact new price', `₹${num(repriced, 2)}`, { total: true }],
                  ['Change', signedPct(repriced !== null ? repriced / a.price - 1 : null, 2), { tone: tone(repriced !== null ? repriced - a.price : null) }],
                ]}
              />
            </Card>
            <p className="plain">
              In plain words: a bond is a loan you make. The coupon is fixed, so when new bonds start paying more, yours becomes less attractive and its price drops until its yield matches. The longer the bond, the harder it falls: that
              is what duration measures. If you hold to maturity and the issuer does not default, you still get every coupon and your money back.
            </p>
            <p className="tiny muted">Priced on a coupon date (no accrued interest). Yield compounds at the coupon frequency, the market convention.</p>
          </>
        )}
        <Card title="Where bonds fit" className="quiet">
          <p className="small dim" style={{ margin: 0 }}>
            Individuals in India can buy government bonds directly through RBI Retail Direct, or hold them through debt mutual funds and gilt ETFs. A debt fund's “modified duration” on its factsheet tells you exactly this sensitivity:
            a fund with a duration of 6 loses about 6% if yields rise 1 point.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function FixedIncome() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'bonds' ? 'bonds' : 'deposits';
  return (
    <Page tool="fixed">
      <Tabs tabs={[{ value: 'deposits', label: 'FD, RD and PPF' }, { value: 'bonds', label: 'Bond price, yield and duration' }]} value={tab} onChange={(t) => setParams(t === 'deposits' ? {} : { tab: t }, { replace: true })} />
      {tab === 'deposits' ? <Deposits /> : <Bonds />}
    </Page>
  );
}
