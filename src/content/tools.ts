/** The tool directory: one entry per page. Drives navigation, search, favourites and the home page. */

export type Group = 'Markets' | 'Portfolio' | 'Valuation' | 'Plan' | 'Learn';

export interface Tool {
  id: string;
  title: string;
  path: string;
  group: Group;
  /** one plain sentence: what you can do here */
  blurb: string;
  keywords: string;
}

export const GROUPS: { name: Group; blurb: string }[] = [
  { name: 'Markets', blurb: 'See what is happening and research any company' },
  { name: 'Portfolio', blurb: 'Build, track, test and improve your own portfolio' },
  { name: 'Valuation', blurb: 'Work out what a business is worth' },
  { name: 'Plan', blurb: 'Personal money decisions, with the maths shown' },
  { name: 'Learn', blurb: 'Finance explained from the ground up' },
];

export const TOOLS: Tool[] = [
  { id: 'markets', title: 'Market overview', path: '/markets', group: 'Markets', blurb: 'Indian and global indices, sectors, currencies and commodities at a glance.', keywords: 'nifty sensex index sector heatmap gold usd inr today market' },
  { id: 'stock', title: 'Stock research', path: '/stock', group: 'Markets', blurb: 'Look up any NSE, BSE, US or UK stock: price, valuation, financial statements, returns and risk.', keywords: 'company share price pe ratio roe fundamentals balance sheet income statement dividend analysis nse bse' },
  { id: 'screener', title: 'Stock screener', path: '/screener', group: 'Markets', blurb: 'Filter thousands of stocks by valuation, quality, growth, debt and size.', keywords: 'filter screen find stocks pe roe debt market cap dividend yield growth value quality' },
  { id: 'compare', title: 'Compare stocks', path: '/compare', group: 'Markets', blurb: 'Put stocks and indices side by side: returns, risk, valuation and how they move together.', keywords: 'versus peers comparison correlation relative performance' },
  { id: 'watchlist', title: 'Watchlist', path: '/watchlist', group: 'Markets', blurb: 'Keep an eye on the stocks and indices you care about.', keywords: 'watch list track favourites prices' },
  { id: 'currency', title: 'Currency & global investing', path: '/currency', group: 'Markets', blurb: 'Convert currencies and see how exchange rates change the return on foreign investments.', keywords: 'fx forex usd inr gbp convert exchange rate foreign international us stocks rupee' },

  { id: 'portfolio', title: 'Portfolio studio', path: '/portfolio', group: 'Portfolio', blurb: 'Build your own portfolio: holdings, gains, allocation, targets, rebalancing, risk and tax.', keywords: 'holdings transactions buy sell xirr allocation sector rebalance tracker my stocks import csv gains' },
  { id: 'optimizer', title: 'Portfolio optimiser', path: '/optimizer', group: 'Portfolio', blurb: 'Find the mix of your stocks with the best expected return for the risk, under limits you set.', keywords: 'markowitz efficient frontier sharpe minimum variance weights risk parity mpt modern portfolio theory' },
  { id: 'backtest', title: 'Backtester', path: '/backtest', group: 'Portfolio', blurb: 'See how a portfolio would have performed in the past, with rebalancing, SIPs and costs.', keywords: 'historical performance simulate past strategy rebalancing drawdown cagr' },
  { id: 'risk', title: 'Risk lab', path: '/risk', group: 'Portfolio', blurb: 'Measure how much a portfolio can fall: volatility, value at risk, drawdowns and stress tests.', keywords: 'var cvar volatility beta drawdown stress test crash scenario risk contribution' },
  { id: 'simulate', title: 'Future simulator', path: '/simulate', group: 'Portfolio', blurb: 'Simulate thousands of possible futures for your money and see the odds of reaching a goal.', keywords: 'monte carlo simulation probability goal retirement success projection fan chart' },

  { id: 'dcf', title: 'DCF valuation', path: '/valuation/dcf', group: 'Valuation', blurb: 'Value a company from its future cash flows, with sensitivity tables and scenarios.', keywords: 'discounted cash flow intrinsic value fcff wacc terminal value fair value' },
  { id: 'models', title: 'Valuation toolkit', path: '/valuation/models', group: 'Valuation', blurb: 'Peer multiples, dividend discount models, cost of capital and quick sanity checks.', keywords: 'comps comparable multiples ddm gordon graham number wacc capm cost of equity peg relative valuation' },
  { id: 'corporate', title: 'Business finance', path: '/corporate', group: 'Valuation', blurb: 'Judge projects and businesses: NPV, IRR, payback, break-even, leverage and depreciation.', keywords: 'npv irr mirr payback capital budgeting break even operating leverage depreciation wdv project appraisal' },

  { id: 'invest', title: 'Investment calculators', path: '/calc/invest', group: 'Plan', blurb: 'SIP, lump sum, step-up, goal planning, withdrawals, CAGR and XIRR.', keywords: 'sip calculator lumpsum mutual fund returns cagr xirr goal swp compound interest inflation' },
  { id: 'loan', title: 'Loan & EMI', path: '/calc/loan', group: 'Plan', blurb: 'EMI, full repayment schedule, prepayments, and education loans with a moratorium.', keywords: 'emi home loan car loan education loan amortisation prepayment interest' },
  { id: 'tax', title: 'Income tax (India)', path: '/calc/tax', group: 'Plan', blurb: 'Old versus new regime for your income, slab by slab, plus tax on share-market gains.', keywords: 'income tax india new regime old regime slabs 80c capital gains ltcg stcg rebate' },
  { id: 'retire', title: 'Retirement planner', path: '/calc/retire', group: 'Plan', blurb: 'How much you need to retire, and what to invest each month to get there.', keywords: 'retirement corpus fire pension financial independence withdrawal rate' },
  { id: 'fixed', title: 'Deposits & bonds', path: '/calc/fixed-income', group: 'Plan', blurb: 'FD, RD and PPF maturity values, and bond price, yield and duration.', keywords: 'fixed deposit recurring deposit ppf bond yield ytm duration convexity gsec debt' },
  { id: 'networth', title: 'Net worth & safety net', path: '/networth', group: 'Plan', blurb: 'Add up what you own and owe, check your emergency fund and your asset mix.', keywords: 'net worth assets liabilities emergency fund asset allocation balance sheet personal' },

  { id: 'learn', title: 'Learning centre', path: '/learn', group: 'Learn', blurb: 'Short, structured lessons that take you from the basics to portfolio theory.', keywords: 'lessons course basics beginner tutorial how to invest guide' },
  { id: 'glossary', title: 'Glossary', path: '/glossary', group: 'Learn', blurb: 'Plain-language definitions of the terms used across the site.', keywords: 'definitions terms meaning dictionary jargon' },
];

export const toolById = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id);
