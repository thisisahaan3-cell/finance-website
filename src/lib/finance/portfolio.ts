/**
 * Portfolio accounting: transactions → holdings (FIFO lots), realised and unrealised gains,
 * money-weighted return, value history, time-weighted return, concentration and rebalancing.
 *
 * All money amounts are in the PORTFOLIO currency. A trade in another currency carries an
 * `fx` rate (portfolio currency per 1 unit of the stock's currency) fixed at trade time.
 */
import { xirr, type DatedFlow } from './tvm';
import { isLongTerm, financialYearOf } from './tax';

export type TxnType = 'buy' | 'sell' | 'dividend' | 'split';

export interface Txn {
  id: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  type: TxnType;
  symbol: string;
  /** shares bought or sold; for a split, new shares per old share (5 for a 1:5 split, 2 for a 1:1 bonus) */
  qty: number;
  /** price per share in the stock's own currency (buy / sell) */
  price: number;
  /** brokerage and charges in portfolio currency */
  fees?: number;
  /** portfolio currency per 1 unit of the stock's currency (1 when they match) */
  fx?: number;
  /** total cash received, portfolio currency (dividend) */
  amount?: number;
  note?: string;
}

export interface Lot {
  date: string;
  qty: number;
  /** cost per share in portfolio currency, fees included */
  cost: number;
}

export interface RealisedGain {
  symbol: string;
  buyDate: string;
  sellDate: string;
  qty: number;
  cost: number;
  proceeds: number;
  gain: number;
  longTerm: boolean;
  financialYear: string;
}

export interface Holding {
  symbol: string;
  qty: number;
  lots: Lot[];
  /** cost of the shares still held */
  invested: number;
  avgCost: number;
  realised: number;
  dividends: number;
  firstBuy: string | null;
}

export interface Ledger {
  holdings: Record<string, Holding>;
  realised: RealisedGain[];
  issues: string[];
}

const ORDER: Record<TxnType, number> = { split: 0, buy: 1, dividend: 2, sell: 3 };

export function sortTxns(txns: Txn[]): Txn[] {
  return txns
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : ORDER[a.t.type] - ORDER[b.t.type] || a.i - b.i))
    .map((x) => x.t);
}

/** Replay transactions in date order using first-in-first-out lots (the method Indian tax rules use for demat shares). */
export function buildLedger(txns: Txn[], asOf?: string): Ledger {
  const holdings: Record<string, Holding> = {};
  const realised: RealisedGain[] = [];
  const issues: string[] = [];
  const get = (symbol: string): Holding =>
    (holdings[symbol] ??= { symbol, qty: 0, lots: [], invested: 0, avgCost: 0, realised: 0, dividends: 0, firstBuy: null });

  for (const t of sortTxns(txns)) {
    if (asOf && t.date > asOf) break;
    const h = get(t.symbol);
    const fx = t.fx && t.fx > 0 ? t.fx : 1;
    const fees = Math.max(0, t.fees ?? 0);
    if (t.type === 'buy') {
      if (!(t.qty > 0) || !(t.price >= 0)) {
        issues.push(`${t.symbol} ${t.date}: a buy needs a quantity above zero and a price.`);
        continue;
      }
      h.lots.push({ date: t.date, qty: t.qty, cost: (t.qty * t.price * fx + fees) / t.qty });
      h.firstBuy ??= t.date;
    } else if (t.type === 'sell') {
      if (!(t.qty > 0)) continue;
      const held = h.lots.reduce((s, l) => s + l.qty, 0);
      let toSell = t.qty;
      if (toSell > held + 1e-9) {
        issues.push(`${t.symbol} ${t.date}: sold ${t.qty} but only ${+held.toFixed(4)} were held. The extra is ignored.`);
        toSell = held;
      }
      const netPerShare = toSell > 0 ? (t.qty * t.price * fx - fees) / t.qty : 0;
      while (toSell > 1e-9 && h.lots.length) {
        const lot = h.lots[0];
        const q = Math.min(lot.qty, toSell);
        const cost = q * lot.cost;
        const proceeds = q * netPerShare;
        realised.push({
          symbol: t.symbol,
          buyDate: lot.date,
          sellDate: t.date,
          qty: q,
          cost,
          proceeds,
          gain: proceeds - cost,
          longTerm: isLongTerm(lot.date, t.date),
          financialYear: financialYearOf(t.date),
        });
        h.realised += proceeds - cost;
        lot.qty -= q;
        toSell -= q;
        if (lot.qty <= 1e-9) h.lots.shift();
      }
    } else if (t.type === 'dividend') {
      h.dividends += Math.max(0, t.amount ?? 0);
    } else if (t.type === 'split') {
      if (!(t.qty > 0)) {
        issues.push(`${t.symbol} ${t.date}: a split needs a ratio above zero.`);
        continue;
      }
      for (const lot of h.lots) {
        lot.qty *= t.qty;
        lot.cost /= t.qty;
      }
    }
  }
  for (const h of Object.values(holdings)) {
    h.qty = h.lots.reduce((s, l) => s + l.qty, 0);
    h.invested = h.lots.reduce((s, l) => s + l.qty * l.cost, 0);
    h.avgCost = h.qty > 0 ? h.invested / h.qty : 0;
  }
  return { holdings, realised, issues };
}

export interface PriceInfo {
  /** latest price in the stock's own currency */
  price: number;
  /** previous close, for the day change */
  prevClose?: number | null;
  /** portfolio currency per 1 unit of the stock's currency today */
  fx?: number;
}

export interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  invested: number;
  price: number | null;
  value: number | null;
  weight: number | null;
  unrealised: number | null;
  unrealisedPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  realised: number;
  dividends: number;
  /** unrealised gain on lots held over 12 months / 12 months or less (for an if-sold-today tax view) */
  longTermGain: number | null;
  shortTermGain: number | null;
  firstBuy: string | null;
}

export interface Valuation {
  positions: Position[];
  invested: number;
  /** market value of priced holdings */
  holdingsValue: number;
  cash: number;
  total: number;
  unrealised: number;
  unrealisedPct: number | null;
  realised: number;
  dividends: number;
  dayChange: number;
  dayChangePct: number | null;
  /** symbols held but without a price */
  unpriced: string[];
}

export function valuePortfolio(ledger: Ledger, prices: Record<string, PriceInfo | undefined>, cash: number, today: string): Valuation {
  const open = Object.values(ledger.holdings).filter((h) => h.qty > 1e-9);
  const positions: Position[] = [];
  let holdingsValue = 0;
  let invested = 0;
  let pricedCost = 0;
  let dayChange = 0;
  let prevValue = 0;
  const unpriced: string[] = [];
  for (const h of open) {
    const p = prices[h.symbol];
    const fx = p?.fx && p.fx > 0 ? p.fx : 1;
    const hasPrice = !!p && Number.isFinite(p.price) && p.price > 0;
    const value = hasPrice ? h.qty * p!.price * fx : null;
    let lt: number | null = null;
    let st: number | null = null;
    if (hasPrice) {
      lt = 0;
      st = 0;
      for (const lot of h.lots) {
        const g = lot.qty * (p!.price * fx - lot.cost);
        if (isLongTerm(lot.date, today)) lt += g;
        else st += g;
      }
    }
    const dc = hasPrice && p!.prevClose && p!.prevClose > 0 ? h.qty * (p!.price - p!.prevClose) * fx : null;
    positions.push({
      symbol: h.symbol,
      qty: h.qty,
      avgCost: h.avgCost,
      invested: h.invested,
      price: hasPrice ? p!.price : null,
      value,
      weight: null,
      unrealised: value === null ? null : value - h.invested,
      unrealisedPct: value === null || h.invested <= 0 ? null : value / h.invested - 1,
      dayChange: dc,
      dayChangePct: dc === null ? null : p!.price / p!.prevClose! - 1,
      realised: h.realised,
      dividends: h.dividends,
      longTermGain: lt,
      shortTermGain: st,
      firstBuy: h.firstBuy,
    });
    invested += h.invested;
    if (value !== null) {
      holdingsValue += value;
      pricedCost += h.invested;
      if (dc !== null) {
        dayChange += dc;
        prevValue += value - dc;
      }
    } else unpriced.push(h.symbol);
  }
  const total = holdingsValue + Math.max(0, cash);
  for (const p of positions) p.weight = p.value !== null && total > 0 ? p.value / total : null;
  positions.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const all = Object.values(ledger.holdings);
  return {
    positions,
    invested,
    holdingsValue,
    cash: Math.max(0, cash),
    total,
    unrealised: holdingsValue - pricedCost,
    unrealisedPct: pricedCost > 0 ? holdingsValue / pricedCost - 1 : null,
    realised: all.reduce((s, h) => s + h.realised, 0),
    dividends: all.reduce((s, h) => s + h.dividends, 0),
    dayChange,
    dayChangePct: prevValue > 0 ? dayChange / prevValue : null,
    unpriced,
  };
}

/** Cash flows of the equity portfolio: buys are money in (negative), sells and dividends money out (positive). */
export function cashFlows(txns: Txn[]): DatedFlow[] {
  const flows: DatedFlow[] = [];
  for (const t of sortTxns(txns)) {
    const fx = t.fx && t.fx > 0 ? t.fx : 1;
    const fees = Math.max(0, t.fees ?? 0);
    if (t.type === 'buy' && t.qty > 0) flows.push({ date: t.date, amount: -(t.qty * t.price * fx + fees) });
    else if (t.type === 'sell' && t.qty > 0) flows.push({ date: t.date, amount: t.qty * t.price * fx - fees });
    else if (t.type === 'dividend' && (t.amount ?? 0) > 0) flows.push({ date: t.date, amount: t.amount! });
  }
  return flows;
}

/** Money-weighted annual return (XIRR) of everything invested, given what the holdings are worth today. */
export function portfolioXirr(txns: Txn[], holdingsValue: number, today: string) {
  const flows = cashFlows(txns);
  if (holdingsValue > 0) flows.push({ date: today, amount: holdingsValue });
  return xirr(flows);
}

/* ---------- concentration ---------- */

export interface Concentration {
  /** Herfindahl–Hirschman index: sum of squared weights (1 = one stock) */
  hhi: number;
  /** 1 ÷ HHI: the number of equal-sized holdings with the same concentration */
  effectiveHoldings: number;
  top1: number;
  top3: number;
  top5: number;
}

export function concentration(weights: number[]): Concentration {
  const w = weights.filter((x) => x > 0).sort((a, b) => b - a);
  const total = w.reduce((s, v) => s + v, 0);
  const n = total > 0 ? w.map((v) => v / total) : [];
  const hhi = n.reduce((s, v) => s + v * v, 0);
  const top = (k: number) => n.slice(0, k).reduce((s, v) => s + v, 0);
  return { hhi, effectiveHoldings: hhi > 0 ? 1 / hhi : 0, top1: top(1), top3: top(3), top5: top(5) };
}

/** Sum weights by a label (sector, industry, market-cap bucket…). */
export function groupWeights<T extends { value: number | null }>(items: T[], keyOf: (item: T) => string, total: number): { key: string; value: number; weight: number }[] {
  const map = new Map<string, number>();
  for (const it of items) if (it.value && it.value > 0) map.set(keyOf(it), (map.get(keyOf(it)) ?? 0) + it.value);
  return [...map.entries()].map(([key, value]) => ({ key, value, weight: total > 0 ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

/* ---------- rebalancing ---------- */

export interface RebalanceAsset {
  symbol: string;
  /** current market value, portfolio currency */
  value: number;
  /** price per share in portfolio currency */
  price: number;
  /** target weight of the whole portfolio (0–1) */
  target: number;
}

export interface RebalanceInput {
  assets: RebalanceAsset[];
  cash: number;
  /** target cash weight (0–1); stock targets + cash target must total 1 */
  cashTarget: number;
  /** fresh money to add */
  newMoney: number;
  /** 'full' sells overweights and buys underweights; 'buy-only' never sells */
  mode: 'full' | 'buy-only';
  wholeShares: boolean;
}

export interface Trade {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  shares: number;
  amount: number;
  currentWeight: number;
  targetWeight: number;
  afterWeight: number;
}

export interface RebalanceResult {
  trades: Trade[];
  total: number;
  cashBefore: number;
  cashAfter: number;
  cashWeightAfter: number;
  /** total value bought + sold, as a share of the portfolio */
  turnover: number;
  /** largest gap between target and actual weight after the trades */
  maxDrift: number;
}

export function rebalance(input: RebalanceInput): RebalanceResult {
  const assets = input.assets;
  const targetSum = assets.reduce((s, a) => s + a.target, 0) + input.cashTarget;
  if (Math.abs(targetSum - 1) > 1e-4) throw new Error(`Targets add up to ${(targetSum * 100).toFixed(1)}%. They must total 100% (including the cash target).`);
  if (assets.some((a) => !(a.price > 0))) throw new Error('Every holding needs a price before trades can be worked out.');
  const cashBefore = Math.max(0, input.cash) + Math.max(0, input.newMoney);
  const total = assets.reduce((s, a) => s + a.value, 0) + cashBefore;
  if (!(total > 0)) throw new Error('The portfolio has no value to rebalance.');
  const currentTotal = total - Math.max(0, input.newMoney);

  const deltas = assets.map((a) => total * a.target - a.value);
  if (input.mode === 'buy-only') {
    const spendable = Math.max(0, cashBefore - total * input.cashTarget);
    const shortfall = deltas.reduce((s, d) => s + Math.max(0, d), 0);
    const k = shortfall > 0 ? Math.min(1, spendable / shortfall) : 0;
    for (let i = 0; i < deltas.length; i++) deltas[i] = Math.max(0, deltas[i]) * k;
  }
  let cash = cashBefore;
  let traded = 0;
  const trades: Trade[] = assets.map((a, i) => {
    let shares = deltas[i] / a.price;
    if (input.wholeShares) shares = shares >= 0 ? Math.floor(shares + 1e-9) : -Math.floor(-shares + 1e-9);
    // never sell more than is held
    if (shares < 0 && -shares * a.price > a.value) shares = -a.value / a.price;
    const amount = shares * a.price;
    cash -= amount;
    traded += Math.abs(amount);
    return {
      symbol: a.symbol,
      action: shares > 1e-9 ? 'BUY' : shares < -1e-9 ? 'SELL' : 'HOLD',
      shares: Math.abs(shares),
      amount: Math.abs(amount),
      currentWeight: currentTotal > 0 ? a.value / currentTotal : 0,
      targetWeight: a.target,
      afterWeight: (a.value + amount) / total,
    };
  });
  return {
    trades,
    total,
    cashBefore,
    cashAfter: cash,
    cashWeightAfter: cash / total,
    turnover: traded / total,
    maxDrift: trades.reduce((m, t) => Math.max(m, Math.abs(t.afterWeight - t.targetWeight)), 0),
  };
}

/* ---------- history ---------- */

export interface HistoryInput {
  txns: Txn[];
  /** trading calendar, ISO dates ascending */
  dates: string[];
  /** prices[symbol][t]: split-adjusted close in PORTFOLIO currency on dates[t]; NaN where unknown */
  prices: Record<string, number[]>;
}

export interface History {
  dates: string[];
  value: number[];
  /** net money put in up to each date (buys − sells), i.e. capital at work */
  netInvested: number[];
  /** time-weighted growth of 1 from the first holding date */
  twr: number[];
  /** index into `dates` where the portfolio first holds something */
  startIndex: number;
}

/**
 * Daily market value and time-weighted return of the equity holdings.
 * Quantities are restated in today's share units (later splits applied), which matches
 * split-adjusted price history. Trades on non-trading days settle on the next trading day.
 */
export function buildHistory(input: HistoryInput): History | null {
  const { dates } = input;
  const txns = sortTxns(input.txns).filter((t) => t.type !== 'split' || t.qty > 0);
  if (!dates.length || !txns.length) return null;

  // Restate each trade's quantity in current share units.
  const laterSplit = (symbol: string, date: string) =>
    txns.filter((s) => s.type === 'split' && s.symbol === symbol && s.date > date).reduce((k, s) => k * s.qty, 1);

  const qty: Record<string, number> = {};
  const value: number[] = [];
  const netInvested: number[] = [];
  const twr: number[] = [];
  let k = 0;
  let invested = 0;
  let level = 1;
  let prevValue = 0;
  let startIndex = -1;

  for (let t = 0; t < dates.length; t++) {
    let flow = 0;
    let income = 0;
    while (k < txns.length && txns[k].date <= dates[t]) {
      const x = txns[k++];
      const fx = x.fx && x.fx > 0 ? x.fx : 1;
      const fees = Math.max(0, x.fees ?? 0);
      if (x.type === 'buy' && x.qty > 0) {
        qty[x.symbol] = (qty[x.symbol] ?? 0) + x.qty * laterSplit(x.symbol, x.date);
        flow += x.qty * x.price * fx + fees;
      } else if (x.type === 'sell' && x.qty > 0) {
        const adj = Math.min(qty[x.symbol] ?? 0, x.qty * laterSplit(x.symbol, x.date));
        qty[x.symbol] = (qty[x.symbol] ?? 0) - adj;
        flow -= x.qty * x.price * fx - fees;
      } else if (x.type === 'dividend') income += Math.max(0, x.amount ?? 0);
    }
    let v = 0;
    for (const [symbol, q] of Object.entries(qty)) {
      if (q <= 1e-9) continue;
      const p = input.prices[symbol]?.[t];
      if (Number.isFinite(p) && p! > 0) v += q * p!;
    }
    invested += flow;
    if (startIndex < 0 && v > 0) startIndex = t;
    if (startIndex >= 0) {
      if (prevValue > 0) level *= (v + income - flow) / prevValue;
      else if (flow > 0) level *= (v + income) / flow;
      if (!Number.isFinite(level) || level < 0) level = 0;
    }
    value.push(v);
    netInvested.push(invested);
    twr.push(level);
    prevValue = v;
  }
  if (startIndex < 0) return null;
  return { dates, value, netInvested, twr, startIndex };
}

/** Estimated dividends from ex-dividend history: per-share amount × shares held just before the ex-date. */
export function estimateDividends(
  txns: Txn[],
  events: Record<string, { date: string; perShare: number }[]>,
): { symbol: string; date: string; amount: number }[] {
  const sorted = sortTxns(txns);
  const out: { symbol: string; date: string; amount: number }[] = [];
  for (const [symbol, list] of Object.entries(events)) {
    const mine = sorted.filter((t) => t.symbol === symbol);
    const laterSplit = (date: string) => mine.filter((s) => s.type === 'split' && s.date > date && s.qty > 0).reduce((k, s) => k * s.qty, 1);
    for (const ev of list) {
      let q = 0;
      for (const t of mine) {
        if (t.date >= ev.date) break;
        if (t.type === 'buy') q += t.qty * laterSplit(t.date);
        else if (t.type === 'sell') q = Math.max(0, q - t.qty * laterSplit(t.date));
      }
      if (q > 1e-9 && ev.perShare > 0) out.push({ symbol, date: ev.date, amount: q * ev.perShare });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
