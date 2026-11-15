# Artha

A finance workbench for learning, researching stocks and building portfolios. India first, global markets second.

Artha (अर्थ) means wealth and purpose in Sanskrit. Every tool shows its working and explains itself in plain words, so the site teaches while it calculates. It is a static site with one small serverless function, and it runs entirely on Netlify's free plan with no accounts, databases or API keys.

## What is in it

| Area | Tools |
|---|---|
| **Markets** | Market overview (Indian and world indices, sectors, movers, currencies, commodities) · Stock research (price, valuation, statements, ratios, returns, dividends, peers) · Screener (27 combinable filters over NSE, BSE, US and UK) · Compare · Watchlist · Currency and global investing |
| **Portfolio** | Portfolio studio (transactions, holdings, XIRR, allocation, targets, rebalancing, performance against a benchmark, risk, tax) · Optimiser (efficient frontier, constraints, robustness check) · Backtester · Risk lab (VaR, drawdowns, crash replay) · Future simulator (Monte Carlo) |
| **Valuation** | DCF with sensitivity, scenarios and reverse DCF · Peer multiples, dividend discount models, WACC and CAPM, quick checks · NPV, IRR, break-even, leverage, depreciation |
| **Plan** | SIP, lump sum, goal, SWP, CAGR, XIRR · Loans and EMI · Indian income tax (old against new regime) and equity capital gains · Retirement · FD, RD, PPF and bonds · Net worth and emergency fund |
| **Learn** | A 23-lesson course in seven parts · A glossary of about 150 terms · A learning panel under every tool |

## Run it locally

Requires Node.js 20 or newer (22 recommended).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The dev server also serves the market-data API (`/api/*`), so everything works exactly as in production.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks and builds the production site into `dist/` |
| `npm run preview` | Serves the production build on http://localhost:4173, API included |
| `npm test` | Runs the unit tests for the calculation engines (79 tests) |
| `npm run e2e` | Runs the browser integration tests against a running preview server (needs `playwright`) |
| `npm run check` | Type-check plus unit tests |

## Deploying to Netlify

The repository is ready for Netlify as it is:

1. In Netlify choose **Add new project → Import an existing project**, pick this GitHub repository and the `main` branch.
2. Leave the build settings alone: `netlify.toml` already sets the build command (`npm run build`), the publish directory (`dist`), the functions directory and Node 22.
3. Deploy. Every push to `main` then redeploys automatically.

There are **no environment variables to set** and no secrets anywhere in the project.

## How it is built

```
server/yahoo.ts            Market-data gateway (shared by the Netlify Function and the dev server)
netlify/functions/api.mts  The Netlify Function: serves /api/:op
src/lib/finance/           Calculation engines: pure, typed, unit-tested, no UI code
src/lib/data/              Browser data client with caching, ticker lists, series alignment
src/lib/store.ts           Saved data (localStorage): portfolios, watchlist, settings, tool inputs
src/components/            Design system: inputs, cards, charts (hand-built SVG), layout, search
src/pages/                 One file per tool
src/content/               Tool directory, per-tool explanations, lessons, glossary
tests/                     Unit tests (Vitest) and browser integration tests (Playwright)
docs/                      Formulas, data sources and design notes
```

- **React 18 + TypeScript + Vite.** Client-side routing; each page is its own lazily loaded chunk.
- **No chart or UI library.** Charts are small SVG components, so the look is consistent and the bundle stays light.
- **`quadprog`** (a port of the Goldfarb–Idnani solver) is the only numerical dependency, used by the optimiser.
- **Self-hosted fonts** (IBM Plex Sans, Source Serif 4, IBM Plex Mono) via Fontsource: no requests to font CDNs.

More detail:

- [`docs/FORMULAS.md`](docs/FORMULAS.md): every formula, its conventions and the reference values it is tested against.
- [`docs/DATA.md`](docs/DATA.md): where data comes from, how it is cached, and its limits.
- [`docs/DESIGN.md`](docs/DESIGN.md): the design system and chart rules.

## Your data

Portfolios, watchlists, settings and saved inputs are stored in your browser's local storage on your device. Nothing is uploaded. Use **Data & settings → Export backup** to save a copy or move to another device.

## Limits worth knowing

- Market data comes from Yahoo Finance's unofficial endpoints. It is free, delayed about 15 minutes for India, occasionally wrong or incomplete, and could change without notice. When data is unavailable the affected page says so; calculators that need no data keep working.
- Indian indices from this source are price indices (dividends excluded).
- Tax calculations are estimates for resident individuals and are not tax advice. Rules are kept as data in `src/lib/finance/tax.ts` so they can be updated after each Budget.
- This is a learning and research tool. It is not investment advice and never places trades.

Made by Ahaan Gupta.
