import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { POPULAR_GLOBAL, POPULAR_INDIA, shortSymbol } from '../lib/data/symbols';
import { num } from '../lib/format';
import { loadLive } from '../lib/portfolioData';
import { getState, rememberMeta, useSaved, useStore } from '../lib/store';
import { TickerSearch } from './TickerSearch';
import { CellInput, Note } from './ui';

export interface BasketItem {
  symbol: string;
  /** percent of the basket */
  weight: number;
}

const equalise = (items: BasketItem[]): BasketItem[] => {
  if (!items.length) return items;
  const w = Number((100 / items.length).toFixed(2));
  return items.map((it, i) => ({ ...it, weight: i === items.length - 1 ? Number((100 - w * (items.length - 1)).toFixed(2)) : w }));
};

/** A basket of symbols with weights, remembered per tool, that can be seeded from a saved portfolio (?portfolio=id). */
export function useBasket(key: string, defaults: BasketItem[]) {
  const [saved, set] = useSaved<{ items: BasketItem[] }>(`basket:${key}`, { items: defaults });
  const [params, setParams] = useSearchParams();
  const [seeding, setSeeding] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const setItems = (items: BasketItem[]) => set({ items });

  const fromPortfolio = async (id: string) => {
    const p = getState().portfolios.find((x) => x.id === id);
    if (!p) return;
    setSeeding(p.name);
    setSeedError(null);
    try {
      const live = await loadLive(p);
      const pos = live.valuation.positions.filter((x) => x.value && x.value > 0);
      const total = pos.reduce((s, x) => s + x.value!, 0);
      if (!pos.length) throw new Error(`“${p.name}” has no priced holdings to load.`);
      setItems(pos.map((x) => ({ symbol: x.symbol, weight: Number(((x.value! / total) * 100).toFixed(2)) })));
    } catch (e) {
      setSeedError((e as Error).message);
    }
    setSeeding(null);
  };

  useEffect(() => {
    const id = params.get('portfolio');
    if (!id) return;
    void fromPortfolio(id);
    const next = new URLSearchParams(params);
    next.delete('portfolio');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items: saved.items, setItems, fromPortfolio, seeding, seedError };
}

interface Props {
  items: BasketItem[];
  onChange: (items: BasketItem[]) => void;
  onLoadPortfolio?: (id: string) => void;
  seeding?: string | null;
  seedError?: string | null;
  /** hide the weight inputs (for tools that only need a list) */
  noWeights?: boolean;
  max?: number;
  types?: string[];
}

export function BasketPicker({ items, onChange, onLoadPortfolio, seeding, seedError, noWeights, max = 30, types }: Props) {
  const meta = useStore((s) => s.symbolMeta);
  const portfolios = useStore((s) => s.portfolios);
  const [more, setMore] = useState(false);
  const total = items.reduce((s, it) => s + (it.weight || 0), 0);
  const has = (symbol: string) => items.some((it) => it.symbol === symbol);
  const add = (symbol: string, name?: string) => {
    if (has(symbol) || items.length >= max) return;
    if (name) rememberMeta(symbol, { name });
    onChange(noWeights ? [...items, { symbol, weight: 0 }] : equalise([...items, { symbol, weight: 0 }]));
  };
  const suggestions = [...POPULAR_INDIA, ...(more ? POPULAR_GLOBAL : [])].filter((r) => !has(r.symbol));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <TickerSearch types={types ?? ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CURRENCY', 'FUTURE', 'CRYPTOCURRENCY']} placeholder="Add a stock, ETF or index…" onPick={(r) => { rememberMeta(r.symbol, { name: r.name, sector: r.sector, industry: r.industry, type: r.type }); add(r.symbol); }} />
      {items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl compact">
            <tbody>
              {items.map((it) => (
                <tr key={it.symbol}>
                  <td>
                    <span className="strong">{shortSymbol(it.symbol)}</span>
                    <span className="sub">{meta[it.symbol]?.name ?? it.symbol}</span>
                  </td>
                  {!noWeights && (
                    <td className="r" style={{ width: 96 }}>
                      <CellInput width={62} min={0} max={100} label={`Weight of ${it.symbol} in percent`} value={it.weight} allowEmpty onChange={(n) => onChange(items.map((x) => (x.symbol === it.symbol ? { ...x, weight: n ?? 0 } : x)))} /> %
                    </td>
                  )}
                  <td className="r" style={{ width: 34 }}>
                    <button className="btn sm ghost icon" aria-label={`Remove ${it.symbol}`} onClick={() => onChange(items.filter((x) => x.symbol !== it.symbol))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {!noWeights && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className={'r ' + (Math.abs(total - 100) < 0.05 ? 'pos' : 'neg')}>{num(total, 1)}%</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <div className="row">
        {!noWeights && items.length > 1 && (
          <button className="btn sm" onClick={() => onChange(equalise(items))}>
            Equal weights
          </button>
        )}
        {items.length > 0 && (
          <button className="btn sm ghost" onClick={() => onChange([])}>
            Clear
          </button>
        )}
        {onLoadPortfolio && portfolios.length > 0 && (
          <select className="select" style={{ width: 'auto', height: 28, fontSize: 12.5 }} value="" aria-label="Load holdings from a saved portfolio" onChange={(e) => e.target.value && onLoadPortfolio(e.target.value)}>
            <option value="">Load from my portfolio…</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {seeding && <span className="tiny muted">Loading holdings from “{seeding}”…</span>}
      {seedError && <Note kind="err">{seedError}</Note>}
      {!noWeights && items.length > 0 && Math.abs(total - 100) >= 0.05 && <Note kind="warn">Weights add up to {num(total, 1)}%. They need to total 100%.</Note>}
      {items.length < max && suggestions.length > 0 && (
        <div>
          <div className="tiny muted mb-s">Quick add:</div>
          <div className="chips">
            {suggestions.slice(0, more ? 24 : 10).map((r) => (
              <button key={r.symbol} className="chip" onClick={() => add(r.symbol, r.name)}>
                + {r.name}
              </button>
            ))}
            <button className="chip" onClick={() => setMore((m) => !m)}>
              {more ? 'Fewer' : 'More, incl. US and UK'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
