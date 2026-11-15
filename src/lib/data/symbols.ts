/** Reference lists of tickers (Yahoo Finance symbols). All were checked against the live provider. */

export interface Ref {
  symbol: string;
  name: string;
  note?: string;
}

export const INDIA_INDICES: Ref[] = [
  { symbol: '^NSEI', name: 'NIFTY 50', note: '50 largest NSE companies' },
  { symbol: '^BSESN', name: 'BSE Sensex', note: '30 large BSE companies' },
  { symbol: '^NSEBANK', name: 'NIFTY Bank' },
  { symbol: '^NSMIDCP', name: 'NIFTY Next 50' },
  { symbol: 'NIFTY_MIDCAP_100.NS', name: 'NIFTY Midcap 100' },
  { symbol: '^CNXSC', name: 'NIFTY Smallcap 100' },
  { symbol: '^CRSLDX', name: 'NIFTY 500', note: 'Broad market' },
  { symbol: '^INDIAVIX', name: 'India VIX', note: 'Expected volatility' },
];

export const SECTOR_INDICES: Ref[] = [
  { symbol: '^CNXIT', name: 'IT' },
  { symbol: '^NSEBANK', name: 'Banks' },
  { symbol: 'NIFTY_FIN_SERVICE.NS', name: 'Financial services' },
  { symbol: '^CNXAUTO', name: 'Auto' },
  { symbol: '^CNXPHARMA', name: 'Pharma' },
  { symbol: '^CNXFMCG', name: 'FMCG' },
  { symbol: '^CNXMETAL', name: 'Metals' },
  { symbol: '^CNXENERGY', name: 'Energy' },
  { symbol: '^CNXREALTY', name: 'Realty' },
  { symbol: '^CNXINFRA', name: 'Infrastructure' },
  { symbol: '^CNXPSUBANK', name: 'PSU banks' },
  { symbol: '^CNXMEDIA', name: 'Media' },
  { symbol: '^CNXCONSUM', name: 'Consumption' },
  { symbol: '^CNXPSE', name: 'Public sector' },
];

export const GLOBAL_INDICES: Ref[] = [
  { symbol: '^GSPC', name: 'S&P 500', note: 'United States' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', note: 'United States' },
  { symbol: '^DJI', name: 'Dow Jones', note: 'United States' },
  { symbol: '^FTSE', name: 'FTSE 100', note: 'United Kingdom' },
  { symbol: '^GDAXI', name: 'DAX', note: 'Germany' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', note: 'Eurozone' },
  { symbol: '^N225', name: 'Nikkei 225', note: 'Japan' },
  { symbol: '^HSI', name: 'Hang Seng', note: 'Hong Kong' },
  { symbol: '000001.SS', name: 'Shanghai Composite', note: 'China' },
];

export const CURRENCIES: Ref[] = [
  { symbol: 'INR=X', name: 'US dollar', note: 'USD/INR' },
  { symbol: 'EURINR=X', name: 'Euro', note: 'EUR/INR' },
  { symbol: 'GBPINR=X', name: 'British pound', note: 'GBP/INR' },
  { symbol: 'JPYINR=X', name: 'Japanese yen', note: 'JPY/INR' },
  { symbol: 'AEDINR=X', name: 'UAE dirham', note: 'AED/INR' },
  { symbol: 'SGDINR=X', name: 'Singapore dollar', note: 'SGD/INR' },
];

export const COMMODITIES: Ref[] = [
  { symbol: 'GC=F', name: 'Gold', note: 'USD per troy ounce' },
  { symbol: 'SI=F', name: 'Silver', note: 'USD per troy ounce' },
  { symbol: 'BZ=F', name: 'Brent crude', note: 'USD per barrel' },
  { symbol: 'CL=F', name: 'WTI crude', note: 'USD per barrel' },
  { symbol: '^TNX', name: 'US 10-year yield', note: 'percent' },
];

export const BENCHMARKS: Ref[] = [
  { symbol: '^NSEI', name: 'NIFTY 50' },
  { symbol: '^CRSLDX', name: 'NIFTY 500' },
  { symbol: '^BSESN', name: 'BSE Sensex' },
  { symbol: '^NSMIDCP', name: 'NIFTY Next 50' },
  { symbol: 'NIFTY_MIDCAP_100.NS', name: 'NIFTY Midcap 100' },
  { symbol: '^CNXSC', name: 'NIFTY Smallcap 100' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'Nasdaq Composite' },
  { symbol: '^FTSE', name: 'FTSE 100' },
];

/** Widely held stocks offered as one-tap starting points. */
export const POPULAR_INDIA: Ref[] = [
  { symbol: 'RELIANCE.NS', name: 'Reliance' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
  { symbol: 'TCS.NS', name: 'TCS' },
  { symbol: 'INFY.NS', name: 'Infosys' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' },
  { symbol: 'ITC.NS', name: 'ITC' },
  { symbol: 'SBIN.NS', name: 'SBI' },
  { symbol: 'LT.NS', name: 'L&T' },
  { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharma' },
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki' },
  { symbol: 'TITAN.NS', name: 'Titan' },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints' },
  { symbol: 'NIFTYBEES.NS', name: 'Nifty 50 ETF' },
  { symbol: 'GOLDBEES.NS', name: 'Gold ETF' },
];

export const POPULAR_GLOBAL: Ref[] = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'HSBA.L', name: 'HSBC' },
  { symbol: 'AZN.L', name: 'AstraZeneca' },
  { symbol: 'SHEL.L', name: 'Shell' },
];

export type Market = 'IN' | 'UK' | 'US' | 'OTHER';

export function marketOf(symbol: string): Market {
  const s = symbol.toUpperCase();
  if (s.endsWith('.NS') || s.endsWith('.BO') || ['^NSEI', '^BSESN', '^NSEBANK', '^CRSLDX', '^NSMIDCP', '^INDIAVIX'].includes(s) || s.startsWith('^CNX') || s.startsWith('NIFTY')) return 'IN';
  if (s.endsWith('.L') || s === '^FTSE' || s === '^FTMC') return 'UK';
  if (/^[A-Z]{1,5}(-[A-Z])?$/.test(s) || ['^GSPC', '^IXIC', '^DJI', '^RUT'].includes(s)) return 'US';
  return 'OTHER';
}

/** The natural yardstick for a stock, by where it is listed. */
export function defaultBenchmark(symbol: string): string {
  const m = marketOf(symbol);
  return m === 'IN' ? '^NSEI' : m === 'UK' ? '^FTSE' : '^GSPC';
}

export const benchmarkName = (symbol: string): string =>
  [...BENCHMARKS, ...INDIA_INDICES, ...GLOBAL_INDICES, ...SECTOR_INDICES].find((b) => b.symbol === symbol)?.name ?? symbol;

/** Short display form: "RELIANCE.NS" → "RELIANCE". */
export const shortSymbol = (symbol: string): string => symbol.replace(/\.(NS|BO)$/i, '');

/** Yahoo FX ticker giving `to` per 1 `from`: fxSymbol('USD','INR') → 'USDINR=X'. */
export const fxSymbol = (from: string, to: string): string => `${from}${to}=X`;

/** SEBI's categories are rank-based (top 100 = large, 101–250 = mid). These rupee cut-offs approximate them and can be edited in Settings. */
export function capBucket(marketCap: number | null | undefined, currency: string | null | undefined, largeMinCr: number, midMinCr: number): string {
  if (!marketCap || !(marketCap > 0)) return 'Unknown';
  if (currency !== 'INR') return marketCap >= 1e10 ? 'Large cap' : marketCap >= 2e9 ? 'Mid cap' : 'Small cap';
  const cr = marketCap / 1e7;
  return cr >= largeMinCr ? 'Large cap' : cr >= midMinCr ? 'Mid cap' : 'Small cap';
}
