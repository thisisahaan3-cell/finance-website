/** Number, money and date formatting. India-first: rupees group as lakh and crore. */

const SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', GBP: '£', EUR: '€', JPY: '¥', CNY: 'CN¥', HKD: 'HK$', SGD: 'S$', AED: 'AED ', AUD: 'A$', CAD: 'C$', CHF: 'CHF ',
};

export const DASH = '—';
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const currencySymbol = (ccy?: string | null): string => (ccy ? SYMBOL[ccy] ?? ccy + ' ' : '');

const localeOf = (ccy?: string | null) => (ccy === 'INR' || !ccy ? 'en-IN' : 'en-US');

/** Plain number with fixed decimals and locale grouping. */
export function num(v: number | null | undefined, decimals = 2, ccy?: string | null): string {
  if (!ok(v)) return DASH;
  return v.toLocaleString(localeOf(ccy), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Money in full: ₹12,34,567.00 */
export function money(v: number | null | undefined, ccy: string | null = 'INR', decimals?: number): string {
  if (!ok(v)) return DASH;
  const d = decimals ?? (Math.abs(v) >= 1000 ? 0 : 2);
  const s = Math.abs(v).toLocaleString(localeOf(ccy), { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 ? '−' : '') + currencySymbol(ccy) + s;
}

/** Compact money: ₹1.25 Cr, ₹4.5 L, $3.2B */
export function compact(v: number | null | undefined, ccy: string | null = 'INR', digits = 2): string {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const sym = currencySymbol(ccy);
  const f = (x: number) => x.toLocaleString(localeOf(ccy), { maximumFractionDigits: x >= 100 ? Math.min(digits, 1) : digits });
  if (ccy === 'INR' || !ccy) {
    if (a >= 1e12) return `${sign}${sym}${f(a / 1e12)} L Cr`;
    if (a >= 1e7) return `${sign}${sym}${f(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}${sym}${f(a / 1e5)} L`;
    return `${sign}${sym}${a.toLocaleString('en-IN', { maximumFractionDigits: a >= 1000 ? 0 : 2 })}`;
  }
  if (a >= 1e12) return `${sign}${sym}${f(a / 1e12)}T`;
  if (a >= 1e9) return `${sign}${sym}${f(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}${sym}${f(a / 1e6)}M`;
  if (a >= 1e4) return `${sign}${sym}${f(a / 1e3)}K`;
  return `${sign}${sym}${a.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : 2 })}`;
}

/** Compact plain number for axes: 1.2K, 3.4M (or L / Cr for rupees). */
export function compactNum(v: number, ccy?: string | null): string {
  return compact(v, ccy ?? 'INR', 1).replace(currencySymbol(ccy ?? 'INR'), '');
}

/** Decimal → percentage text: 0.1234 → "12.3%" */
export function pct(v: number | null | undefined, decimals = 1): string {
  if (!ok(v)) return DASH;
  return (v * 100).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−') + '%';
}

/** Signed percentage: "+12.3%" / "−4.0%" */
export function signedPct(v: number | null | undefined, decimals = 1): string {
  if (!ok(v)) return DASH;
  return (v > 0 ? '+' : '') + pct(v, decimals);
}

export function signedMoney(v: number | null | undefined, ccy: string | null = 'INR', decimals?: number): string {
  if (!ok(v)) return DASH;
  return (v > 0 ? '+' : '') + money(v, ccy, decimals);
}

/** Multiple: 1.25× */
export function times(v: number | null | undefined, decimals = 2): string {
  if (!ok(v)) return DASH;
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '×';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date → "14 Nov 2026" */
export function date(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return DASH;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** ISO date → "Nov 2026" */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Epoch milliseconds → "14 Nov 2026, 3:30 pm" in the viewer's time zone. */
export function dateTime(ms: number | null | undefined): string {
  if (!ok(ms)) return DASH;
  const d = new Date(ms);
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Years (fractional) → "6 years 2 months" */
export function duration(years: number | null | undefined): string {
  if (!ok(years)) return DASH;
  const months = Math.round(years * 12);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Parse user-typed numbers: "12,50,000", "1.5", "₹ 2 000". Returns NaN when not a number. */
export function parseNum(text: string): number {
  const cleaned = text.replace(/[,\s₹$£€%]/g, '').replace('−', '-');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return Number(cleaned);
}

/** CSS class for gains and losses. */
export const tone = (v: number | null | undefined): string => (!ok(v) || v === 0 ? '' : v > 0 ? 'pos' : 'neg');
