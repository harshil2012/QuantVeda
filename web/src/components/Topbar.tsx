import { useState, useEffect, useRef } from 'react';
import { STOCKS } from '../lib/mock';
import { api, fmt, fmtPct, type SearchHit } from '../lib/api';

interface Props {
  theme: string;
  setTheme: (t: string) => void;
  user: { name: string; id: string; balance: number } | null;
  onLogout: () => void;
  onSearch: (sym: string) => void;
  onOpenAI: () => void;
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  symbol: string;
  onToggleMobile: () => void;
}

export default function Topbar({ theme, setTheme, user, onLogout, onSearch, onOpenAI, symbol, onToggleMobile }: Props) {
  const [time, setTime] = useState('');
  const [search, setSearch] = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [activeQuote, setActiveQuote] = useState<{ price: number; change_pct: number; is_market_open?: boolean; market_status?: string } | null>(null);
  const [topbarFlash, setTopbarFlash] = useState<'up' | 'down' | null>(null);
  const prevTopPriceRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Real-time price monitoring for active symbol in topbar
  useEffect(() => {
    let cancelled = false;
    const fetchTopQuote = async () => {
      try {
        const res = await api.quote(symbol);
        if (cancelled || !res?.data) return;
        const fresh = res.data;
        if (fresh.price !== undefined) {
          if (fresh.is_market_open !== false && prevTopPriceRef.current !== null) {
            if (fresh.price > prevTopPriceRef.current) {
              setTopbarFlash('up');
              setTimeout(() => setTopbarFlash(null), 400);
            } else if (fresh.price < prevTopPriceRef.current) {
              setTopbarFlash('down');
              setTimeout(() => setTopbarFlash(null), 400);
            }
          }
          prevTopPriceRef.current = fresh.price;
          setActiveQuote({
            price: fresh.price,
            change_pct: fresh.change_pct ?? 0,
            is_market_open: fresh.is_market_open,
            market_status: fresh.market_status,
          });
        }
      } catch {
        // silent retry
      }
    };
    fetchTopQuote();
    const t = setInterval(fetchTopQuote, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol]);

  const [liveHits, setLiveHits] = useState<SearchHit[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setLiveHits(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.search(search.trim());
        setLiveHits((res.data || res.results || []).slice(0, 6));
      } catch {
        setLiveHits(null);
      }
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const localFiltered = STOCKS.filter(s =>
    s.symbol.toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 6);
  const filtered = (liveHits && liveHits.length ? liveHits : localFiltered).slice(0, 6);

  const dark = theme === 'dark';

  const cycleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const themeIcon = theme === 'dark' ? 'dark_mode' : 'light_mode';

  return (
    <header style={{
      height: 56,
      background: 'var(--qv-topbar)',
      borderBottom: '1px solid var(--qv-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 12,
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      {/* Mobile hamburger & logo */}
      <div className="flex items-center gap-2 md:hidden">
        <button onClick={onToggleMobile} style={{ color: 'var(--qv-text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>menu</span>
        </button>
        <img src="/logo-mark.png" alt="QuantVeda" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <span className="material-symbols-outlined" style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 16, color: 'var(--qv-text3)', pointerEvents: 'none'
        }}>search</span>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setShowDrop(true); }}
          onFocus={() => setShowDrop(true)}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
          placeholder={symbol || 'Search symbol…'}
          style={{
            background: 'var(--qv-bg2)',
            border: '1px solid var(--qv-border)',
            color: 'var(--qv-text)',
            paddingLeft: 32,
            paddingRight: search ? 32 : 12,
            height: 34,
            borderRadius: 8,
            fontSize: 13,
            width: '100%',
            outline: 'none',
          }}
          onKeyDown={e => e.key === 'Escape' && setShowDrop(false)}
        />
        {search && (
          <button onClick={() => { setSearch(''); setShowDrop(false); }}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-text3)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        )}

        {showDrop && search && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--qv-card)', border: '1px solid var(--qv-border)',
            borderRadius: 10, boxShadow: 'var(--qv-shadow-md)', zIndex: 50, overflow: 'hidden'
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 14px', color: 'var(--qv-text3)', fontSize: 13 }}>No results</div>
            ) : filtered.map(s => (
              <button key={s.symbol}
                onMouseDown={() => { onSearch(s.symbol); setSearch(''); setShowDrop(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qv-text)', fontFamily: 'JetBrains Mono, monospace' }}>{s.symbol.replace('.NS', '')}</div>
                  <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>{s.name}</div>
                </div>
                <span style={{ fontSize: 10, color: 'var(--qv-text3)', background: 'var(--qv-bg2)', padding: '2px 6px', borderRadius: 4 }}>{s.exchange}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Active Symbol Ticker (silent) */}
      {activeQuote && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--qv-bg2)',
          border: '1px solid var(--qv-border)',
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <span style={{ fontWeight: 700, color: 'var(--qv-text)' }}>{symbol.replace('.NS', '')}</span>
          <span style={{
            fontWeight: 700,
            color: 'var(--qv-text)',
          }}>
            ₹{fmt(activeQuote.price)}
          </span>
          <span style={{
            fontSize: 11,
            color: activeQuote.change_pct >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)',
            fontWeight: 600,
          }}>
            {fmtPct(activeQuote.change_pct)}
          </span>
        </div>
      )}

      {/* Clock & Market Status */}
      <div style={{ color: 'var(--qv-text2)', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className={activeQuote?.is_market_open ? "pulse-dot inline-block w-1.5 h-1.5 rounded-full" : "inline-block w-1.5 h-1.5 rounded-full"}
          style={{ background: activeQuote?.is_market_open ? 'var(--qv-bull)' : '#94a3b8' }}
        />
        <span>IST {time}</span>
        {activeQuote?.is_market_open !== undefined && (
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 600,
            background: activeQuote.is_market_open ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.12)',
            color: activeQuote.is_market_open ? '#10b981' : '#94a3b8',
            border: `1px solid ${activeQuote.is_market_open ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.2)'}`,
          }}>
            {activeQuote.is_market_open ? 'NSE OPEN' : 'NSE CLOSED'}
          </span>
        )}
      </div>

      {/* AI */}
      <button onClick={onOpenAI}
        style={{ background: dark ? 'rgba(56,139,253,0.15)' : 'rgba(37,99,235,0.1)', border: '1px solid var(--qv-accent)', color: 'var(--qv-accent)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>auto_awesome</span>
        AI Analysis
      </button>

      {/* Theme */}
      <button onClick={cycleTheme}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-text2)', padding: 6, borderRadius: 8 }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text2)'}>
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{themeIcon}</span>
      </button>

      {/* Notifications */}
      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-text2)', padding: 6, borderRadius: 8, position: 'relative' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text2)'}>
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>notifications</span>
        <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, background: '#f85149', borderRadius: '50%', border: '2px solid var(--qv-topbar)' }} />
      </button>

      {/* Auth */}
      {user ? (
        <div className="relative">
          <button onClick={() => setShowUser(!showUser)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, #388bfd, #3fb950)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'white' }}>{user.name.split(' ').map(n => n[0]).join('')}</span>
            </div>
            <span style={{ fontSize: 13, color: 'var(--qv-text)', fontWeight: 500, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name.split(' ')[0]}</span>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--qv-text3)' }}>expand_more</span>
          </button>

          {showUser && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6,
              background: 'var(--qv-card)', border: '1px solid var(--qv-border)',
              borderRadius: 12, boxShadow: 'var(--qv-shadow-lg)', zIndex: 50, minWidth: 200, overflow: 'hidden'
            }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--qv-border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--qv-text)' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{user.id}</div>
                <div style={{ fontSize: 12, color: 'var(--qv-bull)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>₹{user.balance.toLocaleString('en-IN')}</div>
              </div>
              <div style={{ padding: '6px' }}>
                <button onClick={() => { setShowUser(false); onLogout(); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer', color: '#f85149', borderRadius: 8, fontSize: 13 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(248,81,73,0.1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>logout</span>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Sign In
        </button>
      )}
    </header>
  );
}
