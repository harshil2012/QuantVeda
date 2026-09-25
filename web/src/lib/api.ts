/**
 * QuantVeda backend API client (same-origin; backend serves this bundle).
 * JWT stored under legacy keys so old + new UI interoperate.
 */
export const TOKEN_KEY = 'quantveda_auth_token';
export const USER_KEY = 'quantveda_user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('quantveda_token');
  } catch {
    return null;
  }
}

export function setSession(token: string, user: unknown) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('quantveda_token', token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('quantveda_token');
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((opts.headers as Record<string, string>) || {}) };
  const token = getToken();
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent('qv:unauthorized'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { detail?: string }).detail || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

const get = <T,>(path: string) => req<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T,>(path: string) => req<T>(path, { method: 'DELETE' });

// ---------- Auth ----------
export const api = {
  register: (payload: { name?: string; email: string; phone?: string; password: string }) =>
    post<{ status: string; message?: string; token?: string; access_token?: string; user: AuthUser; is_new_user?: boolean }>('/api/auth/register', payload),
  login: (identifier: string, password: string) =>
    post<{ status: string; message?: string; token?: string; access_token?: string; user: AuthUser; is_new_user?: boolean }>('/api/auth/login', { identifier, password }),
  sendOtp: (identifier: string, channel: 'email' | 'phone') =>
    post<{ status: string; message: string; identifier: string; channel: string; delivery_note?: string }>('/api/auth/send-otp', { identifier, channel }),
  verifyOtp: (identifier: string, otp: string) =>
    post<{ status: string; token?: string; access_token?: string; user: AuthUser; is_new_user?: boolean }>('/api/auth/verify-otp', { identifier, otp }),
  firebaseLogin: (id_token: string) =>
    post<{ status: string; token?: string; access_token?: string; user: AuthUser; is_new_user?: boolean }>('/api/auth/firebase-login', { id_token }),
  me: () => get<{ status: string; user: AuthUser; wallet?: { cash_balance: number; starting_balance: number } }>('/api/auth/me'),
  logout: () => post('/api/auth/logout'),
  firebaseConfig: () => get<{ status: string; is_configured: boolean; config: Record<string, string> }>('/api/auth/firebase-config'),

  // ---------- Market ----------
  search: (q: string) =>
    get<{ status: string; data: SearchHit[]; results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  quote: (symbol: string) => get<{ status: string; data: QuoteData }>(`/api/quote/${encodeURIComponent(symbol)}`),
  quotes: (symbols: string[]) =>
    get<{ status: string; data: QuoteData[] }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  candles: (symbol: string, interval = '1d', range = '6mo') =>
    get<{ status: string; data: CandlesData }>(`/api/candles/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`),
  maxCandles: (symbol: string) => get<{ status: string; data: CandlesData }>(`/api/candles/${encodeURIComponent(symbol)}/max`),
  aiSentiment: (symbol: string) => post<{ status: string; data: unknown }>('/api/ai/sentiment', { symbol }),
  analyze: (symbol: string) => get<{ status: string; data: AnalyzeData }>(`/api/analyze/${encodeURIComponent(symbol)}`),
  jevPrediction: (symbol: string) => get<{ status: string; data: JevPredictionData }>(`/api/ai/jev-prediction/${encodeURIComponent(symbol)}`),

  // ---------- Watchlists ----------
  watchlists: () => get<{ status: string; data: Watchlist[] }>('/api/watchlists'),
  createWatchlist: (name: string, source = 'manual') => post('/api/watchlists', { name, source }),
  deleteWatchlist: (id: number) => del(`/api/watchlists/${id}`),
  addWatchlistItem: (id: number, symbol: string, name = '', exchange = 'NSE') =>
    post(`/api/watchlists/${id}/items`, { symbol, name, exchange }),
  removeWatchlistItem: (wlId: number, itemId: number) => del(`/api/watchlists/${wlId}/items/${itemId}`),
  watchlistQuotes: (id: number) => get<{ status: string; data: { quotes: WatchQuote[] } }>(`/api/watchlists/${id}/quotes`),

  // ---------- Wishlist ----------
  wishlist: () => get<{ status: string; data: WishlistItem[] }>('/api/wishlist'),
  addWishlist: (symbol: string, target_price: number, name = '', note = '') =>
    post('/api/wishlist', { symbol, target_price, name, note }),
  removeWishlist: (id: number) => del(`/api/wishlist/${id}`),

  // ---------- Trading ----------
  wallet: () => get<{ status: string; data: Wallet }>('/api/wallet'),
  topup: (amount: number) => post<{ status: string; data: Wallet }>('/api/wallet/topup', { amount }),
  resetWallet: () => post<{ status: string; message: string }>('/api/wallet/reset'),
  placeOrder: (o: {
    symbol: string;
    side: string;
    order_type: string;
    qty: number;
    limit_price?: number;
    stop_loss_price?: number;
    target_price?: number;
    instrument_type?: string;
    strike_price?: number;
    expiry_date?: string;
  }) => post('/api/orders', o),
  orders: () => get<{ status: string; data: OrderRow[] }>('/api/orders'),
  cancelOrder: (id: number) => del(`/api/orders/${id}`),
  holdings: () => get<{ status: string; data: HoldingRow[] }>('/api/holdings'),
  portfolio: () => get<{ status: string; data: Portfolio }>('/api/portfolio'),
  setHoldingProtection: (holding_id: number, stop_loss_price?: number, target_price?: number) =>
    post('/api/holdings/set-protection', { holding_id, stop_loss_price, target_price }),
  optionChain: (symbol: string, expiry?: string) =>
    get<{ status: string; data: OptionChainData }>(`/api/options/chain/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`),
  optionQuote: (symbol: string, strike: number, type: 'CE' | 'PE', expiry?: string) =>
    get<{ status: string; data: OptionQuoteData }>(`/api/options/quote?symbol=${encodeURIComponent(symbol)}&strike=${strike}&type=${type}${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ''}`),

  // ---------- Scanner ----------
  scannerUniverses: () => get<{ status: string; data: { universes: string[]; presets: unknown[] } }>('/api/scanner/universes'),
  runScanner: (universe: string, rules: ScannerRule[], custom_symbols: string[] = []) =>
    post<{ status: string; data: { scanned_count: number; matched_count: number; hits: ScannerHit[] } }>('/api/scanner/run', { universe, rules, custom_symbols }),
  scannerConfigs: () => get('/api/scanner/configs'),
  saveScannerConfig: (name: string, universe: string, rules: ScannerRule[], custom_symbols: string[] = []) =>
    post('/api/scanner/configs', { name, universe, rules, custom_symbols }),
  deleteScannerConfig: (id: number) => del(`/api/scanner/configs/${id}`),

  // ---------- Predictions ----------
  scorecard: () => get<{ status: string; data: Scorecard }>('/api/predictions/scorecard'),
  resolvePredictions: () => post<{ status: string; message: string }>('/api/predictions/resolve'),
};

export interface AuthUser {
  id: number | string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  cash_balance?: number;
  [k: string]: unknown;
}
export interface SearchHit { symbol: string; name: string; exchange: string; type: string }
export interface QuoteData {
  symbol: string; name?: string; price: number; change?: number; change_pct?: number;
  previous_close?: number; day_high?: number; day_low?: number;
  fifty_two_week_high?: number; fifty_two_week_low?: number;
  currency?: string; currency_symbol?: string; exchange?: string;
  is_market_open?: boolean; market_status?: string; close_timestamp?: string;
  prediction?: { direction?: string; predicted_direction?: string; conviction?: number; conviction_pct?: number; confidence_pct?: number; targetPrice?: number; target_high?: number; stopLossPrice?: number; target_low?: number; horizonDays?: number; summary?: string; rsi?: number; sma_20?: number; momentum_5d_pct?: number };
  news?: { title: string; publisher?: string; time?: string; snippet?: string; link?: string }[];
  historical_closes?: number[];
  [k: string]: unknown;
}
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }
export interface CandlesData { symbol: string; interval?: string; range?: string; currency_symbol?: string; count: number; candles: Candle[] }
export interface AnalyzeData extends QuoteData { headlines?: string[]; analysis?: { sentiment?: string; confidence?: number; reason?: string } }
export interface Watchlist { id: number; name: string; source?: string; items: { id: number; symbol: string; name?: string; exchange?: string }[] }
export interface WatchQuote { id: number; symbol: string; name?: string; exchange?: string; price: number; change?: number; change_pct?: number; currency_symbol?: string; error?: string }
export interface WishlistItem { id: number; symbol: string; name?: string; target_price: number; live_price?: number; currency_symbol?: string; note?: string; target_hit?: boolean }
export interface Wallet { cash_balance: number; starting_balance: number; updated_at?: string }
export interface OrderRow { id: number; symbol: string; side: string; order_type: string; qty: number; limit_price?: number; filled_price?: number; stop_loss_price?: number; target_price?: number; instrument_type?: string; status: string; created_at?: string }
export interface HoldingRow { id: number; symbol: string; name?: string; qty: number; avg_buy_price: number; position_type?: string; instrument_type?: string; stop_loss?: number; target_price?: number }
export interface PortfolioHolding { id: number; symbol: string; qty: number; avg_buy_price: number; live_price: number; currency_symbol?: string; invested: number; current_value: number; unrealized_pnl: number; unrealized_pnl_pct: number; day_change?: number; position_type?: string; instrument_type?: string; stop_loss?: number; target_price?: number }
export interface Portfolio {
  cash_balance: number; starting_balance: number; total_invested: number; current_value: number;
  total_portfolio_value: number; total_pnl: number; total_pnl_pct: number; days_pnl?: number; realized_pnl?: number;
  holdings: PortfolioHolding[];
}
export interface ScannerRule { field: string; operator: string; value: number | string; value_type?: string; multiplier?: number }
export interface ScannerHit { symbol: string; price: number; change?: number; change_pct?: number; rsi_14?: number; sma_20?: number; momentum_5d_pct?: number; volume?: number; avg_volume_10d?: number; reasons?: string[] }
export interface Scorecard {
  total_logged: number; total_resolved: number; directional_accuracy_pct: number; mean_absolute_error_pct: number;
  logs: { id: number; symbol: string; predicted_target: number; confidence_score?: number; status: string; actual_price?: number; error_pct?: number; is_direction_correct?: boolean; predicted_at?: string }[];
}

export interface OptionLegData {
  symbol: string;
  instrument_type: 'CE' | 'PE';
  strike: number;
  price: number;
  bid: number;
  ask: number;
  delta: number;
  iv: number;
  oi: number;
}

export interface OptionChainStrike {
  strike: number;
  is_atm: boolean;
  call: OptionLegData;
  put: OptionLegData;
}

export interface OptionExpiryItem {
  expiry: string;
  days_to_expiry: number;
  label: string;
}

export interface OptionChainData {
  symbol: string;
  spot_price: number;
  lot_size: number;
  active_expiry: string;
  days_to_expiry: number;
  expiries: OptionExpiryItem[];
  atm_strike: number;
  strikes: OptionChainStrike[];
}

export interface OptionQuoteData {
  symbol: string;
  strike: number;
  type: 'CE' | 'PE';
  expiry: string;
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  iv: number;
  lot_size: number;
}


export interface JevPredictionData {
  symbol: string;
  action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  confidence_score: number;
  confidence_display: string;
  conviction_pct: number;
  trap_risk_pct: number;
  trap_risk_label: string;
  volatility_risk_pct: number;
  volatility_risk_label: string;
  current_price: number;
  predicted_close_price?: number;
  predicted_close_change?: number;
  predicted_close_pct?: number;
  predicted_close_high_bound?: number;
  predicted_close_low_bound?: number;
  predicted_close_display?: string;
  target_price: number;
  target_pct: number;
  stop_loss_price: number;
  stop_loss_pct: number;
  horizon_days: number;
  model: string;
  summary: string;
}

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtChange(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const val = Number(n);
  const sign = val >= 0 ? '+' : '';
  return `${sign}${fmt(val)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const val = Number(n);
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

export function subscribePriceWs(
  symbol: string,
  onUpdate: (data: { price: number; change?: number; change_pct?: number; direction?: string; is_market_open?: boolean }) => void
): () => void {
  const clean = symbol.trim().toUpperCase();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || '127.0.0.1:8000';
  const url = `${protocol}//${host}/ws/price/${encodeURIComponent(clean)}`;
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && !payload.error && typeof payload.price === 'number') {
            onUpdate(payload);
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (!closed) {
          setTimeout(connect, 2000);
        }
      };
    } catch {
      if (!closed) setTimeout(connect, 3000);
    }
  }

  connect();

  return () => {
    closed = true;
    try {
      ws?.close();
    } catch { /* ignore */ }
  };
}

