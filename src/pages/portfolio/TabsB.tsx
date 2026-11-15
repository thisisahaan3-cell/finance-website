import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, seriesColor } from '../../components/charts';
import { Card, Check, Empty, KV, Loading, MoneyField, Note, Seg, Stat, Stats } from '../../components/ui';
import { capBucket, shortSymbol } from '../../lib/data/symbols';
import { concentration, groupWeights, rebalance, type Trade } from '../../lib/finance/portfolio';
import { money, num, pct, signedPct } from '../../lib/format';
import { attempt } from '../../lib/hooks';
import { isFund, nameOf, sectorOf } from '../../lib/portfolioData';
import { patchPortfolio, useSaved, useStore } from '../../lib/store';
import type { TabProps } from './Studio';

type GroupBy = 'stock' | 'sector' | 'industry' | 'cap' | 'currency';

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'sector', label: 'Sector' },
  { value: 'industry', label: 'Industry' },
  { value: 'cap', label: 'Company size' },
  { value: 'currency', label: 'Currency' },
];

export function AllocationTab({ p, live, loading, setTab }: TabProps) {
  const meta = useStore((s) => s.symbolMeta);
  const settings = useStore((s) => s.settings);
  const [by, setBy] = useState<GroupBy>('sector');
  const v = live?.valuation;

  const positions = useMemo(() => (v?.positions ?? []).filter((x) => x.value !== null && x.value > 0), [v]);
  const targetTotal = Object.values(p.targets).reduce((s, x) => s + (x || 0), 0) + (p.cashTarget || 0);

  if (!p.txns.length) return <Card><Empty title="Add holdings first"><p>Allocation shows how your money is spread once you have recorded some stocks.</p></Empty></Card>;
  if (!v) return loading ? <Loading label="Fetching live prices…" height={160} /> : null;

  const keyOf = (symbol: string): string => {
    const m = meta[symbol];
    if (by === 'stock') return symbol;
    if (by === 'sector') return sectorOf(symbol);
    if (by === 'industry') return m?.industry ?? (isFund(symbol) ? 'ETF / fund' : 'Unclassified');
    if (by === 'currency') return live?.quotes[symbol]?.currency ?? m?.currency ?? p.currency;
    return isFund(symbol) ? 'ETF / fund' : capBucket(m?.marketCap ?? live?.quotes[symbol]?.marketCap, m?.currency ?? live?.quotes[symbol]?.currency, settings.largeCapMinCr, settings.midCapMinCr);
  };
  const groups = groupWeights(positions, (x) => keyOf(x.symbol), v.total);
  if (v.cash > 0) groups.push({ key: 'Cash', value: v.cash, weight: v.cash / v.total });
  const stockWeights = positions.map((x) => x.value! / v.holdingsValue);
  const conc = concentration(stockWeights);
  const sectors = groupWeights(positions, (x) => sectorOf(x.symbol), v.holdingsValue);
  const topSector = sectors[0];

  const flags: string[] = [];
  if (conc.top1 > 0.2) flags.push(`Your largest holding is ${pct(conc.top1, 0)} of your stocks. A single bad result there would move the whole portfolio.`);
  if (topSector && topSector.weight > 0.35 && topSector.key !== 'ETF / fund' && topSector.key !== 'Unclassified') flags.push(`${pct(topSector.weight, 0)} sits in ${topSector.key}. Stocks in one sector tend to fall together.`);
  if (positions.length >= 3 && conc.effectiveHoldings < Math.min(8, positions.length * 0.6)) flags.push(`You hold ${positions.length} stocks but the money is spread as if there were only about ${num(conc.effectiveHoldings, 1)} equal ones.`);
  if (positions.length < 8 && !positions.some((x) => isFund(x.symbol))) flags.push('Fewer than about 10–15 stocks leaves a lot of company-specific risk that diversification could remove for free.');

  const setTarget = (symbol: string, value: number) => patchPortfolio(p.id, (x) => ({ ...x, targets: { ...x.targets, [symbol]: value } }));
  const applyAll = (fn: (symbol: string, i: number) => number, cash = 0) =>
    patchPortfolio(p.id, (x) => ({ ...x, targets: Object.fromEntries(positions.map((pos, i) => [pos.symbol, Number(fn(pos.symbol, i).toFixed(2))])), cashTarget: cash }));

  return (
    <div className="stack">
      <Stats>
        <Stat label="Stocks held" value={positions.length} />
        <Stat label="Effective holdings" tip="How many equal-sized holdings would be as concentrated as your portfolio (1 ÷ the sum of squared weights). If this is far below the number of stocks you hold, a few positions dominate." value={num(conc.effectiveHoldings, 1)} />
        <Stat label="Largest holding" value={pct(conc.top1)} sub={positions[0] ? shortSymbol(positions[0].symbol) : ''} />
        <Stat label="Top 5 holdings" value={pct(conc.top5)} />
        <Stat label="Largest sector" value={topSector ? pct(topSector.weight) : '—'} sub={topSector?.key} />
        <Stat label="Cash" value={pct(v.total > 0 ? v.cash / v.total : 0)} />
      </Stats>
      {flags.length > 0 && (
        <Note kind="warn">
          <b>Concentration check</b> (rules of thumb, not rules):
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Note>
      )}
      <div className="grid cols-2">
        <Card title="Where the money is" right={<Seg options={GROUPS} value={by} onChange={setBy} label="Group by" />}>
          <BarList
            items={groups.map((g, i) => ({
              label: by === 'stock' && g.key !== 'Cash' ? shortSymbol(g.key) : g.key,
              title: by === 'stock' ? nameOf(g.key) : `${money(g.value, p.currency, 0)}`,
              share: g.weight,
              display: pct(g.weight),
              color: g.key === 'Cash' ? 'var(--text-3)' : by === 'stock' ? 'var(--s1)' : seriesColor(i),
            }))}
          />
          {by === 'cap' && (
            <p className="tiny muted mt-s">
              Size buckets use rupee cut-offs (large ≥ ₹{num(settings.largeCapMinCr, 0)} Cr, mid ≥ ₹{num(settings.midCapMinCr, 0)} Cr) as a stand-in for SEBI's rank-based definition. Change them in Data &amp; settings.
            </p>
          )}
          {(by === 'sector' || by === 'industry') && <p className="tiny muted mt-s">Sector and industry labels follow the data provider's classification.</p>}
        </Card>
        <Card
          title="Target weights"
          sub="what share each stock should have"
          right={
            <>
              <button className="btn sm" onClick={() => applyAll(() => (100 - (p.cashTarget || 0)) / positions.length, p.cashTarget || 0)}>
                Equal
              </button>
              <button className="btn sm" onClick={() => applyAll((s) => ((positions.find((x) => x.symbol === s)!.value ?? 0) / v.total) * 100, Number(((v.cash / v.total) * 100).toFixed(2)))}>
                Match current
              </button>
              <button className="btn sm ghost" onClick={() => patchPortfolio(p.id, (x) => ({ ...x, targets: {}, cashTarget: 0 }))}>
                Clear
              </button>
            </>
          }
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="r">Now</th>
                  <th className="r">Target %</th>
                  <th className="r">Gap</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((x) => {
                  const now = (x.value! / v.total) * 100;
                  const target = p.targets[x.symbol];
                  const gap = target === undefined ? null : now - target;
                  return (
                    <tr key={x.symbol}>
                      <td>{shortSymbol(x.symbol)}</td>
                      <td className="r">{num(now, 1)}%</td>
                      <td className="r">
                        <input
                          className="cell"
                          inputMode="decimal"
                          aria-label={`Target weight for ${x.symbol}`}
                          value={target ?? ''}
                          placeholder="—"
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (e.target.value === '') patchPortfolio(p.id, (y) => { const t = { ...y.targets }; delete t[x.symbol]; return { ...y, targets: t }; });
                            else if (Number.isFinite(n) && n >= 0 && n <= 100) setTarget(x.symbol, n);
                          }}
                        />
                      </td>
                      <td className={'r ' + (gap === null ? '' : Math.abs(gap) < 1 ? 'muted' : gap > 0 ? 'neg' : 'pos')}>{gap === null ? '—' : `${gap > 0 ? '+' : ''}${num(gap, 1)} pts`}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Cash</td>
                  <td className="r">{num(v.total > 0 ? (v.cash / v.total) * 100 : 0, 1)}%</td>
                  <td className="r">
                    <input
                      className="cell"
                      inputMode="decimal"
                      aria-label="Target weight for cash"
                      value={p.cashTarget || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const n = Number(e.target.value || 0);
                        if (Number.isFinite(n) && n >= 0 && n <= 100) patchPortfolio(p.id, (y) => ({ ...y, cashTarget: n }));
                      }}
                    />
                  </td>
                  <td />
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="r">100%</td>
                  <td className={'r ' + (Math.abs(targetTotal - 100) < 0.05 ? 'pos' : targetTotal ? 'neg' : '')}>{num(targetTotal, 1)}%</td>
                  <td className="r small">{Math.abs(targetTotal - 100) < 0.05 ? 'adds up' : targetTotal ? `${targetTotal > 100 ? 'over' : 'short'} by ${num(Math.abs(100 - targetTotal), 1)}` : ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="row" style={{ padding: 12 }}>
            <button className="btn sm primary" disabled={Math.abs(targetTotal - 100) >= 0.05} onClick={() => setTab('rebalance')}>
              Work out the trades
            </button>
            <Link className="btn sm" to={`/optimizer?portfolio=${p.id}`}>
              Let the optimiser suggest weights
            </Link>
          </div>
        </Card>
      </div>
      <p className="plain">
        In plain words: diversification means not letting one stock, sector or type of company decide your fate. Targets are your plan for how the portfolio <i>should</i> look; the gap column shows how far prices have pushed it away
        from that plan (a positive gap means the stock has grown past its target).
      </p>
    </div>
  );
}

/* ---------- Rebalance ---------- */

interface RebalanceInputs {
  newMoney: number;
  mode: 'full' | 'buy-only';
  wholeShares: boolean;
}

export function RebalanceTab({ p, live, loading, setTab }: TabProps) {
  const [inp, set] = useSaved<RebalanceInputs>(`rebalance:${p.id}`, { newMoney: 0, mode: 'buy-only', wholeShares: true });
  const v = live?.valuation;
  const targetTotal = Object.values(p.targets).reduce((s, x) => s + (x || 0), 0) + (p.cashTarget || 0);
  const hasTargets = Object.keys(p.targets).length > 0;

  const result = useMemo(() => {
    if (!v || !live) return null;
    const assets = v.positions
      .filter((x) => x.value !== null && x.price !== null)
      .map((x) => ({ symbol: x.symbol, value: x.value!, price: x.value! / x.qty, target: (p.targets[x.symbol] ?? 0) / 100 }));
    return attempt(() => rebalance({ assets, cash: v.cash, cashTarget: (p.cashTarget || 0) / 100, newMoney: inp.newMoney || 0, mode: inp.mode, wholeShares: inp.wholeShares }));
  }, [v, live, p.targets, p.cashTarget, inp.newMoney, inp.mode, inp.wholeShares]);

  if (!p.txns.length) return <Card><Empty title="Add holdings first"><p>Rebalancing compares what you hold with the targets you set.</p></Empty></Card>;
  if (!v) return loading ? <Loading label="Fetching live prices…" height={160} /> : null;
  if (!hasTargets) {
    return (
      <Card>
        <Empty title="Set your target weights first">
          <p>Rebalancing needs a plan to rebalance towards. Set a target share for each stock on the Allocation tab. Equal weights are a sensible starting point.</p>
          <button className="btn primary" onClick={() => setTab('allocation')}>
            Set targets
          </button>
        </Empty>
      </Card>
    );
  }

  const r = result?.value;
  const trades: Trade[] = r ? r.trades.filter((t) => t.action !== 'HOLD') : [];
  const avgCost = (symbol: string) => v.positions.find((x) => x.symbol === symbol)?.avgCost ?? 0;
  const priceOf = (symbol: string) => {
    const pos = v.positions.find((x) => x.symbol === symbol);
    return pos && pos.value !== null ? pos.value / pos.qty : 0;
  };
  const gainOnSells = trades.filter((t) => t.action === 'SELL').reduce((s, t) => s + t.shares * (priceOf(t.symbol) - avgCost(t.symbol)), 0);

  return (
    <div className="split">
      <Card title="Rebalancing options">
        <div className="form">
          <MoneyField label="New money to invest" currency={p.currency} value={inp.newMoney} min={0} decimals={0} onChange={(newMoney) => set({ newMoney })} tip="Fresh savings you are adding now. Using new money to top up the laggards is the cheapest way to rebalance: no selling, so no tax." />
          <div className="field">
            <span className="label">How to rebalance</span>
            <Seg
              options={[
                { value: 'buy-only', label: 'Only buy (no selling)' },
                { value: 'full', label: 'Buy and sell' },
              ]}
              value={inp.mode}
              onChange={(mode) => set({ mode })}
            />
            <span className="hint">{inp.mode === 'buy-only' ? 'Spends spare cash and new money on the stocks furthest below target. Nothing is sold, so no capital-gains tax.' : 'Sells what has grown past its target and buys what has fallen behind. Exact, but selling can trigger tax and charges.'}</span>
          </div>
          <Check label="Whole shares only" checked={inp.wholeShares} onChange={(wholeShares) => set({ wholeShares })} tip="Indian exchanges do not allow fractional shares. Leftover money stays as cash." />
          {Math.abs(targetTotal - 100) >= 0.05 && <Note kind="err">Your targets add up to {num(targetTotal, 1)}%, not 100%. Fix them on the Allocation tab.</Note>}
        </div>
      </Card>
      <div className="stack">
        {result?.error && Math.abs(targetTotal - 100) < 0.05 && <Note kind="err">{result.error}</Note>}
        {r && (
          <>
            <Stats>
              <Stat label="Portfolio after trades" value={money(r.total, p.currency, 0)} />
              <Stat label="Trades needed" value={trades.length} />
              <Stat label="Turnover" tip="Total value bought and sold as a share of the portfolio. Lower turnover means lower costs." value={pct(r.turnover)} />
              <Stat label="Cash left over" value={money(r.cashAfter, p.currency, 0)} sub={pct(r.cashWeightAfter) + ' of portfolio'} />
              <Stat label="Largest gap after" tip="The biggest remaining difference between a stock's weight and its target once these trades are done." value={`${num(r.maxDrift * 100, 1)} pts`} />
            </Stats>
            <Card title="Trade list" sub="at the latest prices" flush>
              {trades.length === 0 ? (
                <Empty title="Nothing to trade">
                  <p>{inp.mode === 'buy-only' ? 'There is no spare cash to deploy. Add new money above, or switch to “Buy and sell”.' : 'The portfolio is already on target.'}</p>
                </Empty>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Stock</th>
                        <th className="r">Shares</th>
                        <th className="r">Approx. amount</th>
                        <th className="r">Weight now</th>
                        <th className="r">Target</th>
                        <th className="r">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.trades.map((t) => (
                        <tr key={t.symbol}>
                          <td>
                            <span className={'badge ' + (t.action === 'BUY' ? 'pos' : t.action === 'SELL' ? 'neg' : '')}>{t.action}</span>
                          </td>
                          <td>
                            {shortSymbol(t.symbol)}
                            <span className="sub">{nameOf(t.symbol)}</span>
                          </td>
                          <td className="r">{t.action === 'HOLD' ? '—' : num(t.shares, inp.wholeShares ? 0 : 3)}</td>
                          <td className="r">{t.action === 'HOLD' ? '—' : money(t.amount, p.currency, 0)}</td>
                          <td className="r">{pct(t.currentWeight)}</td>
                          <td className="r">{pct(t.targetWeight)}</td>
                          <td className="r">{pct(t.afterWeight)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {gainOnSells !== 0 && (
              <Note kind={gainOnSells > 0 ? 'warn' : 'info'}>
                The sells would book a {gainOnSells > 0 ? 'gain' : 'loss'} of about <b>{money(Math.abs(gainOnSells), p.currency, 0)}</b> (based on your average cost; the taxman uses first-in-first-out, so the exact figure can differ).{' '}
                {gainOnSells > 0 ? 'Gains are taxable: see the Tax tab before you sell.' : 'Booked losses can be set off against gains.'}
              </Note>
            )}
            <Card title="What this does" className="quiet">
              <KV
                rows={[
                  ['Value of stocks now', money(v.holdingsValue, p.currency, 0)],
                  ['Cash now', money(v.cash, p.currency, 0)],
                  ['New money', money(inp.newMoney || 0, p.currency, 0)],
                  ['Total to allocate', money(r.total, p.currency, 0), { total: true }],
                ]}
              />
              <p className="small muted mt-s">
                These are suggestions to place with your broker yourself; this site never trades. Prices move, so recheck quantities when you place the orders. Drift before rebalancing:{' '}
                {signedPct(Math.max(...r.trades.map((t) => t.currentWeight - t.targetWeight)), 1)} at the most overweight stock.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
