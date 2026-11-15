import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { GROUPS, TOOLS } from '../content/tools';
import { GLOSSARY } from '../content/glossary';
import { LESSONS } from '../content/lessons';
import { setSettings, storageFailed, useStore } from '../lib/store';
import { useDebounced } from '../lib/hooks';
import { findSymbols } from './TickerSearch';
import { ToastHost } from './ui';
import type { SearchResult } from '../lib/data/api';

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1e25' : '#ffffff');
}

interface Option {
  group: string;
  title: string;
  sub: string;
  to: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Global search: tools, stocks (live), lessons and glossary terms in one box. */
function Palette({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [stocks, setStocks] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 200);
  const navigate = useNavigate();
  const run = useRef(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < 2) {
      setStocks([]);
      setSearching(false);
      return;
    }
    const id = ++run.current;
    setSearching(true);
    findSymbols(q).then(
      (r) => id === run.current && (setStocks(r.slice(0, 6)), setSearching(false)),
      () => id === run.current && (setStocks([]), setSearching(false)),
    );
  }, [q]);

  const options = useMemo<Option[]>(() => {
    const needle = text.trim().toLowerCase();
    const words = needle.split(/\s+/).filter(Boolean);
    const hit = (hay: string) => words.every((w) => hay.includes(w));
    // a match in the title outranks a match in the keywords, which outranks one in the description
    const rank = (t: (typeof TOOLS)[number]) => (hit(t.title.toLowerCase()) ? 0 : hit((t.title + ' ' + t.keywords).toLowerCase()) ? 1 : 2);
    const tools = TOOLS.filter((t) => !needle || hit((t.title + ' ' + t.keywords + ' ' + t.blurb).toLowerCase()))
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (needle ? rank(a.t) - rank(b.t) : 0) || a.i - b.i)
      .map(({ t }) => ({ group: 'Tools', title: t.title, sub: t.group, to: t.path }));
    if (!needle) return tools;
    const out: Option[] = [...tools.slice(0, 6)];
    for (const s of stocks) out.push({ group: 'Stocks and indices', title: `${s.symbol} — ${s.name}`, sub: s.exchange, to: `/stock/${encodeURIComponent(s.symbol)}` });
    for (const l of LESSONS.filter((l) => hit((l.title + ' ' + l.summary).toLowerCase())).slice(0, 4)) out.push({ group: 'Lessons', title: l.title, sub: `${l.minutes} min read`, to: `/learn/${l.id}` });
    for (const g of GLOSSARY.filter((g) => hit(g.term.toLowerCase())).slice(0, 5)) out.push({ group: 'Glossary', title: g.term, sub: 'Definition', to: `/glossary#${slug(g.term)}` });
    return out;
  }, [text, stocks]);

  useEffect(() => setActive(0), [options.length, text]);
  useEffect(() => {
    list.current?.querySelector('.opt.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (o: Option) => {
    navigate(o.to);
    onClose();
  };

  let lastGroup = '';
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search">
        <input
          autoFocus
          value={text}
          placeholder="Search tools, stocks, lessons and terms…"
          aria-label="Search everything"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && options[active]) go(options[active]);
          }}
        />
        <div className="results" ref={list}>
          {options.map((o, i) => {
            const head = o.group !== lastGroup ? <div className="group">{o.group}</div> : null;
            lastGroup = o.group;
            return (
              <div key={o.group + o.to + i}>
                {head}
                <div className={'opt' + (i === active ? ' on' : '')} onMouseEnter={() => setActive(i)} onClick={() => go(o)}>
                  <span className="t">{o.title}</span>
                  <span className="s">{o.sub}</span>
                </div>
              </div>
            );
          })}
          {searching && <div className="group">Searching stocks…</div>}
          {!options.length && !searching && <div className="empty">Nothing matches “{text}”.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const theme = useStore((s) => s.settings.theme);
  const location = useLocation();

  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const apply = () => {
      applyTheme(theme);
      setIsDark(document.documentElement.dataset.theme === 'dark');
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    setNavOpen(false);
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);


  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <Link to="/">Artha</Link>
          <span>Finance workbench</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          {GROUPS.map((g) => (
            <div key={g.name}>
              <h4>{g.name}</h4>
              {TOOLS.filter((t) => t.group === g.name).map((t) => (
                <NavLink key={t.id} to={t.path}>
                  {t.title}
                </NavLink>
              ))}
            </div>
          ))}
          <h4>App</h4>
          <NavLink to="/settings">Data &amp; settings</NavLink>
        </nav>
        <div className="sidebar-foot">Made by Ahaan Gupta</div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button className="btn icon menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            ☰
          </button>
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search">
            <span>Search tools, stocks, lessons…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-right">
            <button className="btn sm" onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })} aria-label="Switch between light and dark theme">
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>
        <main className="content" id="main">
          {storageFailed() && (
            <div className="note warn mb">Your browser is blocking storage, so changes will not be saved after you close this tab. Use Data &amp; settings → Export backup to keep a copy.</div>
          )}
          {children}
        </main>
        <footer className="footer">
          <p>
            Artha is a learning and research tool, not investment advice. Market data comes from Yahoo Finance, can be delayed or wrong, and should be checked before you act on it. Your portfolios and settings are
            stored only in this browser.
          </p>
        </footer>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
      <ToastHost />
    </div>
  );
}
