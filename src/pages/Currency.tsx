import { useMemo } from 'react';
import { LineChart } from '../components/charts';
import { Page } from '../components/Page';
import { TickerSearch } from '../components/TickerSearch';
import { Card, ErrorNote, KV, Loading, Note, NumberField, Seg, SelectField, Source, Stat, Stats } from '../components/ui';
import { getChart, lastChange, type Range } from '../lib/data/api';
import { align, toDaily } from '../lib/data/series';
import { fxSymbol, shortSymbol } from '../lib/data/symbols';
import { date as fmtDate, money, num, pct, signedPct, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { rememberMeta, useSaved, useStore } from '../lib/store';

const CCYS = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED', 'SGD', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD'];
const NAMES: Record<string, string> = { INR: 'Indian rupee', USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', JPY: 'Japanese yen', AED: 'UAE dirham', SGD: 'Singapore dollar', AUD: 'Australian dollar', CAD: 'Canadian dollar', CHF: 'Swiss franc', CNY: 'Chinese yuan', HKD: 'Hong Kong dollar' };

interface Inputs {
  amount: number;
  from: string;
  to: string;
  range: Range;
  asset: string;
  assetRange: Range;
  buyPrice: number;
  sellPrice: number;
  buyFx: number;
  sellFx: number;
}

export default function Currency() {
  const [inp, set] = useSaved<Inputs>('currency', { amount: 1000, from: 'USD', to: 'INR', range: '5y', asset: '^GSPC', assetRange: '5y', buyPrice: 100, sellPrice: 150, buyFx: 75, sellFx: 90 });
  const meta = useStore((s) => s.symbolMeta);
  const same = inp.from === inp.to;
  const pair = useAsync(same ? null : () => getChart(fxSymbol(inp.from, inp.to), inp.range, '1d'), [inp.from, inp.to, inp.range]);
  const rate = pair.data ? lastChange(pair.data) : null;
  const series = pair.data ? toDaily(pair.data) : null;
  const move = series && series.close.length > 1 ? series.close[series.close.length - 1] / series.close[0] - 1 : null;
  const years = series && series.dates.length > 1 ? (Date.parse(series.dates[series.dates.length - 1]) - Date.parse(series.dates[0])) / (365.25 * 86_400_000) : 0;

  const asset = useAsync(
    async () => {
      const a = await getChart(inp.asset, inp.assetRange, '1d');
      const ccy = a.currency ?? 'USD';
      const fx = ccy === 'INR' ? null : await getChart(fxSymbol(ccy, 'INR'), inp.assetRange, '1d');
      return { a, fx, ccy };
    },
    [inp.asset, inp.assetRange],
  );
  const split = useMemo(() => {
    const d = asset.data;
    if (!d) return null;
    const a = toDaily(d.a);
    if (!d.fx) return { local: a.adj[a.adj.length - 1] / a.adj[0] - 1, fx: 0, total: a.adj[a.adj.length - 1] / a.adj[0] - 1, dates: a.dates, localIdx: a.adj.map((v) => (v / a.adj[0]) * 100), inrIdx: null as number[] | null, from: a.dates[0], to: a.dates[a.dates.length - 1], yrs: 0 };
    const al = align([a, toDaily(d.fx)], 'adj');
    const n = al.matrix.length;
    if (n < 2) return null;
    const local = al.matrix[n - 1][0] / al.matrix[0][0] - 1;
    const fx = al.matrix[n - 1][1] / al.matrix[0][1] - 1;
    return {
      local,
      fx,
      total: (1 + local) * (1 + fx) - 1,
      dates: al.dates,
      localIdx: al.matrix.map((r) => (r[0] / al.matrix[0][0]) * 100),
      inrIdx: al.matrix.map((r) => ((r[0] * r[1]) / (al.matrix[0][0] * al.matrix[0][1])) * 100),
      from: al.dates[0],
      to: al.dates[n - 1],
      yrs: (Date.parse(al.dates[n - 1]) - Date.parse(al.dates[0])) / (365.25 * 86_400_000),
    };
  }, [asset.data]);

  const manLocal = inp.buyPrice > 0 ? inp.sellPrice / inp.buyPrice - 1 : null;
  const manFx = inp.buyFx > 0 ? inp.sellFx / inp.buyFx - 1 : null;
  const manTotal = manLocal !== null && manFx !== null ? (1 + manLocal) * (1 + manFx) - 1 : null;
  const opts = CCYS.map((c) => ({ value: c, label: `${c} — ${NAMES[c]}` }));
  const ranges = [{ value: '1y', label: '1Y' }, { value: '5y', label: '5Y' }, { value: '10y', label: '10Y' }, { value: 'max', label: 'All' }];

  return (
    <Page tool="currency">
      <div className="grid cols-2">
        <Card title="Currency converter">
          <div className="form">
            <NumberField label="Amount" value={inp.amount} onChange={(amount) => set({ amount })} min={0} grouping={inp.from === 'INR' ? 'IN' : 'US'} />
            <div className="form two">
              <SelectField label="From" value={inp.from} onChange={(from) => set({ from })} options={opts} />
              <SelectField label="To" value={inp.to} onChange={(to) => set({ to })} options={opts} />
            </div>
            <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => set({ from: inp.to, to: inp.from })}>
              ⇄ Swap
            </button>
            {same ? (
              <Note>Choose two different currencies.</Note>
            ) : pair.loading && !pair.data ? (
              <Loading />
            ) : pair.error ? (
              <ErrorNote error={pair.error} retry={pair.reload} />
            ) : rate?.price ? (
              <>
                <div>
                  <div className="num" style={{ fontSize: 28, fontWeight: 600 }}>{money(inp.amount * rate.price, inp.to, 2)}</div>
                  <div className="small muted">
                    1 {inp.from} = {num(rate.price, rate.price < 10 ? 4 : 2)} {inp.to} · 1 {inp.to} = {num(1 / rate.price, 1 / rate.price < 10 ? 4 : 2)} {inp.from}
                    {rate.changePct !== null ? ` · ${signedPct(rate.changePct, 2)} today` : ''}
                  </div>
                </div>
                <p className="tiny muted">This is the mid-market rate. Banks, cards and remittance services add a margin of roughly 0.5–3% plus fees, so you will receive a little less.</p>
              </>
            ) : null}
          </div>
        </Card>
        <Card title={same ? 'Exchange rate' : `${inp.from} in ${inp.to}`} sub={move !== null ? `${signedPct(move)} over the period${years > 1.5 ? ` (${signedPct(Math.pow(1 + move, 1 / years) - 1)} a year)` : ''}` : undefined} right={<Seg options={ranges} value={inp.range} onChange={(range) => set({ range: range as Range })} label="Period" />}>
          {series ? <LineChart x={series.dates} series={[{ name: `${inp.to} per ${inp.from}`, values: series.close }]} yFormat={(v) => num(v, v < 10 ? 3 : 1)} area height={250} hideLegend /> : <p className="muted small">{same ? 'Pick two currencies to see the history.' : 'Loading…'}</p>}
          {inp.to === 'INR' && move !== null && <p className="tiny muted">{move > 0 ? `The rupee has lost value against the ${NAMES[inp.from].toLowerCase()} over this period, which adds to the rupee return of anything held in ${inp.from}.` : `The rupee has gained against the ${NAMES[inp.from].toLowerCase()} over this period, which reduces the rupee return of anything held in ${inp.from}.`}</p>}
        </Card>
      </div>

      <h2 className="mt mb-s">What a foreign investment really earned in rupees</h2>
      <p className="plain mb">An Indian investor in a foreign stock earns two things at once: the stock's own return, and the change in the exchange rate. They multiply together.</p>
      <div className="split">
        <Card title="Pick a foreign stock or index">
          <div className="form">
            <TickerSearch placeholder={`Currently ${inp.asset}. Search to change…`} onPick={(r) => { rememberMeta(r.symbol, { name: r.name }); set({ asset: r.symbol }); }} />
            <div className="chips">
              {[['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^FTSE', 'FTSE 100'], ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['GC=F', 'Gold (USD)']].map(([s, n]) => (
                <button key={s} className={'chip' + (inp.asset === s ? ' on' : '')} onClick={() => set({ asset: s })}>
                  {n}
                </button>
              ))}
            </div>
            <div className="field">
              <span className="label">Period</span>
              <Seg options={ranges} value={inp.assetRange} onChange={(assetRange) => set({ assetRange: assetRange as Range })} />
            </div>
          </div>
        </Card>
        <div className="stack">
          {asset.loading && !asset.data && <Loading height={120} />}
          {asset.error && <ErrorNote error={asset.error} retry={asset.reload} />}
          {split && asset.data && (
            <>
              <Stats>
                <Stat label={`${meta[inp.asset]?.name ?? asset.data.a.name} in ${asset.data.ccy}`} value={signedPct(split.local)} tone={tone(split.local)} sub="the investment itself" />
                <Stat label={asset.data.ccy === 'INR' ? 'Currency effect' : `${asset.data.ccy} against the rupee`} value={asset.data.ccy === 'INR' ? 'none' : signedPct(split.fx)} tone={tone(split.fx)} sub="the exchange rate" />
                <Stat big label="Return in rupees" value={signedPct(split.total)} tone={tone(split.total)} sub={split.yrs > 1.5 ? `${signedPct(Math.pow(1 + split.total, 1 / split.yrs) - 1)} a year` : `${fmtDate(split.from)} – ${fmtDate(split.to)}`} />
              </Stats>
              <Card title="Growth of 100" sub={`${fmtDate(split.from)} to ${fmtDate(split.to)}`}>
                <LineChart x={split.dates} series={[...(split.inrIdx ? [{ name: 'In rupees (what you earned)', values: split.inrIdx }] : []), { name: `In ${asset.data.ccy}`, values: split.localIdx, color: 'var(--text-3)' }]} yFormat={(v) => num(v, 0)} height={260} />
                {asset.data.ccy !== 'INR' && (
                  <div className="formula mt-s">
                    (1 + {pct(split.local, 1)}) × (1 + {pct(split.fx, 1)}) − 1 = {pct(split.total, 1)}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2 mt">
        <Card title="Work it out for your own trade">
          <div className="form two">
            <NumberField label="Buy price (foreign currency)" value={inp.buyPrice} onChange={(buyPrice) => set({ buyPrice })} min={0} />
            <NumberField label="Sell or current price" value={inp.sellPrice} onChange={(sellPrice) => set({ sellPrice })} min={0} />
            <NumberField label="Rupees per unit when you bought" value={inp.buyFx} onChange={(buyFx) => set({ buyFx })} min={0} />
            <NumberField label="Rupees per unit now" value={inp.sellFx} onChange={(sellFx) => set({ sellFx })} min={0} />
          </div>
          <div className="mt">
            <KV
              rows={[
                ['Return in the foreign currency', signedPct(manLocal), { tone: tone(manLocal) }],
                ['Change in the exchange rate', signedPct(manFx), { tone: tone(manFx) }],
                ['Return in rupees', signedPct(manTotal), { total: true, tone: tone(manTotal) }],
                ['Each unit: cost → value in rupees', `${money(inp.buyPrice * inp.buyFx, 'INR', 2)} → ${money(inp.sellPrice * inp.sellFx, 'INR', 2)}`],
              ]}
            />
          </div>
        </Card>
        <Card title="Investing abroad from India: the practical bits">
          <ul className="small dim" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
            <li>Residents can send up to US$250,000 abroad per financial year under the RBI's Liberalised Remittance Scheme (LRS).</li>
            <li>Tax is collected at source (TCS) on remittances for investment above ₹10 lakh in a year. It is not an extra tax: you claim it back against your income tax, but it ties up cash meanwhile.</li>
            <li>Gains on foreign shares are taxed differently from Indian listed shares: held over 24 months they are long-term (12.5%), otherwise they are added to your income and taxed at your slab rate.</li>
            <li>Foreign assets and income must be reported in Schedule FA of your tax return, however small.</li>
            <li>India-listed funds and ETFs that hold foreign shares are a simpler route for small amounts, with no remittance needed.</li>
          </ul>
          <p className="tiny muted mt-s">Rules change. Confirm the current LRS limit and TCS rate with your bank before remitting.</p>
        </Card>
      </div>
      <div className="mt">
        <Source at={pair.data?.fetchedAt} />
      </div>
      <p className="tiny muted">{shortSymbol(inp.asset)}: total-return prices where the provider supplies them (indices are price-only).</p>
    </Page>
  );
}
