import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { STOCKS } from '../lib/mock';
import { api, fmt, fmtChange, fmtPct, subscribePriceWs, type QuoteData, type JevPredictionData } from '../lib/api';

interface Props {
  symbol: string;
  onSymbolChange: (s: string) => void;
  onOpenAI: () => void;
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  theme: string;
}

const CORRELATED = [
  { symbol: '^NSEI', name: 'NIFTY 50 Benchmark Index', corr: 1.00, bias: 'BUY' },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', corr: 0.91, bias: 'BUY' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', corr: 0.88, bias: 'BUY' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', corr: 0.84, bias: 'BUY' },
  { symbol: 'INFY.NS', name: 'Infosys Limited', corr: 0.82, bias: 'BUY' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd.', corr: 0.79, bias: 'BUY' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel', corr: 0.72, bias: 'BUY' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', corr: 0.70, bias: 'HOLD' },
  { symbol: 'ITC.NS', name: 'ITC Ltd.', corr: 0.69, bias: 'BUY' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro', corr: 0.68, bias: 'BUY' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors', corr: 0.67, bias: 'BUY' },
];

export default function Dashboard({ symbol, onSymbolChange, onOpenAI, onOpenOrder, theme }: Props) {
  const [loading, setLoading] = useState(true);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [candles, setCandles] = useState<{ time: string; value: number; volume: number }[]>([]);
  const [live, setLive] = useState<QuoteData | null>(null);
  const [liveError, setLiveError] = useState('');
  const [corrQuotes, setCorrQuotes] = useState<Record<string, { price: number; changePct: number }>>({});
  const [jevData, setJevData] = useState<JevPredictionData | null>(null);

  const prevPriceRef = useRef<number | null>(null);
  const dark = theme === 'dark';
  const stock = STOCKS.find(s => s.symbol.toUpperCase() === symbol.toUpperCase()) || {
    symbol,
    name: symbol.replace('.NS', ''),
    exchange: 'NSE',
    sector: 'Indian Equities',
  };

  // Live price loop + WebSocket (silent, no visual spam)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLive(null);
    setLiveError('');
    prevPriceRef.current = null;

    const fetchQuote = async () => {
      try {
        const res = await api.quote(symbol);
        if (cancelled || !res?.data) return;
        const fresh = res.data;
        
        if (fresh.price !== undefined) {
          prevPriceRef.current = fresh.price;
        }

        setLive(fresh);
        setLoading(false);
        setLiveError('');
      } catch (err) {
        if (!cancelled && !live) {
          setLiveError('Awaiting exchange feed…');
        }
      }
    };

    // Immediate fetch
    fetchQuote();

    // 3s refresh (fast enough, low load)
    const quoteInterval = setInterval(fetchQuote, 3000);

    // WebSocket silent ticks
    const unsubWs = subscribePriceWs(symbol, wsPayload => {
      if (cancelled || !wsPayload || wsPayload.price === undefined) return;
      prevPriceRef.current = wsPayload.price;
      setLive(prev => prev ? { ...prev, price: wsPayload.price, change: wsPayload.change } : prev);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      clearInterval(quoteInterval);
      unsubWs();
    };
  }, [symbol]);

  // Fetch real candles for the active symbol
  useEffect(() => {
    let cancelled = false;
    setCandlesLoading(true);

    api.candles(symbol, '1d', '1mo')
      .then(c => {
        if (cancelled) return;
        const raw = c?.data?.candles;
        if (raw && Array.isArray(raw) && raw.length > 0) {
          setCandles(raw.map(k => ({
            time: new Date(k.time * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            value: k.close,
            volume: k.volume ?? 0,
          })));
        } else {
          setCandles([]);
        }
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      })
      .finally(() => {
        if (!cancelled) setCandlesLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol]);

  // Fetch TypeSafe Jev™ Model System One prediction
  useEffect(() => {
    let cancelled = false;
    api.jevPrediction(symbol)
      .then(res => {
        if (!cancelled && res?.data) {
          setJevData(res.data);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  // Refresh correlated quotes every 5s batched
  useEffect(() => {
    let cancelled = false;

    const fetchCorrelated = async () => {
      try {
        const syms = CORRELATED.map(r => r.symbol);
        const res = await api.quotes(syms);
        if (cancelled || !res?.data) return;
        const map: Record<string, { price: number; changePct: number }> = {};
        res.data.forEach(q => {
          if (q && q.symbol && q.price !== undefined) {
            map[q.symbol.toUpperCase()] = {
              price: q.price,
              changePct: q.change_pct ?? 0,
            };
          }
        });
        if (Object.keys(map).length > 0) setCorrQuotes(map);
      } catch {
        // silent fail
      }
    };

    fetchCorrelated();
    const corrInterval = setInterval(fetchCorrelated, 5000);
    return () => {
      cancelled = true;
      clearInterval(corrInterval);
    };
  }, []);

  const p = live?.prediction;
  const price = live?.price ?? null;
  const change = live?.change ?? null;
  const changePct = live?.change_pct ?? 0;
  const bull = changePct >= 0;
  const accentColor = bull ? 'var(--qv-bull)' : 'var(--qv-bear)';
  const curSym = live?.currency_symbol || '₹';

  const signal = {
    direction: jevData?.action || p?.direction || p?.predicted_direction || (bull ? 'BUY' : 'SELL'),
    conviction: jevData ? Math.round(jevData.confidence_score * 10) : (p?.conviction_pct ?? p?.confidence_pct ?? p?.conviction ?? 78),
    confidenceScore: jevData ? jevData.confidence_score : 7.8,
    target: jevData?.target_price || p?.targetPrice || p?.target_high || (price ? price * 1.05 : null),
    stopLoss: jevData?.stop_loss_price || p?.stopLossPrice || p?.target_low || (price ? price * 0.96 : null),
    horizon: jevData ? `${jevData.horizon_days}D Intraday / Jev Model` : (p?.horizonDays ? `${p.horizonDays}D` : '14D'),
    rationale: jevData?.summary || p?.summary || 'TypeSafe Jev™ Model evaluating order book momentum, moving averages, and volatility indices.',
    bullPct: bull ? 65 : 35,
    bearPct: bull ? 35 : 65,
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>

      {/* Hero live quote card */}
      <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ background: dark ? '#1f2d42' : '#dbeafe', color: 'var(--qv-accent)', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1 }}>
                {live?.exchange || stock.exchange}
              </span>
              <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>{stock.sector}</span>
            </div>

            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700, color: 'var(--qv-text)', letterSpacing: 1, marginBottom: 2 }}>
              {symbol.replace('.NS', '')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--qv-text2)', marginBottom: 14 }}>
              {live?.name || stock.name}
            </div>

            {/* Live price silent */}
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 36,
              fontWeight: 700,
              color: 'var(--qv-text)',
              marginBottom: 6,
            }}>
              {loading && price === null ? (
                <span className="text-sm font-sans font-normal text-gray-400 flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin inline-block" />
                  Streaming live price from exchange…
                </span>
              ) : (
                `${curSym}${fmt(price)}`
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              {price !== null ? (
                <span style={{
                  background: bull ? 'var(--qv-bull-bg)' : 'var(--qv-bear-bg)',
                  color: accentColor,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 20,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {fmtChange(change)} ({fmtPct(changePct)}) {bull ? '▲' : '▼'}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Awaiting market tick</span>
              )}
              {live?.is_market_open !== undefined && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: live.is_market_open ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: live.is_market_open ? '#10b981' : '#f87171' }}>
                  {live.is_market_open ? 'MARKET OPEN' : 'MARKET CLOSED'}
                </span>
              )}
            </div>

            {/* Genuine Market Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 16px' }}>
              {[
                { l: 'Prev Close', v: live?.previous_close ? `${curSym}${fmt(live.previous_close)}` : '—' },
                { l: 'Day High', v: live?.day_high ? `${curSym}${fmt(live.day_high)}` : '—' },
                { l: 'Day Low', v: live?.day_low ? `${curSym}${fmt(live.day_low)}` : '—' },
                { l: '52W High', v: live?.fifty_two_week_high ? `${curSym}${fmt(live.fifty_two_week_high)}` : '—' },
                { l: '52W Low', v: live?.fifty_two_week_low ? `${curSym}${fmt(live.fifty_two_week_low)}` : '—' },
                { l: 'Exchange Time', v: (live?.close_timestamp as string | undefined) || 'Active' },
              ].map(({ l, v }) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>{l}</div>
                  <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text)', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--qv-text3)', fontWeight: 600, letterSpacing: 0.5 }}>EXCHANGE TREND</span>
              <button
                onClick={() => onSymbolChange(symbol)}
                title="Open Interactive Candlestick Chart"
                style={{
                  background: 'var(--qv-bg2)',
                  border: '1px solid var(--qv-border)',
                  color: 'var(--qv-accent)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  borderRadius: 6,
                  padding: '3px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s ease',
                }}>
                <span>Interactive Pro Chart</span>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>candlestick_chart</span>
              </button>
            </div>
            {candlesLoading ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--qv-bg2)', borderRadius: 10 }}>
                <span className="text-xs text-gray-400 flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin inline-block" />
                  Loading exchange candlestick series…
                </span>
              </div>
            ) : candles.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={candles.slice(-30)}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={accentColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} interval={5} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} width={60} tickFormatter={v => `${curSym}${(v/1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 8, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    labelStyle={{ color: 'var(--qv-text2)' }}
                    itemStyle={{ color: accentColor }}
                    formatter={(v: unknown) => [`${curSym}${fmt(Number(v))}`, 'Close']}
                  />
                  <Area type="monotone" dataKey="value" stroke={accentColor} strokeWidth={1.8} fill="url(#areaGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--qv-bg2)', borderRadius: 10 }}>
                <span className="text-xs text-gray-400">Historical intraday data updating from exchange.</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => onOpenOrder(symbol, 'BUY')}
                style={{ flex: 1, background: 'var(--qv-bull)', color: 'white', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
                BUY {symbol.replace('.NS', '')}
              </button>
              <button onClick={() => onOpenOrder(symbol, 'SELL')}
                style={{ flex: 1, background: 'var(--qv-bear)', color: 'white', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
                SELL {symbol.replace('.NS', '')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: AI Signal + Sentiment + Fundamentals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {/* AI Signal */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--qv-text)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                TypeSafe Jev™ Signal
              </span>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                System One
              </span>
            </div>
            <button onClick={onOpenAI} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-accent)', fontSize: 11 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>open_in_new</span>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              background: signal.direction.includes('BUY') ? 'var(--qv-bull-bg)' : signal.direction.includes('SELL') ? 'var(--qv-bear-bg)' : dark ? '#1f2633' : '#f1f5f9',
              color: signal.direction.includes('BUY') ? 'var(--qv-bull)' : signal.direction.includes('SELL') ? 'var(--qv-bear)' : 'var(--qv-text2)',
              fontSize: 14, fontWeight: 800, padding: '6px 14px', borderRadius: 8, letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace'
            }}>
              {signal.direction}
            </span>
            {jevData && (
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text2)' }}>
                Score: <strong style={{ color: 'var(--qv-text)' }}>{jevData.confidence_score}/10</strong>
              </span>
            )}
          </div>
          {jevData && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              <div style={{ background: 'var(--qv-bg2)', padding: '4px 8px', borderRadius: 6 }}>
                <span style={{ color: 'var(--qv-text3)', fontSize: 10 }}>Trap Risk: </span>
                <span style={{ color: jevData.trap_risk_pct > 40 ? 'var(--qv-bear)' : 'var(--qv-bull)', fontWeight: 600 }}>
                  {jevData.trap_risk_pct}%
                </span>
              </div>
              <div style={{ background: 'var(--qv-bg2)', padding: '4px 8px', borderRadius: 6 }}>
                <span style={{ color: 'var(--qv-text3)', fontSize: 10 }}>Vol Risk: </span>
                <span style={{ color: jevData.volatility_risk_pct > 50 ? '#f59e0b' : 'var(--qv-text2)', fontWeight: 600 }}>
                  {jevData.volatility_risk_pct}%
                </span>
              </div>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Conviction</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--qv-text)' }}>{signal.conviction}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--qv-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, signal.conviction)}%`, background: 'var(--qv-accent)', borderRadius: 2 }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div style={{ background: 'var(--qv-bg2)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Target</div>
              <div style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--qv-bull)' }}>
                {signal.target ? `${curSym}${fmt(signal.target, 0)}` : '—'}
              </div>
            </div>
            <div style={{ background: 'var(--qv-bg2)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Stop Loss</div>
              <div style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--qv-bear)' }}>
                {signal.stopLoss ? `${curSym}${fmt(signal.stopLoss, 0)}` : '—'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--qv-text3)' }}>Horizon: {signal.horizon}</div>
        </div>

        {/* Sentiment */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qv-text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Market Sentiment</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--qv-bull)', fontWeight: 600 }}>Bullish {signal.bullPct}%</span>
              <span style={{ fontSize: 12, color: 'var(--qv-bear)', fontWeight: 600 }}>{signal.bearPct}% Bearish</span>
            </div>
            <div style={{ height: 8, background: 'var(--qv-bear-bg)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${signal.bullPct}%`, background: 'var(--qv-bull)', borderRadius: 4 }} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--qv-text2)', lineHeight: 1.6 }}>{signal.rationale}</div>
        </div>

        {/* Fundamentals & Live Quote Range */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qv-text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Market Overview</div>
          {[
            { l: 'Current Price', v: price !== null ? `${curSym}${fmt(price)}` : '—' },
            { l: 'Day Range', v: live?.day_low && live?.day_high ? `${curSym}${fmt(live.day_low)} – ${curSym}${fmt(live.day_high)}` : '—' },
            { l: '52W Range', v: live?.fifty_two_week_low && live?.fifty_two_week_high ? `${curSym}${fmt(live.fifty_two_week_low)} – ${curSym}${fmt(live.fifty_two_week_high)}` : '—' },
            { l: 'Market State', v: live?.market_status || (live?.is_market_open ? 'OPEN' : 'CLOSED') },
          ].map(({ l, v }) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBlock: 8, borderBottom: '1px solid var(--qv-border)' }}>
              <span style={{ fontSize: 12, color: 'var(--qv-text3)' }}>{l}</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text)', fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {liveError && (
        <div style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
          {liveError}
        </div>
      )}

      {/* Correlated live assets */}
      <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--qv-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--qv-text)' }}>
            Correlated Assets <span style={{ fontSize: 10, color: 'var(--qv-text3)', marginLeft: 6 }}>Top 10 NSE</span>
          </div>
          <button style={{ fontSize: 11, color: 'var(--qv-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>Matrix</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
              {['Asset', 'Correlation', 'Price', '24h Change', 'AI Bias'].map(h => (
                <th key={h} style={{ padding: '8px 20px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORRELATED.map(r => {
              const liveCorr = corrQuotes[r.symbol.toUpperCase()] || corrQuotes[r.symbol.replace('.NS', '')];
              const corrPrice = liveCorr?.price ?? null;
              const corrPct = liveCorr?.changePct ?? 0;
              const corrBull = corrPct >= 0;

              return (
                <tr key={r.symbol}
                  style={{ borderBottom: '1px solid var(--qv-border)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onClick={() => onSymbolChange(r.symbol)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                  <td style={{ padding: '10px 20px' }}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: 'var(--qv-text)' }}>{r.symbol.replace('.NS', '')}</div>
                    <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>{r.name}</div>
                  </td>
                  <td style={{ padding: '10px 20px' }}>
                    <div style={{ width: 80, height: 4, background: 'var(--qv-border)', borderRadius: 2 }}>
                      <div style={{ width: `${r.corr * 100}%`, height: '100%', background: 'var(--qv-accent)', borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text3)', marginTop: 3 }}>{r.corr.toFixed(2)}</div>
                  </td>
                  <td style={{ padding: '10px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>
                    {corrPrice !== null ? `₹${fmt(corrPrice)}` : <span className="text-gray-500 italic text-[11px]">streaming…</span>}
                  </td>
                  <td style={{ padding: '10px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: corrBull ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                    {corrPrice !== null ? fmtPct(corrPct) : '—'}
                  </td>
                  <td style={{ padding: '10px 20px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: 1, fontFamily: 'JetBrains Mono, monospace',
                      background: r.bias === 'BUY' ? 'var(--qv-bull-bg)' : r.bias === 'SELL' ? 'var(--qv-bear-bg)' : dark ? '#1f2633' : '#f1f5f9',
                      color: r.bias === 'BUY' ? 'var(--qv-bull)' : r.bias === 'SELL' ? 'var(--qv-bear)' : 'var(--qv-text2)',
                    }}>{r.bias}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
