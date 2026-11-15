import { useEffect, useMemo, useState } from 'react';
import { TickerSearch } from '../../components/TickerSearch';
import { Modal, MoneyField, NumberField, Note, Seg, TextField, toast } from '../../components/ui';
import { getCloseOn, getQuotes } from '../../lib/data/api';
import { buildLedger, type Txn, type TxnType } from '../../lib/finance/portfolio';
import { currencySymbol, money, todayIso } from '../../lib/format';
import { fxOn } from '../../lib/portfolioData';
import { patchPortfolio, rememberMeta, uid, useStore, type Portfolio } from '../../lib/store';

interface Props {
  portfolio: Portfolio;
  /** existing transaction to edit */
  edit?: Txn;
  /** preselect a stock and/or type */
  symbol?: string;
  type?: TxnType;
  onClose: () => void;
}

const TYPES: { value: TxnType; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'split', label: 'Split / bonus' },
];

export function TxnForm({ portfolio, edit, symbol: presetSymbol, type: presetType, onClose }: Props) {
  const meta = useStore((s) => s.symbolMeta);
  const [type, setType] = useState<TxnType>(edit?.type ?? presetType ?? 'buy');
  const [symbol, setSymbol] = useState(edit?.symbol ?? presetSymbol ?? '');
  const [date, setDate] = useState(edit?.date ?? todayIso());
  const [qty, setQty] = useState(edit?.qty ?? NaN);
  const [price, setPrice] = useState(edit?.price ?? NaN);
  const [fees, setFees] = useState(edit?.fees ?? 0);
  const [fx, setFx] = useState(edit?.fx ?? 1);
  const [amount, setAmount] = useState(edit?.amount ?? NaN);
  const [note, setNote] = useState(edit?.note ?? '');
  const [stockCcy, setStockCcy] = useState<string | null>(symbol ? meta[symbol]?.currency ?? null : null);
  const [busy, setBusy] = useState(false);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const foreign = !!stockCcy && stockCcy !== portfolio.currency;
  const name = symbol ? meta[symbol]?.name ?? symbol : '';

  // Learn the stock's currency and name the first time we see it.
  useEffect(() => {
    if (!symbol || meta[symbol]?.currency) {
      if (symbol) setStockCcy(meta[symbol]?.currency ?? null);
      return;
    }
    let live = true;
    getQuotes([symbol]).then(
      ({ quotes }) => {
        const q = quotes[symbol];
        if (!live || !q) return;
        rememberMeta(symbol, { name: q.longName ?? q.shortName ?? symbol, currency: q.currency ?? null, marketCap: q.marketCap ?? null, type: q.quoteType ?? null });
        setStockCcy(q.currency ?? null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const heldOnDate = useMemo(() => {
    if (!symbol) return 0;
    const others = portfolio.txns.filter((t) => t.id !== edit?.id);
    return buildLedger(others, date).holdings[symbol]?.qty ?? 0;
  }, [portfolio.txns, symbol, date, edit?.id]);

  const fillPrice = async () => {
    if (!symbol) return;
    setBusy(true);
    setPriceNote(null);
    const close = await getCloseOn(symbol, date);
    if (close) {
      setPrice(close);
      setPriceNote(`Closing price on or just before ${date}. Replace it with your actual trade price if you have it.`);
    } else setPriceNote('No price found for that date. Enter the price from your contract note.');
    if (foreign && stockCcy) {
      const rate = await fxOn(stockCcy, portfolio.currency, date);
      if (rate) setFx(Number(rate.toFixed(4)));
    }
    setBusy(false);
  };

  // Foreign stock: keep the exchange rate in step with the trade date for new entries.
  useEffect(() => {
    if (!foreign || !stockCcy || edit) return;
    let live = true;
    fxOn(stockCcy, portfolio.currency, date).then((rate) => live && rate && setFx(Number(rate.toFixed(4))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign, stockCcy, date]);

  const save = () => {
    setError(null);
    if (!symbol) return setError('Choose a stock first.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Enter a valid date.');
    if (date > todayIso()) return setError('The date cannot be in the future.');
    const t: Txn = { id: edit?.id ?? uid(), date, type, symbol, qty: 0, price: 0, note: note.trim() || undefined };
    if (type === 'buy' || type === 'sell') {
      if (!(qty > 0)) return setError('Enter a quantity above zero.');
      if (!(price > 0)) return setError('Enter the price per share.');
      if (type === 'sell' && qty > heldOnDate + 1e-9) return setError(`You held ${+heldOnDate.toFixed(4)} shares on that date, so you cannot sell ${qty}.`);
      if (foreign && !(fx > 0)) return setError('Enter the exchange rate on the trade date.');
      Object.assign(t, { qty, price, fees: fees > 0 ? fees : 0, fx: foreign ? fx : 1 });
    } else if (type === 'dividend') {
      if (!(amount > 0)) return setError('Enter the dividend received.');
      t.amount = amount;
    } else {
      if (!(qty > 0) || qty === 1) return setError('Enter the split ratio: new shares for each old share (for example 5 for a 1:5 split, 2 for a 1:1 bonus).');
      t.qty = qty;
    }
    patchPortfolio(portfolio.id, (p) => ({ ...p, txns: edit ? p.txns.map((x) => (x.id === edit.id ? t : x)) : [...p.txns, t] }));
    toast(edit ? 'Transaction updated' : `${TYPES.find((x) => x.value === type)!.label} recorded for ${symbol}`);
    onClose();
  };

  const total = (type === 'buy' || type === 'sell') && qty > 0 && price > 0 ? qty * price * (foreign ? fx : 1) + (type === 'buy' ? fees || 0 : -(fees || 0)) : null;

  return (
    <Modal
      title={edit ? 'Edit transaction' : 'Add a transaction'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {edit ? 'Save changes' : 'Add to portfolio'}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <span className="label">What happened?</span>
          <Seg options={TYPES} value={type} onChange={setType} label="Transaction type" />
        </div>
        <div className="field">
          <span className="label">Stock</span>
          {symbol ? (
            <div className="row">
              <span className="chip on">
                <b>{symbol}</b> {name !== symbol ? name : ''}
                {!edit && !presetSymbol && (
                  <button className="x" onClick={() => setSymbol('')} aria-label="Choose a different stock">
                    ×
                  </button>
                )}
              </span>
              {stockCcy && foreign && <span className="badge warn">Priced in {stockCcy}</span>}
            </div>
          ) : (
            <TickerSearch autoFocus types={['EQUITY', 'ETF', 'MUTUALFUND']} onPick={(r) => { setSymbol(r.symbol); rememberMeta(r.symbol, { name: r.name, sector: r.sector, industry: r.industry, type: r.type }); }} />
          )}
        </div>
        <div className="form two">
          <TextField label="Date" type="date" value={date} max={todayIso()} onChange={setDate} />
          {(type === 'buy' || type === 'sell') && (
            <NumberField label="Quantity" value={qty} onChange={setQty} min={0} decimals={4} hint={type === 'sell' && symbol ? `You held ${+heldOnDate.toFixed(4)} on this date` : 'Number of shares'} />
          )}
          {type === 'split' && (
            <NumberField label="New shares per old share" value={qty} onChange={setQty} min={0} decimals={4} tip="A 1:5 split turns 1 share into 5, so enter 5. A 1:1 bonus gives 1 extra share for each held, so enter 2. Your total cost stays the same; the cost per share falls." />
          )}
          {type === 'dividend' && <MoneyField label="Dividend received (total)" currency={portfolio.currency} value={amount} onChange={setAmount} min={0} />}
        </div>
        {(type === 'buy' || type === 'sell') && (
          <>
            <div className="form two">
              <NumberField
                label={`Price per share${stockCcy ? ` (${stockCcy})` : ''}`}
                value={price}
                onChange={(v) => { setPrice(v); setPriceNote(null); }}
                min={0}
                decimals={4}
                prefix={stockCcy ? currencySymbol(stockCcy).trim() : undefined}
              />
              <MoneyField label="Brokerage and charges" currency={portfolio.currency} value={fees} onChange={setFees} min={0} tip="Brokerage, STT, stamp duty, GST and exchange fees from your contract note. They are added to your cost when you buy and taken off your proceeds when you sell." />
            </div>
            <div className="row">
              <button className="btn sm" onClick={fillPrice} disabled={!symbol || busy}>
                {busy ? 'Looking up…' : 'Use the closing price on this date'}
              </button>
              {priceNote && <span className="tiny muted">{priceNote}</span>}
            </div>
            {foreign && (
              <NumberField label={`Exchange rate: ${portfolio.currency} per 1 ${stockCcy}`} value={fx} onChange={setFx} min={0} decimals={4} hint="Filled in from the rate on the trade date; change it to the rate you actually got." />
            )}
            {total !== null && (
              <Note>
                {type === 'buy' ? 'Total cost' : 'Net proceeds'}: <b>{money(total, portfolio.currency, 2)}</b>
              </Note>
            )}
          </>
        )}
        <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="Why you made this trade" />
        {error && <Note kind="err">{error}</Note>}
      </div>
    </Modal>
  );
}
