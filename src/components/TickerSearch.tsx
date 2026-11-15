import { useEffect, useRef, useState } from 'react';
import { searchSymbols, type SearchResult } from '../lib/data/api';
import { useDebounced } from '../lib/hooks';

const ALLOWED = new Set(['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CURRENCY', 'FUTURE', 'CRYPTOCURRENCY']);
const rank = (r: SearchResult) => (r.exchangeCode === 'NSI' ? 0 : r.exchangeCode === 'BSE' ? 1 : 2);

/** Search results with Indian listings first (stable within each group). */
export async function findSymbols(q: string, types?: string[]): Promise<SearchResult[]> {
  const res = await searchSymbols(q);
  const allow = types ? new Set(types) : ALLOWED;
  return res
    .filter((r) => allow.has(r.type))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

interface Props {
  onPick: (r: SearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** restrict to instrument types, e.g. ['EQUITY', 'ETF'] */
  types?: string[];
  ariaLabel?: string;
}

/** Type a company name or ticker, pick from live matches. */
export function TickerSearch({ onPick, placeholder, autoFocus, types, ariaLabel }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 220);
  const box = useRef<HTMLDivElement>(null);
  const run = useRef(0);

  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    const id = ++run.current;
    findSymbols(q, types).then(
      (r) => {
        if (id !== run.current) return;
        setResults(r);
        setError(null);
        setActive(0);
      },
      (e) => {
        if (id !== run.current) return;
        setResults([]);
        setError(e.message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (r: SearchResult) => {
    onPick(r);
    setText('');
    setResults(null);
    setOpen(false);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        className="input"
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Search a company or ticker, e.g. Reliance, TCS, Apple'}
        aria-label={ariaLabel ?? 'Search for a stock'}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!results?.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && text.trim().length >= 2 && (
        <div className="dropdown" role="listbox">
          {error && <div className="msg">{error}</div>}
          {!error && results === null && <div className="msg">Searching…</div>}
          {!error && results?.length === 0 && <div className="msg">No matches. Try the company name, or the exact ticker (NSE tickers end in .NS, BSE in .BO).</div>}
          {results?.map((r, i) => (
            <div key={r.symbol} role="option" aria-selected={i === active} className={'opt' + (i === active ? ' on' : '')} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <span className="sym">{r.symbol}</span>
              <span className="nm">{r.name}</span>
              <span className="ex">
                {r.exchange}
                {r.type !== 'EQUITY' ? ' · ' + r.type.toLowerCase() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
