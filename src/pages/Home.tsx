import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, Loading } from '../components/ui';
import { GROUPS, TOOLS, toolById } from '../content/tools';
import { LESSONS } from '../content/lessons';
import { getQuotes } from '../lib/data/api';
import { compact, dateTime, signedPct, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { loadLive } from '../lib/portfolioData';
import { useStore, type Portfolio } from '../lib/store';
import { QuoteTiles } from './Markets';

const STRIP = [
  { symbol: '^NSEI', name: 'NIFTY 50' },
  { symbol: '^BSESN', name: 'Sensex' },
  { symbol: '^NSEBANK', name: 'NIFTY Bank' },
  { symbol: 'NIFTY_MIDCAP_100.NS', name: 'NIFTY Midcap 100' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: 'INR=X', name: 'US dollar in ₹' },
  { symbol: 'GC=F', name: 'Gold, $ per oz' },
];

function PortfolioRow({ p }: { p: Portfolio }) {
  const live = useAsync(() => loadLive(p), [p.id, p.updatedAt]);
  const v = live.data?.valuation;
  return (
    <tr>
      <td>
        <Link className="strong" to={`/portfolio/${p.id}`}>
          {p.name}
        </Link>
        <span className="sub">{v ? `${v.positions.length} holdings` : `${p.txns.length} transactions`}</span>
      </td>
      <td className="r">{v && v.total > 0 ? compact(v.total, p.currency) : live.loading ? '…' : '—'}</td>
      <td className={'r ' + tone(v?.dayChangePct)}>{v ? signedPct(v.dayChangePct, 2) : ''}</td>
      <td className={'r ' + tone(v?.unrealisedPct)}>{v ? signedPct(v.unrealisedPct) : ''}</td>
    </tr>
  );
}

export default function Home() {
  const portfolios = useStore((s) => s.portfolios);
  const favourites = useStore((s) => s.favourites);
  const recents = useStore((s) => s.recents);
  const done = useStore((s) => s.lessonsDone);
  const quotes = useAsync(() => getQuotes(STRIP.map((s) => s.symbol)), []);
  useEffect(() => {
    document.title = 'Artha — Finance workbench';
  }, []);
  const next = LESSONS.find((l) => !done.includes(l.id));
  const favTools = favourites.map(toolById).filter((t): t is NonNullable<typeof t> => !!t);
  const recentTools = recents.map(toolById).filter((t): t is NonNullable<typeof t> => !!t && !favourites.includes(t.id)).slice(0, 5);

  return (
    <>
      <header className="page-head">
        <div className="grow">
          <h1 style={{ fontSize: 30 }}>Learn finance by doing it</h1>
          <p className="lede">
            Research any Indian or global stock, build and stress-test your own portfolio, value a company, and plan your money. Every tool explains itself in plain words and shows its working, so you understand the answer as well as get
            it.
          </p>
        </div>
      </header>

      <section className="mb">
        {quotes.loading && !quotes.data ? <Loading height={64} /> : <QuoteTiles refs={STRIP} quotes={quotes.data?.quotes ?? {}} />}
        <div className="row between mt-s">
          <span className="tiny muted">{quotes.error ? `Market data is unavailable right now (${quotes.error}). The calculators still work.` : quotes.data ? `Yahoo Finance, delayed. Fetched ${dateTime(quotes.data.fetchedAt)}.` : ''}</span>
          <Link className="small" to="/markets">
            Full market overview →
          </Link>
        </div>
      </section>

      <div className="grid cols-2">
        <Card title="Your portfolios" right={<Link className="btn sm" to="/portfolio">{portfolios.length ? 'Open the studio' : 'Get started'}</Link>} flush={portfolios.length > 0}>
          {portfolios.length === 0 ? (
            <>
              <p className="dim">You have not built a portfolio yet. Record the stocks you own, or try ideas with pretend money, and see gains, risk, allocation and tax in one place.</p>
              <div className="row">
                <Link className="btn primary" to="/portfolio">
                  Build a portfolio
                </Link>
                <Link className="btn" to="/screener">
                  Find stocks first
                </Link>
              </div>
            </>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th className="r">Value</th>
                  <th className="r">Today</th>
                  <th className="r">Overall</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((p) => (
                  <PortfolioRow key={p.id} p={p} />
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="New to investing? Start here">
          <ol className="steps">
            <li>
              <div>
                <b>Learn the basics</b>
                {next ? (
                  <>
                    {done.length ? `${done.length} of ${LESSONS.length} lessons done. Next: ` : 'Short lessons, in order. Begin with: '}
                    <Link to={`/learn/${next.id}`}>{next.title}</Link> ({next.minutes} min).
                  </>
                ) : (
                  <>You have finished every lesson. Revisit any of them in the <Link to="/learn">Learning centre</Link>.</>
                )}
              </div>
            </li>
            <li>
              <div>
                <b>Look up a company you know</b>
                Open <Link to="/stock/RELIANCE.NS">Reliance</Link>, <Link to="/stock/TCS.NS">TCS</Link> or <Link to="/stock/HDFCBANK.NS">HDFC Bank</Link> and read the “In plain words” box.
              </div>
            </li>
            <li>
              <div>
                <b>Build a practice portfolio</b>
                Pick a few stocks in the <Link to="/portfolio">Portfolio studio</Link>, then see how the mix would have behaved in the <Link to="/backtest">Backtester</Link>.
              </div>
            </li>
            <li>
              <div>
                <b>Plan your own money</b>
                Work out a monthly investment for a goal with the <Link to="/calc/invest?tab=goal">goal planner</Link>.
              </div>
            </li>
          </ol>
        </Card>
      </div>

      {(favTools.length > 0 || recentTools.length > 0) && (
        <div className="grid cols-2 mt">
          {favTools.length > 0 && (
            <Card title="Your favourites">
              <div className="chips">
                {favTools.map((t) => (
                  <Link key={t.id} className="chip on" to={t.path}>
                    ★ {t.title}
                  </Link>
                ))}
              </div>
            </Card>
          )}
          {recentTools.length > 0 && (
            <Card title="Recently used">
              <div className="chips">
                {recentTools.map((t) => (
                  <Link key={t.id} className="chip" to={t.path}>
                    {t.title}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.name} className="mt">
          <div className="row" style={{ alignItems: 'baseline', marginBottom: 8 }}>
            <h2>{g.name}</h2>
            <span className="small muted">{g.blurb}</span>
          </div>
          <div className="grid cols-auto">
            {TOOLS.filter((t) => t.group === g.name).map((t) => (
              <Link key={t.id} className="toolcard" to={t.path}>
                <h3>{t.title}</h3>
                <p>{t.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
