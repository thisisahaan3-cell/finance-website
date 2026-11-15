# Data sources

## Provider

All market data comes from **Yahoo Finance** through its public web endpoints. No API key is needed. These endpoints are unofficial and undocumented: they are free and widely used, but they carry no guarantee, can be rate-limited, and may change.

Because browsers cannot call Yahoo directly (it sends no CORS headers), the site calls its own gateway at `/api/<operation>`, a single Netlify Function (`netlify/functions/api.mts`, logic in `server/yahoo.ts`).

| Operation | Yahoo endpoint | Used for | Cached at the CDN |
|---|---|---|---|
| `/api/chart` | `v8/finance/chart` | Price history, dividends, splits, latest price | 5 min (1 min intraday) |
| `/api/quote` | `v7/finance/quote` | Batches of live quotes | 1 min |
| `/api/search` | `v1/finance/search` | Ticker search | 1 hour |
| `/api/summary` | `v10/finance/quoteSummary` | Company profile, valuation and profitability figures | 30 min |
| `/api/fundamentals` | `v10/finance/quoteSummary` (batched) | Screener and peer-table columns | 1 hour |
| `/api/financials` | `fundamentals-timeseries` | Annual and quarterly statements | 6 hours |
| `/api/screen` | `v1/finance/screener` | Stock screener | 10 min |

`quote`, `summary`, `fundamentals` and `screen` need a session cookie and "crumb", which the function obtains from Yahoo and keeps while it stays warm.

## What kind of data each page shows

| Kind | Where | Notes |
|---|---|---|
| Delayed quotes | Markets, watchlist, stock header, portfolio values | About 15 minutes behind for NSE and BSE |
| Historical prices | Charts, backtests, risk, optimiser | Daily closes adjusted for splits; "adjusted close" also includes dividends (total return) |
| Company fundamentals | Stock research, screener, peers, DCF prefill | Trailing twelve months and up to five years of annual statements, as standardised by the provider |
| User-entered | Portfolio transactions, calculator inputs, net worth | Stored only in the browser |
| Test fixtures | `tests/e2e/run.cjs` only | Synthetic tickers used by automated tests; never shown on the site |

There is **no bundled or sample market data** in the site. If the provider cannot supply a figure, the page shows a dash or an explicit message rather than an estimate. Two derived figures are labelled as such in the code: market value is computed as shares × price when the provider omits it, and dividends in the portfolio can be estimated from ex-dividend history.

## Conventions

- **Currencies.** London prices quoted in pence are converted to pounds. Foreign holdings in a portfolio, and baskets in the optimiser, backtester, risk lab and Compare, are converted to the base currency using daily exchange-rate history.
- **Calendars.** Series from different markets are put on one calendar starting when the newest series starts; on a market holiday the previous close is carried forward.
- **Returns.** Simple (not log) returns. Annualised with 252 trading days, 52 weeks or 12 months.
- **Indices.** NIFTY and Sensex series from this provider are price indices.

## Caching

Three layers keep the site fast and the provider lightly used:

1. Netlify's CDN caches each API response for the time in the table above.
2. The browser keeps responses in memory for the session.
3. The browser keeps them in IndexedDB between sessions (2 minutes for quotes, up to 24 hours for statements). **Data & settings → Clear cached market data** empties it.

If the network fails, the last saved copy is shown instead of nothing.

## Protecting the gateway

The function accepts only GET requests, validates every parameter against a strict pattern or whitelist, exposes only the seven operations above, and refuses requests that a browser marks as coming from another website. It needs no secrets and stores nothing.

## If Yahoo stops working

Every calculator, the DCF, the tax, loan and planning tools, the lessons and the glossary need no market data and keep working. Portfolios keep their transactions and cost figures; values that need a live price show as unavailable. To switch provider, reimplement the operations in `server/yahoo.ts`: the rest of the site depends only on the JSON shapes defined in `src/lib/data/api.ts`.
