import { useEffect, type ReactNode } from 'react';
import { toolById } from '../content/tools';
import { EXPLAIN } from '../content/explain';
import { noteRecent, toggleFavourite, useStore } from '../lib/store';

/** The learning panel under every tool: what it is, how to read it, the formula, an example, and the traps. */
export function Explain({ id, open }: { id: string; open?: boolean }) {
  const e = EXPLAIN[id];
  if (!e) return null;
  return (
    <details className="explain mt" open={open}>
      <summary>Understand this tool: what it does, the maths, and common mistakes</summary>
      <div className="body">
        <section>
          <h4>What it does</h4>
          <p>{e.what}</p>
        </section>
        <section>
          <h4>Why it matters</h4>
          <p>{e.why}</p>
        </section>
        <section className="full">
          <h4>How to read the results</h4>
          <p>{e.read}</p>
        </section>
        {e.formula && (
          <section className="full">
            <h4>The maths</h4>
            <div className="formula">{e.formula}</div>
          </section>
        )}
        {e.example && (
          <section className="full">
            <h4>Worked example</h4>
            <p>{e.example}</p>
          </section>
        )}
        <section>
          <h4>Common mistakes</h4>
          <ul>
            {e.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Limits and assumptions</h4>
          <ul>
            {e.limits.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}

interface PageProps {
  /** tool id from the directory; supplies the title, section and learning panel */
  tool?: string;
  title?: string;
  lede?: ReactNode;
  crumb?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** hide the learning panel (when the page places it itself) */
  noExplain?: boolean;
}

export function Page({ tool, title, lede, crumb, actions, children, noExplain }: PageProps) {
  const t = tool ? toolById(tool) : undefined;
  const heading = title ?? t?.title ?? '';
  const fav = useStore((s) => (t ? s.favourites.includes(t.id) : false));
  useEffect(() => {
    document.title = heading ? `${heading} · Artha` : 'Artha — Finance workbench';
    if (t) noteRecent(t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading, t?.id]);
  return (
    <>
      <header className="page-head">
        <div className="grow">
          <div className="crumb">{crumb ?? t?.group ?? ''}</div>
          <h1>{heading}</h1>
          {(lede ?? t?.blurb) && <p className="lede">{lede ?? t?.blurb}</p>}
        </div>
        <div className="actions">
          {actions}
          {t && (
            <button className={'btn sm' + (fav ? ' on' : '')} onClick={() => toggleFavourite(t.id)} aria-pressed={fav} title={fav ? 'Remove from favourites' : 'Add to favourites'}>
              {fav ? '★ Favourite' : '☆ Favourite'}
            </button>
          )}
        </div>
      </header>
      {children}
      {t && !noExplain && <Explain id={t.id} />}
    </>
  );
}
