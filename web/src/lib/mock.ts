/**
 * Instruments and symbol catalog for Indian Stock Market (NSE / BSE).
 * Genuine real-time market data streaming from backend.
 */

export const STOCKS = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd', exchange: 'NSE', sector: 'Energy & Retail' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', exchange: 'NSE', sector: 'Banking' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', exchange: 'NSE', sector: 'IT Services' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd', exchange: 'NSE', sector: 'Banking' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd', exchange: 'NSE', sector: 'Automobile' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE', sector: 'Public Banking' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd', exchange: 'NSE', sector: 'Telecom' },
  { symbol: 'ITC.NS', name: 'ITC Ltd', exchange: 'NSE', sector: 'FMCG' },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', exchange: 'NSE', sector: 'Banking' },
  { symbol: '^NSEI', name: 'NIFTY 50 Index', exchange: 'NSE', sector: 'Benchmark Index' },
];

export const WATCHLIST_DEFAULT = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'TATAMOTORS.NS', 'SBIN.NS'];

export const QUOTES: Record<string, any> = {};
export const HOLDINGS: any[] = [];
export const ORDERS: any[] = [];
export const AI_SIGNAL: Record<string, any> = {};
export const SCANNER_RESULTS: any[] = [];
export const ACCURACY_LOG: any[] = [];

export function generateCandles(_basePrice: number, _count = 60) {
  return [];
}

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtChange(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const val = Number(n);
  const sign = val >= 0 ? '+' : '';
  return `${sign}${fmt(val)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const val = Number(n);
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}
