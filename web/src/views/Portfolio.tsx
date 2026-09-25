import { useState, useEffect, useCallback } from 'react';
import { api, fmt, fmtChange, fmtPct, type Portfolio as PortfolioData, type OrderRow } from '../lib/api';

interface Props {
  user: { balance: number } | null;
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  theme: string;
}

export default function Portfolio({ user, onOpenOrder, theme }: Props) {
  const [tab, setTab] = useState<'holdings' | 'orders'>('holdings');
  const [live, setLive] = useState<PortfolioData | null>(null);
  const [liveOrders, setLiveOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const dark = theme === 'dark';

  const refresh = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([
        api.portfolio().catch(() => null),
        api.orders().catch(() => null)
      ]);
      if (p?.data) setLive(p.data);
      if (o?.data) setLiveOrders(o.data);
    } catch {
      // silent retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // 5s refresh - fast enough, low load
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const holdings = (live?.holdings ?? []).map(h => ({
    symbol: h.symbol,
    name: h.symbol,
    qty: h.qty,
    avgBuy: h.avg_buy_price,
    ltp: h.live_price,
    invested: h.invested,
    current: h.current_value,
    pnl: h.unrealized_pnl,
    pnlPct: h.unrealized_pnl_pct,
    position: (h as { position_type?: string }).position_type || (h.qty < 0 ? 'SHORT' : 'LONG'),
    instrument: (h as { instrument_type?: string }).instrument_type || 'EQUITY',
    sl: (h as { stop_loss?: number }).stop_loss,
    tp: (h as { target_price?: number }).target_price,
    signal: h.unrealized_pnl >= 0 ? 'BUY' : 'SELL',
  }));
  const longs = holdings.filter(h => h.qty >= 0);
  const shorts = holdings.filter(h => h.qty < 0);

  type OrderView = { id: number | string; date: string; symbol: string; side: string; type: string; qty: number; price: number; status: string };
  const orders: OrderView[] = (liveOrders ?? []).map(o => ({
    id: o.id,
    date: o.created_at ? new Date(o.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
    symbol: o.symbol,
    side: o.side,
    type: o.order_type,
    qty: o.qty,
    price: o.filled_price ?? o.limit_price ?? 0,
    status: o.status,
  }));

  const totalInvested = live?.total_invested ?? holdings.reduce((s, h) => s + h.invested, 0);
  const totalCurrent = live?.current_value ?? holdings.reduce((s, h) => s + h.current, 0);
  const totalPnl = live?.total_pnl ?? (totalCurrent - totalInvested);
  const totalPnlPct = live?.total_pnl_pct ?? (totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0);
  const cash = live?.cash_balance ?? user?.balance ?? 100000;
  const totalValue = live?.total_portfolio_value ?? (totalCurrent + cash);

  const handleCancel = async (id: number) => {
    if (!id) return;
    try {
      await api.cancelOrder(id);
      refresh();
    } catch {
      setNotice('Cancel failed on server.');
    }
  };

  const metricCards = [
    { label: 'Total Portfolio', value: `₹${fmt(totalValue, 0)}`, sub: `${fmtPct(totalPnlPct)} all time`, subColor: totalPnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)' },
    { label: 'Cash Balance', value: `₹${fmt(cash, 0)}`, sub: 'Available to invest', subColor: 'var(--qv-text3)' },
    { label: 'Invested', value: `₹${fmt(totalInvested, 0)}`, sub: `Current: ₹${fmt(totalCurrent, 0)}`, subColor: 'var(--qv-text3)' },
    { label: 'Unrealized P&L', value: `${fmtChange(totalPnl)}`, sub: fmtPct(totalPnlPct), subColor: totalPnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)', valueColor: totalPnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)' },
  ];

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qv-text)', marginBottom: 2 }}>Trading Portfolio</h1>
            {shorts.length > 0 && <span style={{ fontSize: 11, background: 'var(--qv-bear-bg)', color: 'var(--qv-bear)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>{shorts.length} SHORT</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--qv-text3)' }}>
            Real-time equity curve and paper balance evaluation
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onOpenOrder('RELIANCE.NS', 'BUY')}
            style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            New Order
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
          {notice}
        </div>
      )}

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {metricCards.map(c => (
          <div key={c.label} style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c.valueColor ?? 'var(--qv-text)', marginBottom: 4 }}>
              {c.value}
            </div>
            <div style={{ fontSize: 11, color: c.subColor, fontFamily: 'JetBrains Mono, monospace' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--qv-border)', padding: '0 16px' }}>
          {[
            { id: 'holdings', label: 'Holdings', count: holdings.length },
            { id: 'orders', label: 'Orders', count: orders.length },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as 'holdings' | 'orders')}
              style={{
                padding: '13px 0', marginRight: 24, borderBottom: tab === t.id ? '2px solid var(--qv-accent)' : '2px solid transparent',
                color: tab === t.id ? 'var(--qv-accent)' : 'var(--qv-text3)', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t.id ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6
              }}>
              {t.label}
              <span style={{ background: tab === t.id ? (dark ? 'rgba(56,139,253,0.2)' : 'rgba(37,99,235,0.1)') : 'var(--qv-bg2)', color: tab === t.id ? 'var(--qv-accent)' : 'var(--qv-text3)', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                {t.count}
              </span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Longs: {longs.length} · Shorts: {shorts.length}</span>
          </div>
        </div>

        {tab === 'holdings' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
                {['Asset', 'Pos', 'Qty', 'Avg', 'LTP', 'SL / Target', 'P&L', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--qv-text3)', fontSize: 13 }}>Loading portfolio holdings…</td></tr>
              ) : holdings.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: 'center' }}>
                    <div className="text-gray-400 text-sm mb-2">No open positions yet in your portfolio.</div>
                    <button onClick={() => onOpenOrder('RELIANCE.NS', 'BUY')}
                      style={{ background: 'var(--qv-bull)', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Place Your First Trade
                    </button>
                  </td>
                </tr>
              ) : holdings.map(h => (
                <tr key={h.symbol}
                  style={{ borderBottom: '1px solid var(--qv-border)', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--qv-text)' }}>{h.symbol.replace('.NS', '')}</div>
                    <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>NSE · {h.instrument}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: h.position === 'SHORT' ? 'var(--qv-bear-bg)' : 'var(--qv-bull-bg)', color: h.position === 'SHORT' ? 'var(--qv-bear)' : 'var(--qv-bull)' }}>{h.position}</span>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>{h.qty}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>₹{fmt(h.avgBuy)}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)', fontWeight: 600 }}>₹{fmt(h.ltp)}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--qv-text2)' }}>{h.sl ? `SL ${fmt(h.sl, 0)}` : '—'} / {h.tp ? `T ${fmt(h.tp, 0)}` : '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: h.pnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                      {h.pnl >= 0 ? '+' : ''}₹{fmt(h.pnl, 0)}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: h.pnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                      {fmtPct(h.pnlPct)}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {h.position === 'SHORT' ? (
                        <button onClick={() => onOpenOrder(h.symbol, 'BUY')}
                          style={{ background: 'var(--qv-bull-bg)', border: 'none', color: 'var(--qv-bull)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                          Cover
                        </button>
                      ) : (
                        <>
                          <button onClick={() => onOpenOrder(h.symbol, 'BUY')}
                            style={{ background: 'var(--qv-bull-bg)', border: 'none', color: 'var(--qv-bull)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                            Buy
                          </button>
                          <button onClick={() => onOpenOrder(h.symbol, 'SELL')}
                            style={{ background: 'var(--qv-bear-bg)', border: 'none', color: 'var(--qv-bear)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                            Sell
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'orders' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
                {['Order ID', 'Date & Time', 'Asset', 'Side', 'Type', 'Qty', 'Price', 'Status', 'Action'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--qv-text3)', fontSize: 13 }}>No orders recorded yet.</td></tr>
              ) : orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--qv-border)' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--qv-text3)' }}>#{o.id}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--qv-text2)' }}>{o.date}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: 'var(--qv-text)' }}>{o.symbol.replace('.NS', '')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
                      background: o.side === 'BUY' ? 'var(--qv-bull-bg)' : 'var(--qv-bear-bg)',
                      color: o.side === 'BUY' ? 'var(--qv-bull)' : 'var(--qv-bear)',
                    }}>{o.side}</span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--qv-text3)' }}>{o.type}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>{o.qty}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>₹{fmt(o.price)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: o.status === 'FILLED' ? 'var(--qv-bull-bg)' : o.status === 'PENDING' ? 'rgba(247,201,72,0.15)' : 'var(--qv-bg2)',
                      color: o.status === 'FILLED' ? 'var(--qv-bull)' : o.status === 'PENDING' ? '#b7791f' : 'var(--qv-text3)',
                    }}>{o.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {o.status === 'PENDING' && (
                      <button onClick={() => handleCancel(Number(o.id))}
                        style={{ background: 'none', border: '1px solid var(--qv-border)', color: 'var(--qv-bear)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
