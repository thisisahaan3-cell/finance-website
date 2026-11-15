import { Link } from 'react-router-dom';
import { RangeBar } from '../components/charts';
import { Page } from '../components/Page';
import { TickerSearch } from '../components/TickerSearch';
import { Card, Empty, ErrorNote, Loading, Source, useSort } from '../components/ui';
import { getQuotes } from '../lib/data/api';
import { shortSymbol } from '../lib/data/symbols';
import { compact, num, signedPct, tone } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { rememberMeta, toggleWatch, update, useStore } from '../lib/store';

type Key = 'symbol' | 'price' | 'change' | 'cap' | 'pe' | 'year';

export default function Watchlist() {
  const list = useStore((s) => s.watchlist);
  const data = useAsync(list.length ? () => getQuotes(list) : null, [list.join(',')]);
  const sorter = useSort<Key>('change');
  const q = data.data?.quotes ?? {};
  const rows = sorter.sort(list, (s, k) => (k === 'symbol' ? s : k === 'price' ? q[s]?.regularMarketPrice : k === 'change' ? q[s]?.regularMarketChangePercent : k === 'cap' ? q[s]?.marketCap : k === 'pe' ? q[s]?.trailingPE : q[s]?.fiftyTwoWeekChangePercent));
  const th = (k: Key, label: string, right = true) => (
    <th className={(right ? 'r ' : '') + 'sortable'} onClick={() => sorter.toggle(k)}>
      {label}
      {sorter.mark(k)}
    </th>
  );
  return (
    <Page tool="watchlist" actions={<button className="btn sm" onClick={data.reload} disabled={data.loading || !list.length}>{data.loading ? 'Refreshing…' : 'Refresh'}</button>}>
      <Card title="Add to your watchlist">
        <div style={{ maxWidth: 520 }}>
          <TickerSearch
            onPick={(r) => {
              rememberMeta(r.symbol, { name: r.name, sector: r.sector, industry: r.industry, type: r.type });
              if (!list.includes(r.symbol)) toggleWatch(r.symbol);
            }}
          />
        </div>
      </Card>
      <Card
        title="Watching"
        sub={`${list.length} item${list.length === 1 ? '' : 's'}`}
        className="mt"
        right={
          list.length > 0 ? (
            <button className="btn sm ghost" onClick={() => window.confirm('Remove everything from your watchlist?') && update((s) => ({ ...s, watchlist: [] }))}>
              Clear all
            </button>
          ) : undefined
        }
        flush
      >
        {!list.length ? (
          <Empty title="Your watchlist is empty">
            <p>Search above to add stocks and indices you want to keep an eye on. You can also add them from any stock's page or from the screener.</p>
          </Empty>
        ) : data.loading && !data.data ? (
          <Loading height={120} />
        ) : data.error ? (
          <div style={{ padding: 14 }}>
            <ErrorNote error={data.error} retry={data.reload} />
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {th('symbol', 'Name', false)}
                  {th('price', 'Price')}
                  {th('change', 'Today')}
                  {th('year', '1 year')}
                  <th style={{ minWidth: 150 }}>52-week low → high</th>
                  {th('cap', 'Market value')}
                  {th('pe', 'P/E')}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const x = q[s];
                  return (
                    <tr key={s}>
                      <td>
                        <Link className="strong" to={`/stock/${encodeURIComponent(s)}`}>
                          {shortSymbol(s)}
                        </Link>
                        <span className="sub">{x?.longName ?? x?.shortName ?? 'No quote available'}</span>
                      </td>
                      <td className="r">
                        {num(x?.regularMarketPrice, 2)}
                        <span className="sub">{x?.currency ?? ''}</span>
                      </td>
                      <td className={'r strong ' + tone(x?.regularMarketChangePercent)}>{x?.regularMarketChangePercent != null ? signedPct(x.regularMarketChangePercent / 100, 2) : '—'}</td>
                      <td className={'r ' + tone(x?.fiftyTwoWeekChangePercent)}>{x?.fiftyTwoWeekChangePercent != null ? signedPct(x.fiftyTwoWeekChangePercent / 100, 0) : '—'}</td>
                      <td>{x?.fiftyTwoWeekLow && x.fiftyTwoWeekHigh && x.regularMarketPrice ? <RangeBar low={x.fiftyTwoWeekLow} high={x.fiftyTwoWeekHigh} value={x.regularMarketPrice} /> : null}</td>
                      <td className="r">{x?.marketCap ? compact(x.marketCap, x.currency) : '—'}</td>
                      <td className="r">{x?.trailingPE ? num(x.trailingPE, 1) : '—'}</td>
                      <td className="r">
                        <button className="btn sm ghost" onClick={() => toggleWatch(s)} aria-label={`Remove ${s}`}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="row mt">
        {list.length >= 2 && (
          <Link className="btn sm" to={`/compare?symbols=${list.slice(0, 8).map(encodeURIComponent).join(',')}`}>
            Compare these
          </Link>
        )}
      </div>
      <div className="mt">
        <Source at={data.data?.fetchedAt} />
      </div>
    </Page>
  );
}
