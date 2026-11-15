import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../../components/Page';
import { Card, Empty, Modal, Note, SelectField, TextField, toast } from '../../components/ui';
import { BENCHMARKS } from '../../lib/data/symbols';
import { readFile } from '../../lib/csv';
import { compact, signedPct, tone } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { buildSampleTxns, loadLive } from '../../lib/portfolioData';
import { createPortfolio, uid, useStore, type Portfolio } from '../../lib/store';

const CURRENCIES = [
  { value: 'INR', label: 'Indian rupee (₹)' },
  { value: 'USD', label: 'US dollar ($)' },
  { value: 'GBP', label: 'British pound (£)' },
];

function PortfolioCard({ p }: { p: Portfolio }) {
  const live = useAsync(() => loadLive(p), [p.id, p.updatedAt]);
  const v = live.data?.valuation;
  return (
    <Link to={`/portfolio/${p.id}`} className="toolcard">
      <div className="tag">
        {p.currency} · {p.txns.length} transaction{p.txns.length === 1 ? '' : 's'}
        {p.sample ? ' · example' : ''}
      </div>
      <h3 style={{ fontSize: 16 }}>{p.name}</h3>
      {live.loading && !v ? (
        <p>Loading prices…</p>
      ) : live.error ? (
        <p>Prices unavailable right now. Open to see your holdings.</p>
      ) : v && v.total > 0 ? (
        <p className="num">
          <b style={{ color: 'var(--text)', fontSize: 17 }}>{compact(v.total, p.currency)}</b>{' '}
          <span className={tone(v.unrealised)}>{signedPct(v.unrealisedPct)} overall</span>
          {v.dayChangePct !== null && <span className={tone(v.dayChange)}> · {signedPct(v.dayChangePct, 2)} today</span>}
        </p>
      ) : (
        <p>Empty. Open it and add your first stock.</p>
      )}
    </Link>
  );
}

export function NewPortfolioModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [benchmark, setBenchmark] = useState('^NSEI');
  const navigate = useNavigate();
  const create = () => {
    const id = createPortfolio(name || 'My portfolio', currency, benchmark);
    onClose();
    navigate(`/portfolio/${id}`);
  };
  return (
    <Modal
      title="New portfolio"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create}>
            Create portfolio
          </button>
        </>
      }
    >
      <div className="form">
        <TextField label="Name" value={name} onChange={setName} placeholder="For example: Long-term India" />
        <SelectField
          label="Currency"
          tip="Everything in this portfolio is valued in this currency. Foreign stocks are converted at the day's exchange rate."
          value={currency}
          onChange={(c) => {
            setCurrency(c);
            setBenchmark(c === 'INR' ? '^NSEI' : c === 'GBP' ? '^FTSE' : '^GSPC');
          }}
          options={CURRENCIES}
        />
        <SelectField
          label="Benchmark"
          tip="The index you want to beat. If your portfolio cannot beat a low-cost index fund over time, the index fund is the better choice."
          value={benchmark}
          onChange={setBenchmark}
          options={BENCHMARKS.map((b) => ({ value: b.symbol, label: b.name }))}
        />
      </div>
    </Modal>
  );
}

export default function PortfolioList() {
  const portfolios = useStore((s) => s.portfolios);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const txns = await buildSampleTxns();
      if (!txns.length) throw new Error('Could not fetch prices for the example trades. Check your connection and try again.');
      const id = createPortfolio('Example portfolio', 'INR', '^NSEI', { txns, sample: true, cash: 25_000 });
      navigate(`/portfolio/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await readFile(file));
      const src = parsed?.portfolio ?? parsed;
      if (!src || !Array.isArray(src.txns)) throw new Error('That file is not a portfolio exported from Artha.');
      const id = createPortfolio(String(src.name ?? 'Imported portfolio'), String(src.currency ?? 'INR'), String(src.benchmark ?? '^NSEI'), {
        txns: src.txns.map((t: any) => ({ ...t, id: uid() })),
        targets: src.targets ?? {},
        cashTarget: Number(src.cashTarget) || 0,
        cash: Number(src.cash) || 0,
      });
      toast('Portfolio imported');
      navigate(`/portfolio/${id}`);
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file is not valid JSON.' : (e as Error).message);
    }
  };

  return (
    <Page
      tool="portfolio"
      actions={
        <>
          <label className="btn sm">
            Import portfolio file
            <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            New portfolio
          </button>
        </>
      }
    >
      {error && <Note kind="err" className="mb">{error}</Note>}
      {portfolios.length === 0 ? (
        <Card>
          <Empty title="Build your first portfolio">
            <p>
              Record what you own (or what you are thinking of buying) and the studio works out your gains, allocation, risk, tax and what to trade to stay on target. Everything is saved in this browser only.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setCreating(true)}>
                Create a portfolio
              </button>
              <button className="btn" onClick={loadSample} disabled={busy}>
                {busy ? 'Building example…' : 'Explore with an example portfolio'}
              </button>
            </div>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid cols-3">
            {portfolios.map((p) => (
              <PortfolioCard key={p.id} p={p} />
            ))}
          </div>
          <div className="row mt">
            <button className="btn sm" onClick={loadSample} disabled={busy}>
              {busy ? 'Building example…' : 'Add an example portfolio'}
            </button>
            <span className="tiny muted">The example uses hypothetical trades priced at real historical closing prices.</span>
          </div>
        </>
      )}
      <Card title="How the studio works" className="mt">
        <ol className="steps">
          <li>
            <div>
              <b>Record your trades</b>Add each buy with its date, quantity and price, or import a CSV from your broker. Sells, dividends, splits and bonuses are supported.
            </div>
          </li>
          <li>
            <div>
              <b>See where you stand</b>Live value, gain on each stock, your true annual return (XIRR), and how your money is spread across stocks, sectors and company sizes.
            </div>
          </li>
          <li>
            <div>
              <b>Set targets and rebalance</b>Decide what share each stock should have, then get an exact list of trades to bring the portfolio back on target.
            </div>
          </li>
          <li>
            <div>
              <b>Check risk, performance and tax</b>Compare against the NIFTY 50, see how deep past falls were, and estimate capital-gains tax before you sell.
            </div>
          </li>
        </ol>
      </Card>
      {creating && <NewPortfolioModal onClose={() => setCreating(false)} />}
    </Page>
  );
}
