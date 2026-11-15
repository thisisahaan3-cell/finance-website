import { BarList, seriesColor } from '../components/charts';
import { Page } from '../components/Page';
import { Card, CellInput, Empty, KV, MoneyField, Note, Stat, Stats } from '../components/ui';
import { compact, money, num, pct } from '../lib/format';
import { uid, update, useStore, type WorthItem } from '../lib/store';

const ASSET_KINDS = ['Cash and savings', 'Fixed deposits', 'Shares and equity funds', 'Debt funds and bonds', 'EPF, PPF and NPS', 'Gold', 'Property', 'Other'];
const DEBT_KINDS = ['Home loan', 'Car loan', 'Education loan', 'Personal loan', 'Credit card', 'Other'];
const LIQUID = new Set(['Cash and savings', 'Fixed deposits', 'Debt funds and bonds']);
const GROWTH = new Set(['Shares and equity funds']);

function Table({ title, sub, items, kinds, side }: { title: string; sub: string; items: WorthItem[]; kinds: string[]; side: 'assets' | 'liabilities' }) {
  const patch = (fn: (list: WorthItem[]) => WorthItem[]) => update((s) => ({ ...s, netWorth: { ...s.netWorth, [side]: fn(s.netWorth[side]) } }));
  return (
    <Card title={title} sub={sub} flush>
      {items.length === 0 ? (
        <Empty title={side === 'assets' ? 'Nothing listed yet' : 'No debts listed'}>
          <p>{side === 'assets' ? 'Add what you own: bank balances, deposits, investments, gold, property.' : 'Add what you owe: loans and unpaid card balances.'}</p>
        </Empty>
      ) : (
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th className="r">Amount (₹)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  <input className="input" style={{ height: 28, minWidth: 110 }} aria-label="Description" value={it.label} placeholder="e.g. SBI savings" onChange={(e) => patch((l) => l.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} />
                </td>
                <td>
                  <select className="select" style={{ height: 28, minWidth: 130 }} aria-label="Type" value={it.kind} onChange={(e) => patch((l) => l.map((x) => (x.id === it.id ? { ...x, kind: e.target.value } : x)))}>
                    {kinds.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </td>
                <td className="r">
                  <CellInput width={120} label="Amount" value={it.amount} min={0} onChange={(n) => n !== null && patch((l) => l.map((x) => (x.id === it.id ? { ...x, amount: n } : x)))} />
                </td>
                <td className="r">
                  <button className="btn sm ghost icon" aria-label="Remove this row" onClick={() => patch((l) => l.filter((x) => x.id !== it.id))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ padding: 10 }}>
        <button className="btn sm" onClick={() => patch((l) => [...l, { id: uid(), label: '', kind: kinds[0], amount: 0 }])}>
          Add {side === 'assets' ? 'something you own' : 'a debt'}
        </button>
      </div>
    </Card>
  );
}

export default function NetWorth() {
  const nw = useStore((s) => s.netWorth);
  const portfolios = useStore((s) => s.portfolios);
  const assets = nw.assets.reduce((s, a) => s + (a.amount || 0), 0);
  const debts = nw.liabilities.reduce((s, a) => s + (a.amount || 0), 0);
  const net = assets - debts;
  const byKind = ASSET_KINDS.map((k) => ({ k, v: nw.assets.filter((a) => a.kind === k).reduce((s, a) => s + (a.amount || 0), 0) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const liquid = nw.assets.filter((a) => LIQUID.has(a.kind)).reduce((s, a) => s + (a.amount || 0), 0);
  const growth = nw.assets.filter((a) => GROWTH.has(a.kind)).reduce((s, a) => s + (a.amount || 0), 0);
  const months = nw.monthlyExpenses > 0 ? liquid / nw.monthlyExpenses : null;
  const property = nw.assets.filter((a) => a.kind === 'Property').reduce((s, a) => s + (a.amount || 0), 0);
  const financial = assets - property;

  return (
    <Page tool="networth">
      <Stats>
        <Stat big label="Net worth" tip="Everything you own minus everything you owe." value={money(net, 'INR', 0)} tone={net < 0 ? 'neg' : ''} sub={compact(net)} />
        <Stat label="You own" value={compact(assets)} />
        <Stat label="You owe" value={compact(debts)} tone={debts > 0 ? 'neg' : ''} sub={assets > 0 ? `${pct(debts / assets, 0)} of what you own` : undefined} />
        <Stat label="Emergency fund covers" tip="Cash, deposits and debt funds divided by your monthly expenses. Aim for at least six months before investing in shares." value={months !== null ? `${num(months, 1)} months` : '—'} tone={months !== null ? (months >= 6 ? 'pos' : months < 3 ? 'neg' : '') : ''} sub={months === null ? 'enter monthly expenses below' : months >= 6 ? 'a solid cushion' : 'below the six-month guideline'} />
      </Stats>
      <div className="grid cols-2 mt">
        <Table title="What you own" sub="assets" items={nw.assets} kinds={ASSET_KINDS} side="assets" />
        <Table title="What you owe" sub="liabilities" items={nw.liabilities} kinds={DEBT_KINDS} side="liabilities" />
      </div>
      <div className="grid cols-2 mt">
        <Card title="Safety net">
          <div className="form">
            <MoneyField label="Monthly household expenses" value={nw.monthlyExpenses} min={0} decimals={0} onChange={(monthlyExpenses) => update((s) => ({ ...s, netWorth: { ...s.netWorth, monthlyExpenses } }))} tip="Everything you must pay each month: rent or EMI, food, bills, school fees, insurance." />
            <KV
              rows={[
                ['Money you can reach quickly', money(liquid, 'INR', 0), { tip: 'Cash and savings, fixed deposits, and debt funds.' }],
                ['Six months of expenses', money(nw.monthlyExpenses * 6, 'INR', 0)],
                [liquid >= nw.monthlyExpenses * 6 ? 'Surplus over six months' : 'Shortfall', money(Math.abs(liquid - nw.monthlyExpenses * 6), 'INR', 0), { total: true, tone: liquid >= nw.monthlyExpenses * 6 ? 'pos' : 'neg' }],
              ]}
            />
            <p className="small muted">An emergency fund is for job loss, illness or urgent repairs. Keep it where it cannot fall in value and can be withdrawn within a day or two. Health and term life insurance come before investing too.</p>
          </div>
        </Card>
        <Card title="How your assets are spread">
          {byKind.length === 0 ? (
            <p className="muted small">Add what you own to see the split.</p>
          ) : (
            <>
              <BarList items={byKind.map((x, i) => ({ label: x.k, share: x.v / assets, display: pct(x.v / assets, 0), title: money(x.v, 'INR', 0), color: seriesColor(i) }))} />
              <div className="mt">
                <KV
                  rows={[
                    ['Shares, as a part of financial assets', financial > 0 ? pct(growth / financial, 0) : '—', { tip: 'Financial assets leave out property. A common starting point is “100 minus your age” in shares, adjusted for how you cope with falls.' }],
                    ['Property, as a part of everything', assets > 0 ? pct(property / assets, 0) : '—'],
                  ]}
                />
              </div>
            </>
          )}
        </Card>
      </div>
      {portfolios.length > 0 && <Note className="mt">Your saved share portfolios are not added here automatically. Enter their current value as “Shares and equity funds” so this page stays a simple record you control.</Note>}
      {debts > 0 && nw.liabilities.some((l) => l.kind === 'Credit card' && l.amount > 0) && <Note kind="warn" className="mt">You have listed credit-card debt. Card interest of 36–45% a year is far above anything investing can earn: clearing it is the best “investment” available to you.</Note>}
      <p className="plain mt">In plain words: net worth is your personal balance sheet. Tracking it once a quarter tells you more about your progress than watching share prices every day. It rises when you save, when your investments grow, and when you repay debt.</p>
    </Page>
  );
}
