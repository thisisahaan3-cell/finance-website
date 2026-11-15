import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Page } from '../components/Page';
import { Card, Empty } from '../components/ui';
import { GLOSSARY } from '../content/glossary';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function Glossary() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const location = useLocation();
  const cats = useMemo(() => ['All', ...new Set(GLOSSARY.map((g) => g.cat))], []);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term)).filter((g) => (cat === 'All' || g.cat === cat) && (!needle || g.term.toLowerCase().includes(needle) || g.def.toLowerCase().includes(needle)));
  }, [q, cat]);
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.style.background = 'var(--accent-soft)';
      const t = setTimeout(() => (el.style.background = ''), 2500);
      return () => clearTimeout(t);
    }
  }, [location.hash]);
  return (
    <Page tool="glossary" noExplain>
      <Card>
        <div className="row">
          <input className="input" style={{ maxWidth: 340 }} placeholder={`Search ${GLOSSARY.length} terms…`} aria-label="Search the glossary" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            {cats.map((c) => (
              <button key={c} className={'chip' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </Card>
      <Card className="mt" flush>
        {list.length === 0 ? (
          <Empty title="No term matches">
            <p>Try a shorter word, or choose “All”.</p>
          </Empty>
        ) : (
          <dl style={{ margin: 0 }}>
            {list.map((g) => (
              <div key={g.term} id={slug(g.term)} style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', transition: 'background 0.4s' }}>
                <dt className="row" style={{ gap: 8 }}>
                  <span className="strong" style={{ fontSize: 14.5 }}>{g.term}</span>
                  <span className="badge">{g.cat}</span>
                </dt>
                <dd className="dim" style={{ margin: '3px 0 0', maxWidth: 860 }}>
                  {g.def}
                  {g.see && (
                    <>
                      {' '}
                      <Link to={g.see}>See it in use →</Link>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </Page>
  );
}
