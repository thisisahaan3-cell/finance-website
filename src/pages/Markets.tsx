import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Sparkline } from '../components/charts';
import { Page } from '../components/Page';
import { Card, ErrorNote, Loading, Seg, Source } from '../components/ui';
import { getChart, getQuotes, screen, type Quote } from '../lib/data/api';
import { toDaily } from '../lib/data/series';
import { COMMODITIES, CURRENCIES, GLOBAL_INDICES, INDIA_INDICES, SECTOR_INDICES, shortSymbol, type Ref } from '../lib/data/symbols';
import { compact, num, signedPct, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';

export function QuoteTiles({ refs, quotes, decimals = 2 }: { refs: Ref[]; quotes: Record<string, Quote>; decimals?: number }) {
  return (
    <div className="tiles">
      {refs.map((r) => {
        const q = quotes[r.symbol];
        const chg = q?.regularMarketChangePercent;
        return (
          <Link key={r.symbol} className="tile" to={`/stock/${encodeURIComponent(r.symbol)}`} title={r.note}>
            <div className="n">{r.name}</div>
            <div className="p">{q?.regularMarketPrice != null ? num(q.regularMarketPrice, q.regularMarketPrice < 200 ? Math.max(decimals, 2) : decimals) : '—'}</div>
            <div className={'c ' + tone(chg)}>{chg != null ? signedPct(chg / 100, 2) : 'unavailable'}</div>
          </Link>
        );
      })}
    </div>
  );
}

type Period = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';
const DAYS: Record<Period, number> = { '1D': 1, '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 250 };

function Movers({ title, dir }: { title: string; dir: 'asc' | 'desc' }) {
  const data = useAsync(() => screen({ market: 'NSE', filters: [{ field: 'marketCap', min: 2e11 }], sort: 'change', dir, size: 8 }), [dir]);
  return (
    <Card title={title} sub="NSE companies worth over ₹20,000 Cr" flush>
      {data.loading && !data.data ? (
        <Loading />
      ) : data.error ? (
        <div style={{ padding: 12 }}>
          <ErrorNote error={data.error} retry={data.reload} />
        </div>
      ) : (
        <table className="tbl compact">
          <tbody>
            {data.data?.quotes.map((q) => (
              <tr key={q.symbol}>
                <td>
                  <Link to={`/stock/${encodeURIComponent(q.symbol)}`}>{shortSymbol(q.symbol)}</Link>
                  <span className="sub">{q.longName ?? q.shortName}</span>
                </td>
                <td className="r">{num(q.regularMarketPrice, 2)}</td>
                <td className={'r strong ' + tone(q.regularMarketChangePercent)}>{signedPct((q.regularMarketChangePercent ?? NaN) / 100, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function Markets() {
  const [period, setPeriod] = useState<Period>('1M');
  const all = [...INDIA_INDICES, ...GLOBAL_INDICES, ...CURRENCIES, ...COMMODITIES];
  const quotes = useAsync(() => getQuotes(all.map((r) => r.symbol)), []);
  const sectors = useAsync(async () => {
    const res = await Promise.allSettled(SECTOR_INDICES.map((r) => getChart(r.symbol, '1y', '1d')));
    return SECTOR_INDICES.map((r, i) => ({ ref: r, series: res[i].status === 'fulfilled' ? toDaily((res[i] as PromiseFulfilledResult<Awaited<ReturnType<typeof getChart>>>).value) : null }));
  }, []);

  const sectorRows = useMemo(() => {
    if (!sectors.data) return [];
    return sectors.data
      .map(({ ref, series }) => {
        if (!series || series.close.length < 3) return { ref, ret: null as number | null, spark: [] as number[] };
        const n = series.close.length;
        const back = Math.min(DAYS[period], n - 1);
        return { ref, ret: series.close[n - 1] / series.close[n - 1 - back] - 1, spark: series.close.slice(-Math.max(back + 1, 22)) };
      })
      .sort((a, b) => (b.ret ?? -9) - (a.ret ?? -9));
  }, [sectors.data, period]);

  const q = quotes.data?.quotes ?? {};
  return (
    <Page tool="markets" actions={<button className="btn sm" onClick={quotes.reload} disabled={quotes.loading}>{quotes.loading ? 'Refreshing…' : 'Refresh'}</button>}>
      {quotes.error && <div className="mb"><ErrorNote error={quotes.error} retry={quotes.reload} /></div>}
      <div className="stack">
        <section>
          <h2 className="mb-s">India</h2>
          {quotes.loading && !quotes.data ? <Loading height={80} /> : <QuoteTiles refs={INDIA_INDICES} quotes={q} />}
        </section>

        <Card title="Indian sectors" sub="NIFTY sector indices, price change" right={<Seg options={(Object.keys(DAYS) as Period[]).map((p) => ({ value: p, label: p }))} value={period} onChange={setPeriod} label="Period" />}>
          {sectors.loading && !sectors.data ? (
            <Loading height={220} />
          ) : sectors.error ? (
            <ErrorNote error={sectors.error} retry={sectors.reload} />
          ) : (
            <div className="grid cols-2">
              <BarChart data={sectorRows.filter((r) => r.ret !== null).map((r) => ({ label: r.ref.name.length > 9 ? r.ref.name.slice(0, 8) + '…' : r.ref.name, value: r.ret!, note: r.ref.name }))} signed yFormat={(v) => signedPct(v, 0)} height={250} />
              <div className="tbl-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr>
                      <th>Sector</th>
                      <th className="r">Change</th>
                      <th className="r">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectorRows.map((r) => (
                      <tr key={r.ref.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(r.ref.symbol)}`}>{r.ref.name}</Link>
                        </td>
                        <td className={'r strong ' + tone(r.ret)}>{r.ret === null ? 'unavailable' : signedPct(r.ret)}</td>
                        <td className="r">{r.spark.length > 1 && <Sparkline values={r.spark} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="tiny muted mt-s">Leadership rotates: the best sector of one year is often not the best of the next. Use this to understand what is moving, not to chase it.</p>
        </Card>

        <div className="grid cols-2">
          <Movers title="Biggest gainers today" dir="desc" />
          <Movers title="Biggest fallers today" dir="asc" />
        </div>

        <section>
          <h2 className="mb-s">World markets</h2>
          <QuoteTiles refs={GLOBAL_INDICES} quotes={q} />
        </section>
        <div className="grid cols-2">
          <section>
            <h2 className="mb-s">Rupee against major currencies</h2>
            <QuoteTiles refs={CURRENCIES.map((c) => ({ ...c, name: `${c.name} (${c.note})` }))} quotes={q} decimals={2} />
            <p className="tiny muted mt-s">Rupees for one unit of the foreign currency. A rising number means the rupee is weakening.</p>
          </section>
          <section>
            <h2 className="mb-s">Commodities and rates</h2>
            <QuoteTiles refs={COMMODITIES} quotes={q} />
            <p className="tiny muted mt-s">Futures prices in US dollars{q['GC=F']?.regularMarketPrice && q['INR=X']?.regularMarketPrice ? `. Gold works out to about ${compact((q['GC=F'].regularMarketPrice! * q['INR=X'].regularMarketPrice! * 10) / 31.1035, 'INR', 2)} per 10 grams before duties and taxes` : ''}.</p>
          </section>
        </div>
        <Source at={quotes.data?.fetchedAt} />
      </div>
    </Page>
  );
}
