import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Loading, Modal, MoneyField, Note, Stat, Stats, TextField, toast, useSort } from '../../components/ui';
import { chartDates, getChart } from '../../lib/data/api';
import { shortSymbol } from '../../lib/data/symbols';
import { csvToObjects, download, parseDate, readFile, toCsv } from '../../lib/csv';
import { buildLedger, portfolioXirr, sortTxns, type Txn, type TxnType } from '../../lib/finance/portfolio';
import { date as fmtDate, money, num, parseNum, pct, signedMoney, signedPct, todayIso, tone } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { nameOf, normaliseSymbol, rangeSince } from '../../lib/portfolioData';
import { patchPortfolio, uid, useStore } from '../../lib/store';
import type { TabProps } from './Studio';

/* ---------- Holdings ---------- */

type HoldKey = 'symbol' | 'qty' | 'avgCost' | 'price' | 'value' | 'weight' | 'gain' | 'gainPct' | 'day';

export function HoldingsTab({ p, live, loading, openTxn, setTab }: TabProps) {
  useStore((s) => s.symbolMeta); // re-render when names arrive
  const sorter = useSort<HoldKey>('value');
  const v = live?.valuation;
  const xirr = useMemo(() => (v && v.holdingsValue > 0 && !v.unpriced.length ? portfolioXirr(p.txns, v.holdingsValue, todayIso()) : null), [p.txns, v]);
  const firstDate = useMemo(() => sortTxns(p.txns).find((t) => t.type === 'buy')?.date ?? null, [p.txns]);
  const heldDays = firstDate ? (Date.now() - Date.parse(firstDate)) / 86_400_000 : 0;

  if (!p.txns.length) {
    return (
      <Card>
        <Empty title="No holdings yet">
          <p>Add the stocks you own, one purchase at a time, or import them all from a CSV file exported by your broker.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => openTxn({ type: 'buy' })}>
              Add your first stock
            </button>
            <button className="btn" onClick={() => setTab('transactions')}>
              Import from CSV
            </button>
          </div>
        </Empty>
      </Card>
    );
  }
  if (!v) return loading ? <Loading label="Fetching live prices…" height={160} /> : null;

  const rows = sorter.sort(v.positions, (r, k) =>
    k === 'symbol' ? r.symbol : k === 'gain' ? r.unrealised : k === 'gainPct' ? r.unrealisedPct : k === 'day' ? r.dayChangePct : (r[k as 'qty' | 'avgCost' | 'price' | 'value' | 'weight'] as number | null),
  );
  const th = (k: HoldKey, label: string, right = true) => (
    <th className={(right ? 'r ' : '') + 'sortable'} onClick={() => sorter.toggle(k)}>
      {label}
      {sorter.mark(k)}
    </th>
  );
  const ccy = p.currency;

  return (
    <div className="stack">
      <Stats>
        <Stat big label="Current value" value={money(v.total, ccy, 0)} sub={v.cash > 0 ? `including ${money(v.cash, ccy, 0)} cash` : 'stocks only'} />
        <Stat label="Money invested" tip="What the shares you still hold cost you, including charges." value={money(v.invested, ccy, 0)} />
        <Stat label="Unrealised gain" tip="Profit or loss on paper for shares you still hold: today's value minus what they cost." value={signedMoney(v.unrealised, ccy, 0)} tone={tone(v.unrealised)} sub={signedPct(v.unrealisedPct)} />
        <Stat label="Today" value={signedMoney(v.dayChange, ccy, 0)} tone={tone(v.dayChange)} sub={signedPct(v.dayChangePct, 2)} />
        <Stat
          label="Annual return (XIRR)"
          tip="Your true yearly return, taking into account when each rupee went in and came out. It is the single best number for judging how your investing has done."
          value={xirr?.rate !== null && xirr?.rate !== undefined ? signedPct(xirr.rate) : '—'}
          tone={tone(xirr?.rate)}
          sub={heldDays < 365 && xirr?.rate != null ? 'under a year of history: annualised figure exaggerates' : xirr?.note ?? (v.unpriced.length ? 'needs a price for every holding' : 'money-weighted')}
        />
        <Stat label="Booked so far" tip="Profit already locked in by selling, plus dividends you have recorded." value={signedMoney(v.realised + v.dividends, ccy, 0)} tone={tone(v.realised + v.dividends)} sub={`${signedMoney(v.realised, ccy, 0)} sold · ${money(v.dividends, ccy, 0)} dividends`} />
      </Stats>

      <Card
        title="Holdings"
        sub={`${v.positions.length} stock${v.positions.length === 1 ? '' : 's'}`}
        right={
          <button className="btn sm" onClick={() => openTxn({ type: 'buy' })}>
            Add stock
          </button>
        }
        flush
      >
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {th('symbol', 'Stock', false)}
                {th('qty', 'Qty')}
                {th('avgCost', 'Avg cost')}
                {th('price', 'Price')}
                {th('value', 'Value')}
                {th('weight', 'Weight')}
                {th('gain', 'Gain')}
                {th('gainPct', 'Gain %')}
                {th('day', 'Today')}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const q = live?.quotes[r.symbol];
                const foreign = q?.currency && q.currency !== ccy;
                return (
                  <tr key={r.symbol}>
                    <td>
                      <Link to={`/stock/${encodeURIComponent(r.symbol)}`} className="strong">
                        {shortSymbol(r.symbol)}
                      </Link>
                      <span className="sub">{nameOf(r.symbol)}</span>
                    </td>
                    <td className="r">{num(r.qty, r.qty % 1 ? 3 : 0)}</td>
                    <td className="r">{money(r.avgCost, ccy, 2)}</td>
                    <td className="r">
                      {r.price === null ? '—' : money(r.price, q?.currency ?? ccy, 2)}
                      {foreign && <span className="sub">{q!.currency}</span>}
                    </td>
                    <td className="r">{money(r.value, ccy, 0)}</td>
                    <td className="r">{pct(r.weight)}</td>
                    <td className={'r ' + tone(r.unrealised)}>{signedMoney(r.unrealised, ccy, 0)}</td>
                    <td className={'r ' + tone(r.unrealisedPct)}>{signedPct(r.unrealisedPct)}</td>
                    <td className={'r ' + tone(r.dayChangePct)}>{signedPct(r.dayChangePct, 2)}</td>
                    <td className="r nowrap">
                      <button className="btn sm ghost" onClick={() => openTxn({ symbol: r.symbol, type: 'buy' })}>
                        Buy
                      </button>
                      <button className="btn sm ghost" onClick={() => openTxn({ symbol: r.symbol, type: 'sell' })}>
                        Sell
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <span className="strong">Cash</span>
                  <span className="sub">Money waiting to be invested</span>
                </td>
                <td colSpan={3} />
                <td className="r" style={{ minWidth: 150 }}>
                  <MoneyField currency={ccy} value={p.cash} min={0} decimals={0} onChange={(cash) => patchPortfolio(p.id, (x) => ({ ...x, cash }))} />
                </td>
                <td className="r">{pct(v.total > 0 ? v.cash / v.total : 0)}</td>
                <td colSpan={4} />
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td colSpan={3} />
                <td className="r">{money(v.total, ccy, 0)}</td>
                <td className="r">100%</td>
                <td className={'r ' + tone(v.unrealised)}>{signedMoney(v.unrealised, ccy, 0)}</td>
                <td className={'r ' + tone(v.unrealisedPct)}>{signedPct(v.unrealisedPct)}</td>
                <td className={'r ' + tone(v.dayChangePct)}>{signedPct(v.dayChangePct, 2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="plain">
        In plain words: <b>value</b> is what your shares would fetch today, <b>gain</b> is that minus what you paid, and <b>weight</b> is each stock's share of the whole. A stock that has grown to a very large weight is where most of
        your risk sits. Check the Allocation tab.
      </p>
    </div>
  );
}

/* ---------- Transactions ---------- */

const TYPE_LABEL: Record<TxnType, string> = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend', split: 'Split / bonus' };

interface ImportRow {
  line: number;
  txn: Txn | null;
  error: string | null;
  raw: string;
}

const pick = (row: Record<string, string>, names: string[]): string => {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return '';
};

/** Turn a CSV (our own export, or a broker's holdings / tradebook file) into transactions, row by row, with reasons for any rejects. */
export function parseTxnCsv(text: string, currency: string, defaultDate: string): { rows: ImportRow[]; headers: string[] } {
  const { headers, rows } = csvToObjects(text);
  const out: ImportRow[] = rows.map((r, i) => {
    const raw = Object.values(r).join(', ');
    const sym = pick(r, ['symbol', 'ticker', 'instrument', 'tradingsymbol', 'trading symbol', 'scrip', 'stock', 'scrip name', 'stock name']);
    if (!sym) return { line: i + 2, txn: null, error: 'No stock symbol', raw };
    const typeText = pick(r, ['type', 'trade type', 'trade_type', 'action', 'buy/sell', 'transaction type', 'side']).toLowerCase();
    const type: TxnType = typeText.startsWith('s') && !typeText.startsWith('sp') ? 'sell' : typeText.startsWith('d') ? 'dividend' : typeText.startsWith('sp') || typeText.startsWith('bo') ? 'split' : 'buy';
    const dateText = pick(r, ['date', 'trade date', 'trade_date', 'buy date', 'purchase date', 'order execution time', 'transaction date']);
    const date = dateText ? parseDate(dateText) : defaultDate;
    if (!date) return { line: i + 2, txn: null, error: `Unreadable date “${dateText}”`, raw };
    if (date > todayIso()) return { line: i + 2, txn: null, error: 'Date is in the future', raw };
    const qty = parseNum(pick(r, ['quantity', 'qty', 'qty.', 'shares', 'units', 'quantity available']));
    const price = parseNum(pick(r, ['price', 'avg. cost', 'avg cost', 'average price', 'avg price', 'average cost', 'buy price', 'rate', 'trade price', 'purchase price', 'avg. price']));
    const fees = parseNum(pick(r, ['fees', 'charges', 'brokerage', 'fee']));
    const fx = parseNum(pick(r, ['fx', 'exchange rate', 'fx rate']));
    const amount = parseNum(pick(r, ['amount', 'dividend', 'value']));
    const symbol = normaliseSymbol(sym, currency);
    const t: Txn = { id: uid(), date, type, symbol, qty: 0, price: 0, note: pick(r, ['note', 'notes', 'remarks']) || undefined };
    if (type === 'buy' || type === 'sell') {
      if (!(qty > 0)) return { line: i + 2, txn: null, error: 'Quantity missing or not above zero', raw };
      if (!(price > 0)) return { line: i + 2, txn: null, error: 'Price missing or not above zero', raw };
      Object.assign(t, { qty, price, fees: fees > 0 ? fees : 0, fx: fx > 0 ? fx : 1 });
    } else if (type === 'dividend') {
      if (!(amount > 0)) return { line: i + 2, txn: null, error: 'Dividend amount missing', raw };
      t.amount = amount;
    } else {
      if (!(qty > 0)) return { line: i + 2, txn: null, error: 'Split ratio missing', raw };
      t.qty = qty;
    }
    return { line: i + 2, txn: t, error: null, raw };
  });
  return { rows: out, headers };
}

function ImportModal({ portfolioId, currency, onClose }: { portfolioId: string; currency: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [defaultDate, setDefaultDate] = useState(todayIso());
  const parsed = useMemo(() => (text.trim() ? parseTxnCsv(text, currency, defaultDate) : null), [text, currency, defaultDate]);
  const good = parsed?.rows.filter((r) => r.txn) ?? [];
  const bad = parsed?.rows.filter((r) => !r.txn) ?? [];
  const hasDate = parsed?.headers.some((h) => h.includes('date') || h.includes('time')) ?? true;
  const run = () => {
    patchPortfolio(portfolioId, (p) => ({ ...p, txns: [...p.txns, ...good.map((r) => r.txn!)] }));
    toast(`${good.length} transaction${good.length === 1 ? '' : 's'} imported`);
    onClose();
  };
  return (
    <Modal
      wide
      title="Import transactions from CSV"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!good.length} onClick={run}>
            Import {good.length || ''} transaction{good.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="form">
        <Note>
          Works with a file exported from this site, or a holdings / tradebook CSV from most brokers. Needed columns: a <b>symbol</b>, a <b>quantity</b> and a <b>price</b> (average cost). Optional: date, type (buy / sell / dividend / split),
          fees. Tickers without a suffix are treated as NSE (for example INFY becomes INFY.NS).
        </Note>
        <div className="row">
          <label className="btn sm">
            Choose a CSV file
            <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={async (e) => e.target.files?.[0] && setText(await readFile(e.target.files[0]))} />
          </label>
          <button className="btn sm ghost" onClick={() => setText('date,type,symbol,quantity,price,fees\n2024-06-03,buy,RELIANCE,10,1450,20\n2024-09-12,buy,HDFCBANK,25,1650,25\n2025-02-10,sell,RELIANCE,4,1280,15')}>
            Show me an example
          </button>
        </div>
        <div className="field">
          <label htmlFor="csvtext">…or paste the CSV text here</label>
          <textarea id="csvtext" className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="date,type,symbol,quantity,price,fees" />
        </div>
        {parsed && !hasDate && <TextField label="Purchase date to use (your file has no date column)" type="date" value={defaultDate} max={todayIso()} onChange={setDefaultDate} hint="Holding-period tax and XIRR depend on dates, so use the real purchase date if you can." />}
        {parsed && (
          <>
            <div className="row">
              <span className="badge pos">{good.length} ready</span>
              {bad.length > 0 && <span className="badge neg">{bad.length} skipped</span>}
            </div>
            {bad.length > 0 && (
              <Note kind="warn">
                {bad.slice(0, 6).map((r) => (
                  <div key={r.line}>
                    Line {r.line}: {r.error} <span className="muted">({r.raw.slice(0, 60)})</span>
                  </div>
                ))}
                {bad.length > 6 && <div>…and {bad.length - 6} more.</div>}
              </Note>
            )}
            {good.length > 0 && (
              <div className="tbl-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table className="tbl compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Stock</th>
                      <th className="r">Qty</th>
                      <th className="r">Price</th>
                      <th className="r">Fees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {good.slice(0, 200).map((r) => (
                      <tr key={r.line}>
                        <td>{fmtDate(r.txn!.date)}</td>
                        <td>{TYPE_LABEL[r.txn!.type]}</td>
                        <td>{r.txn!.symbol}</td>
                        <td className="r">{r.txn!.type === 'dividend' ? '' : num(r.txn!.qty, 2)}</td>
                        <td className="r">{r.txn!.type === 'dividend' ? num(r.txn!.amount ?? 0, 2) : r.txn!.type === 'split' ? '' : num(r.txn!.price, 2)}</td>
                        <td className="r">{r.txn!.fees ? num(r.txn!.fees, 2) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Splits and bonuses the data provider reports after you bought, that you have not recorded yet. */
function useSplitSuggestions(p: TabProps['p']) {
  const held = useMemo(() => Object.values(buildLedger(p.txns).holdings).filter((h) => h.qty > 1e-9 && h.firstBuy), [p.txns]);
  const key = held.map((h) => h.symbol + h.firstBuy).join('|');
  const res = useAsync(
    held.length
      ? async () => {
          const out: { symbol: string; date: string; ratio: number }[] = [];
          await Promise.all(
            held.map(async (h) => {
              try {
                const chart = await getChart(h.symbol, rangeSince(h.firstBuy!));
                for (const [t, numr, den] of chart.split) {
                  const d = chartDates({ t: [t], gmtoffset: chart.gmtoffset })[0];
                  if (d > h.firstBuy!) out.push({ symbol: h.symbol, date: d, ratio: numr / den });
                }
              } catch {
                /* no suggestion for this symbol */
              }
            }),
          );
          return out;
        }
      : null,
    [key],
  );
  return (res.data ?? []).filter(
    (s) => !p.txns.some((t) => t.type === 'split' && t.symbol === s.symbol && Math.abs(Date.parse(t.date) - Date.parse(s.date)) < 10 * 86_400_000),
  );
}

export function TransactionsTab({ p, openTxn }: TabProps) {
  useStore((s) => s.symbolMeta);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');
  const suggestions = useSplitSuggestions(p);
  const rows = useMemo(() => [...sortTxns(p.txns)].reverse().filter((t) => !filter || t.symbol.toLowerCase().includes(filter.toLowerCase()) || nameOf(t.symbol).toLowerCase().includes(filter.toLowerCase())), [p.txns, filter]);

  const exportCsv = () => {
    download(
      `${p.name.replace(/[^\w-]+/g, '_')}_transactions.csv`,
      toCsv(
        ['date', 'type', 'symbol', 'quantity', 'price', 'fees', 'fx', 'amount', 'note'],
        sortTxns(p.txns).map((t) => [t.date, t.type, t.symbol, t.type === 'dividend' ? '' : t.qty, t.type === 'buy' || t.type === 'sell' ? t.price : '', t.fees ?? '', t.fx && t.fx !== 1 ? t.fx : '', t.amount ?? '', t.note ?? '']),
      ),
    );
  };
  const remove = (t: Txn) => {
    if (!window.confirm(`Delete this ${TYPE_LABEL[t.type].toLowerCase()} of ${t.symbol} on ${fmtDate(t.date)}?`)) return;
    patchPortfolio(p.id, (x) => ({ ...x, txns: x.txns.filter((y) => y.id !== t.id) }));
  };

  return (
    <div className="stack">
      {suggestions.map((s) => (
        <Note kind="warn" key={s.symbol + s.date}>
          <div className="row between">
            <span>
              <b>{s.symbol}</b> had a split or bonus on {fmtDate(s.date)}: each share became {num(s.ratio, s.ratio % 1 ? 3 : 0)}. Record it so your quantity matches your demat account.
            </span>
            <button
              className="btn sm"
              onClick={() => patchPortfolio(p.id, (x) => ({ ...x, txns: [...x.txns, { id: uid(), date: s.date, type: 'split', symbol: s.symbol, qty: s.ratio, price: 0, note: 'From provider corporate-action history' }] }))}
            >
              Record it
            </button>
          </div>
        </Note>
      ))}
      <Card
        title="Transactions"
        sub={`${p.txns.length} recorded`}
        right={
          <>
            <input className="input" style={{ width: 150, height: 28 }} placeholder="Filter by stock" aria-label="Filter transactions by stock" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="btn sm" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn sm" onClick={exportCsv} disabled={!p.txns.length}>
              Export CSV
            </button>
            <button className="btn sm primary" onClick={() => openTxn({})}>
              Add
            </button>
          </>
        }
        flush
      >
        {!p.txns.length ? (
          <Empty title="Nothing recorded yet">
            <p>Every buy, sell, dividend and split you add appears here, newest first.</p>
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Stock</th>
                  <th className="r">Qty</th>
                  <th className="r">Price</th>
                  <th className="r">Charges</th>
                  <th className="r">Total ({p.currency})</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const fx = t.fx && t.fx > 0 ? t.fx : 1;
                  const total = t.type === 'buy' ? t.qty * t.price * fx + (t.fees ?? 0) : t.type === 'sell' ? t.qty * t.price * fx - (t.fees ?? 0) : t.type === 'dividend' ? t.amount ?? 0 : null;
                  return (
                    <tr key={t.id}>
                      <td className="nowrap">{fmtDate(t.date)}</td>
                      <td>
                        <span className={'badge ' + (t.type === 'buy' ? 'accent' : t.type === 'sell' ? 'warn' : t.type === 'dividend' ? 'pos' : '')}>{TYPE_LABEL[t.type]}</span>
                      </td>
                      <td>
                        <Link to={`/stock/${encodeURIComponent(t.symbol)}`}>{shortSymbol(t.symbol)}</Link>
                      </td>
                      <td className="r">{t.type === 'dividend' ? '' : t.type === 'split' ? `×${num(t.qty, t.qty % 1 ? 3 : 0)}` : num(t.qty, t.qty % 1 ? 3 : 0)}</td>
                      <td className="r">{t.type === 'buy' || t.type === 'sell' ? num(t.price, 2) + (fx !== 1 ? ` @ ${num(fx, 2)}` : '') : ''}</td>
                      <td className="r">{t.fees ? num(t.fees, 2) : ''}</td>
                      <td className="r">{total === null ? '' : money(total, p.currency, 2)}</td>
                      <td className="muted small">{t.note}</td>
                      <td className="r nowrap">
                        <button className="btn sm ghost" onClick={() => openTxn({ editId: t.id })}>
                          Edit
                        </button>
                        <button className="btn sm ghost" onClick={() => remove(t)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {importing && <ImportModal portfolioId={p.id} currency={p.currency} onClose={() => setImporting(false)} />}
    </div>
  );
}
