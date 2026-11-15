import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page, Explain } from '../../components/Page';
import { Card, Empty, ErrorNote, Modal, Note, SelectField, Source, Tabs, TextField, toast } from '../../components/ui';
import { BENCHMARKS } from '../../lib/data/symbols';
import { download } from '../../lib/csv';
import { useAsync } from '../../lib/hooks';
import { ensureClassified, loadLive, type Live } from '../../lib/portfolioData';
import { deletePortfolio, patchPortfolio, useStore, type Portfolio } from '../../lib/store';
import type { TxnType } from '../../lib/finance/portfolio';
import { TxnForm } from './TxnForm';
import { HoldingsTab, TransactionsTab } from './TabsA';
import { AllocationTab, RebalanceTab } from './TabsB';
import { PerformanceTab, RiskTab, TaxTab } from './TabsC';

export interface TabProps {
  p: Portfolio;
  live: Live | null;
  loading: boolean;
  openTxn: (opts?: { symbol?: string; type?: TxnType; editId?: string }) => void;
  setTab: (t: TabId) => void;
}

export type TabId = 'holdings' | 'transactions' | 'allocation' | 'rebalance' | 'performance' | 'risk' | 'tax';

const TABS: { value: TabId; label: string }[] = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'allocation', label: 'Allocation & targets' },
  { value: 'rebalance', label: 'Rebalance' },
  { value: 'performance', label: 'Performance' },
  { value: 'risk', label: 'Risk' },
  { value: 'tax', label: 'Tax & income' },
];

function EditModal({ p, onClose }: { p: Portfolio; onClose: () => void }) {
  const [name, setName] = useState(p.name);
  const [benchmark, setBenchmark] = useState(p.benchmark);
  return (
    <Modal
      title="Portfolio settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              patchPortfolio(p.id, (x) => ({ ...x, name: name.trim() || x.name, benchmark, sample: false }));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <TextField label="Name" value={name} onChange={setName} />
        <SelectField label="Benchmark" value={benchmark} onChange={setBenchmark} options={BENCHMARKS.map((b) => ({ value: b.symbol, label: b.name }))} />
        <p className="small muted">Currency: {p.currency}. The currency is fixed once a portfolio is created, because every trade's cost is stored in it.</p>
      </div>
    </Modal>
  );
}

export default function Studio() {
  const { id } = useParams();
  const p = useStore((s) => s.portfolios.find((x) => x.id === id));
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'holdings') as TabId;
  const setTab = (t: TabId) => setParams(t === 'holdings' ? {} : { tab: t }, { replace: true });
  const [txn, setTxn] = useState<{ symbol?: string; type?: TxnType; editId?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [force, setForce] = useState(0);
  const navigate = useNavigate();

  const live = useAsync(p ? () => loadLive(p, force > 0) : null, [p?.id, p?.updatedAt, force]);
  const symbols = live.data ? live.data.valuation.positions.map((x) => x.symbol).join(',') : '';
  useEffect(() => {
    if (symbols) void ensureClassified(symbols.split(','));
  }, [symbols]);

  if (!p) {
    return (
      <Page title="Portfolio not found" crumb="Portfolio">
        <Card>
          <Empty title="This portfolio does not exist in this browser">
            <p>Portfolios are stored on the device where they were created. If you made it elsewhere, export it there and import the file here.</p>
            <Link className="btn primary" to="/portfolio">
              Go to my portfolios
            </Link>
          </Empty>
        </Card>
      </Page>
    );
  }

  const exportJson = () => {
    download(`${p.name.replace(/[^\w-]+/g, '_')}.portfolio.json`, JSON.stringify({ app: 'artha', portfolio: p }, null, 2), 'application/json');
    toast('Portfolio file downloaded');
  };
  const remove = () => {
    if (!window.confirm(`Delete “${p.name}” and all ${p.txns.length} of its transactions? This cannot be undone. Export it first if you may want it back.`)) return;
    deletePortfolio(p.id);
    navigate('/portfolio');
  };

  const props: TabProps = { p, live: live.data, loading: live.loading, openTxn: (o) => setTxn(o ?? {}), setTab };
  const editTxn = txn?.editId ? p.txns.find((t) => t.id === txn.editId) : undefined;

  return (
    <Page
      title={p.name}
      crumb="Portfolio studio"
      lede={
        p.sample ? 'An example portfolio: hypothetical trades priced at real past closing prices. Change anything, or delete it and build your own.' : `Valued in ${p.currency} against ${BENCHMARKS.find((b) => b.symbol === p.benchmark)?.name ?? p.benchmark}.`
      }
      actions={
        <>
          <button className="btn primary sm" onClick={() => setTxn({})}>
            Add transaction
          </button>
          <button className="btn sm" onClick={() => setForce((f) => f + 1)} disabled={live.loading}>
            {live.loading ? 'Refreshing…' : 'Refresh prices'}
          </button>
          <button className="btn sm" onClick={() => setEditing(true)}>
            Settings
          </button>
          <button className="btn sm" onClick={exportJson}>
            Export
          </button>
          <button className="btn sm danger" onClick={remove}>
            Delete
          </button>
        </>
      }
    >
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {live.error && <div className="mb"><ErrorNote error={`Live prices could not be loaded: ${live.error}`} retry={live.reload} /></div>}
      {live.data?.missing.length ? (
        <Note kind="warn" className="mb">
          No live price for {live.data.missing.join(', ')}. These holdings are shown at cost and left out of totals that need a market value.
        </Note>
      ) : null}
      {live.data?.ledger.issues.length ? (
        <Note kind="warn" className="mb">
          {live.data.ledger.issues.map((i) => (
            <div key={i}>{i}</div>
          ))}
        </Note>
      ) : null}
      {tab === 'holdings' && <HoldingsTab {...props} />}
      {tab === 'transactions' && <TransactionsTab {...props} />}
      {tab === 'allocation' && <AllocationTab {...props} />}
      {tab === 'rebalance' && <RebalanceTab {...props} />}
      {tab === 'performance' && <PerformanceTab {...props} />}
      {tab === 'risk' && <RiskTab {...props} />}
      {tab === 'tax' && <TaxTab {...props} />}
      <div className="mt">
        <Source at={live.data?.fetchedAt} />
      </div>
      <Explain id={`portfolio-${tab}`} />
      {txn && <TxnForm portfolio={p} edit={editTxn} symbol={txn.symbol} type={txn.type} onClose={() => setTxn(null)} />}
      {editing && <EditModal p={p} onClose={() => setEditing(false)} />}
    </Page>
  );
}
