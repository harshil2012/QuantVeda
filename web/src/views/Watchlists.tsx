import { useState, useEffect, useCallback, useRef } from 'react';
import { WATCHLIST_DEFAULT } from '../lib/mock';
import { api, fmt, fmtPct, type WatchQuote } from '../lib/api';

interface Props {
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  onSymbolChange: (s: string) => void;
  theme: string;
}

export default function Watchlists({ onOpenOrder, onSymbolChange, theme }: Props) {
  const [watchlistId, setWatchlistId] = useState<number | null>(null);
  const [watchlistName, setWatchlistName] = useState('My Watchlist');
  const [watchlist, setWatchlist] = useState<string[]>(WATCHLIST_DEFAULT);
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({});
  const [flashing, setFlashing] = useState<Record<string, 'up' | 'down'>>({});
  const [addInput, setAddInput] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>('Connecting…');
  
  const prevPricesRef = useRef<Record<string, number>>({});
  const dark = theme === 'dark';

  // 1-second real-time quotes refresh
  const refreshQuotes = useCallback(async (syms: string[], wlId: number | null) => {
    try {
      let freshQuotes: WatchQuote[] = [];
      if (wlId !== null) {
        const qRes = await api.watchlistQuotes(wlId);
        freshQuotes = qRes.data?.quotes || [];
      } else if (syms.length > 0) {
        const qRes = await api.quotes(syms);
        freshQuotes = (qRes.data || []).map((q, idx) => ({
          id: idx,
          symbol: q.symbol,
          name: q.name || q.symbol,
          exchange: q.exchange || 'NSE',
          price: q.price,
          change: q.change,
          change_pct: q.change_pct,
          currency_symbol: q.currency_symbol || '₹',
        }));
      }

      if (freshQuotes.length > 0) {
        const map: Record<string, WatchQuote> = {};
        const newFlash: Record<string, 'up' | 'down'> = {};

        freshQuotes.forEach(x => {
          const symKey = x.symbol.toUpperCase();
          map[symKey] = x;
          const oldPrice = prevPricesRef.current[symKey];
          if (oldPrice !== undefined && x.price !== undefined && oldPrice !== x.price) {
            newFlash[symKey] = x.price > oldPrice ? 'up' : 'down';
          }
          if (x.price !== undefined) {
            prevPricesRef.current[symKey] = x.price;
          }
        });

        setQuotes(map);
        if (Object.keys(newFlash).length > 0) {
          setFlashing(newFlash);
          setTimeout(() => setFlashing({}), 450);
        }
        setLastRefreshed(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch {
      // silent retry on next 1s interval
    }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wl = await api.watchlists();
        if (cancelled) return;
        const lists = wl.data || [];
        const first = lists[0];
        let currentSyms = WATCHLIST_DEFAULT;
        let currentId: number | null = null;

        if (first) {
          currentId = first.id;
          setWatchlistId(first.id);
          setWatchlistName(first.name);
          const syms = first.items.map(i => i.symbol);
          if (syms.length > 0) {
            currentSyms = syms;
            setWatchlist(syms);
          }
        }
        await refreshQuotes(currentSyms, currentId);
      } catch {
        // Fallback to default symbols
        await refreshQuotes(WATCHLIST_DEFAULT, null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [refreshQuotes]);

  // Continuous 5s auto-refresh (fast, low load)
  useEffect(() => {
    const timer = setInterval(() => {
      refreshQuotes(watchlist, watchlistId);
    }, 5000);
    return () => clearInterval(timer);
  }, [watchlist, watchlistId, refreshQuotes]);

  const filtered = watchlist.filter(s => s.toLowerCase().includes(filter.toLowerCase()));

  const handleAdd = async () => {
    const raw = addInput.trim().toUpperCase();
    if (!raw) return;
    const sym = raw.includes('.') || raw.startsWith('^') ? raw : `${raw.replace('.NS', '')}.NS`;
    try {
      if (watchlistId != null) {
        await api.addWatchlistItem(watchlistId, sym, sym, 'NSE');
        const wl = await api.watchlists();
        const first = wl.data?.[0];
        if (first) {
          const syms = first.items.map(i => i.symbol);
          setWatchlist(syms);
          refreshQuotes(syms, watchlistId);
        }
      } else if (!watchlist.includes(sym)) {
        const updated = [...watchlist, sym];
        setWatchlist(updated);
        refreshQuotes(updated, null);
      }
    } catch {
      if (!watchlist.includes(sym)) {
        const updated = [...watchlist, sym];
        setWatchlist(updated);
        refreshQuotes(updated, null);
      }
    }
    setAddInput('');
  };

  const handleRemove = async (sym: string) => {
    try {
      if (watchlistId != null) {
        const wl = await api.watchlists();
        const item = (wl.data?.[0]?.items || []).find(i => i.symbol.toUpperCase() === sym.toUpperCase());
        if (item) await api.removeWatchlistItem(watchlistId, item.id);
      }
    } catch { /* ignore */ }
    setWatchlist(prev => prev.filter(s => s.toUpperCase() !== sym.toUpperCase()));
  };

  const priceOf = (sym: string) => {
    const q = quotes[sym.toUpperCase()] || quotes[sym.replace('.NS', '')];
    return q?.price;
  };

  const chgOf = (sym: string) => {
    const q = quotes[sym.toUpperCase()] || quotes[sym.replace('.NS', '')];
    return q?.change_pct ?? 0;
  };

  const loadedQuotes = filtered.filter(s => priceOf(s) !== undefined);
  const totalBull = loadedQuotes.filter(s => chgOf(s) >= 0).length;
  const sentimentScore = loadedQuotes.length ? Math.round((totalBull / loadedQuotes.length) * 100) : 50;

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qv-text)', marginBottom: 2 }}>{watchlistName}</h1>
          </div>
          <div style={{ fontSize: 12, color: 'var(--qv-text3)' }}>
            {watchlist.length} instruments · Last tick: <span className="font-mono text-gray-400">{lastRefreshed}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={addInput} onChange={e => setAddInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Add symbol (e.g. WIPRO)"
            style={{ background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', color: 'var(--qv-text)', padding: '7px 12px', borderRadius: 8, fontSize: 13, outline: 'none', width: 200 }} />
          <button onClick={handleAdd}
            style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Add
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        {/* Table */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--qv-border)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--qv-text3)' }}>search</span>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter watchlist…"
              style={{ background: 'none', border: 'none', color: 'var(--qv-text)', fontSize: 13, outline: 'none', flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace', background: 'var(--qv-bg2)', padding: '2px 8px', borderRadius: 10 }}>
              {filtered.length}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
                {['Asset', 'LTP (₹)', '24h Change', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--qv-text3)', fontSize: 13 }}>
                    <div className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin inline-block" />
                      Loading live market quotes…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--qv-text3)', fontSize: 13 }}>No symbols in watchlist</td></tr>
              ) : filtered.map(sym => {
                const symKey = sym.toUpperCase();
                const price = priceOf(sym);
                const chg = chgOf(sym);
                const bull = chg >= 0;
                const flash = flashing[symKey];

                return (
                  <tr key={sym}
                    style={{ borderBottom: '1px solid var(--qv-border)', cursor: 'pointer', transition: 'background 0.15s ease' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    <td style={{ padding: '12px 16px' }} onClick={() => onSymbolChange(sym)}>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--qv-text)' }}>
                        {sym.replace('.NS', '')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>NSE · Equity</div>
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 13,
                      fontWeight: 600,
                      color: flash === 'up' ? '#10b981' : flash === 'down' ? '#ef4444' : 'var(--qv-text)',
                      transition: 'color 0.3s ease',
                    }}>
                      {price !== undefined && price !== null && price > 0 ? (
                        `₹${fmt(price)}`
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: bull ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                      {price !== undefined ? fmtPct(chg) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => onSymbolChange(sym)}
                          style={{ background: 'none', border: '1px solid var(--qv-border)', color: 'var(--qv-text2)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
                          Chart
                        </button>
                        <button onClick={() => onOpenOrder(sym, 'BUY')}
                          style={{ background: 'var(--qv-bull-bg)', border: 'none', color: 'var(--qv-bull)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          Trade
                        </button>
                        <button onClick={() => handleRemove(sym)}
                          style={{ background: 'none', border: 'none', color: 'var(--qv-text3)', cursor: 'pointer', padding: '4px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qv-text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Watchlist Analytics</div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 48, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: sentimentScore >= 50 ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                {sentimentScore}
              </div>
              <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Real-time Breadth Score</div>
            </div>
            <div style={{ height: 8, background: 'var(--qv-bear-bg)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${sentimentScore}%`, background: 'var(--qv-bull)', borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--qv-text3)' }}>
              <span>{totalBull} advancing</span>
              <span>{loadedQuotes.length - totalBull} declining</span>
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--qv-text2)', lineHeight: 1.6, background: 'var(--qv-bg2)', borderRadius: 8, padding: '10px 12px' }}>
              {sentimentScore >= 60 ? 'Strong bullish market breadth across your active watchlist symbols.' :
               sentimentScore >= 40 ? 'Consolidating market breadth with balanced two-way price action.' :
               'Bearish pressure dominating selected watchlist basket.'}
            </div>
          </div>

          <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qv-text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Watchlist Stats</div>
            {[
              { l: 'Tracked Assets', v: `${watchlist.length}` },
              { l: 'Advancing', v: `${totalBull}`, c: 'var(--qv-bull)' },
              { l: 'Declining', v: `${loadedQuotes.length - totalBull}`, c: 'var(--qv-bear)' },
              { l: 'Update Cadence', v: 'Every 1.0s', c: 'var(--qv-accent)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingBlock: 7, borderBottom: '1px solid var(--qv-border)' }}>
                <span style={{ fontSize: 12, color: 'var(--qv-text3)' }}>{l}</span>
                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: c ?? 'var(--qv-text)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
