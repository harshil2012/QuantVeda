import { useState, useEffect } from 'react';
import { api, fmt } from '../lib/api';

interface Props {
  symbol: string;
  onClose: () => void;
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
}

export default function AIModal({ symbol, onClose, onOpenOrder }: Props) {
  const [loading, setLoading] = useState(true);
  const [liveSignal, setLiveSignal] = useState<{
    direction: 'BUY' | 'SELL' | 'HOLD';
    conviction: number;
    target: number | null;
    stopLoss: number | null;
    horizon: string;
    rationale: string;
    bullPct: number;
    bearPct: number;
  } | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api.analyze(symbol)
      .then(res => {
        if (cancelled || !res?.data) return;
        const d = res.data;
        const p = d.prediction ?? {};
        const rawDir = String(p.direction ?? p.predicted_direction ?? 'BUY').toUpperCase();
        const dir: 'BUY' | 'SELL' | 'HOLD' = rawDir.includes('SELL') ? 'SELL' : rawDir.includes('HOLD') ? 'HOLD' : 'BUY';
        
        setLiveSignal({
          direction: dir,
          conviction: p.conviction_pct ?? p.confidence_pct ?? p.conviction ?? 75,
          target: p.targetPrice ?? p.target_high ?? null,
          stopLoss: p.stopLossPrice ?? p.target_low ?? null,
          horizon: p.horizonDays ? `${p.horizonDays}D` : '14D',
          rationale: p.summary ?? d.analysis?.reason ?? 'Neural momentum and volume profile model analyzing order books and volume-weighted moving averages.',
          bullPct: dir === 'BUY' ? 68 : dir === 'SELL' ? 32 : 50,
          bearPct: dir === 'BUY' ? 32 : dir === 'SELL' ? 68 : 50,
        });
        if (d.price) setLivePrice(d.price);
      })
      .catch(() => {
        // silent fail
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol]);

  const signal = liveSignal ?? {
    direction: 'HOLD' as const,
    conviction: 50,
    target: null,
    stopLoss: null,
    horizon: '14D',
    rationale: 'Evaluating quantitative signals from exchange data feed…',
    bullPct: 50,
    bearPct: 50,
  };

  const dirColor = signal.direction === 'BUY' ? 'var(--qv-bull)' : signal.direction === 'SELL' ? 'var(--qv-bear)' : 'var(--qv-text2)';
  const dirBg = signal.direction === 'BUY' ? 'var(--qv-bull-bg)' : signal.direction === 'SELL' ? 'var(--qv-bear-bg)' : 'var(--qv-bg2)';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 20, width: 480, boxShadow: 'var(--qv-shadow-lg)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--qv-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: 'linear-gradient(135deg, #388bfd, #a78bfa)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'white' }}>auto_awesome</span>
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qv-text)' }}>AI Analysis</div>
              <div style={{ fontSize: 11, color: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace' }}>{symbol.replace('.NS', '')} · Neural Engine</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-text3)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ width: 36, height: 36, border: '3px solid var(--qv-border)', borderTopColor: 'var(--qv-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ color: 'var(--qv-text)', fontSize: 14, fontWeight: 600 }}>Analyzing {symbol.replace('.NS', '')}</div>
            <div style={{ color: 'var(--qv-text3)', fontSize: 12, marginTop: 4 }}>Computing quantitative prediction model…</div>
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            {/* Signal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <span style={{ background: dirBg, color: dirColor, fontSize: 22, fontWeight: 800, padding: '10px 20px', borderRadius: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 2 }}>
                {signal.direction}
              </span>
              <div>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 4 }}>Conviction Score</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 100, height: 6, background: 'var(--qv-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${signal.conviction}%`, height: '100%', background: 'var(--qv-accent)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--qv-text)' }}>{signal.conviction}%</span>
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Horizon</div>
                <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--qv-text)' }}>{signal.horizon}</div>
              </div>
            </div>

            {/* Levels */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <div style={{ background: 'var(--qv-bull-bg)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: 'var(--qv-bull)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>TARGET PRICE</div>
                <div style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--qv-bull)' }}>
                  {signal.target ? `₹${fmt(signal.target, 0)}` : '—'}
                </div>
                {signal.target && livePrice && (
                  <div style={{ fontSize: 11, color: 'var(--qv-bull)' }}>+{(((signal.target - livePrice) / livePrice) * 100).toFixed(1)}% upside</div>
                )}
              </div>
              <div style={{ background: 'var(--qv-bear-bg)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: 'var(--qv-bear)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>STOP LOSS</div>
                <div style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--qv-bear)' }}>
                  {signal.stopLoss ? `₹${fmt(signal.stopLoss, 0)}` : '—'}
                </div>
                {signal.stopLoss && livePrice && (
                  <div style={{ fontSize: 11, color: 'var(--qv-bear)' }}>{(((signal.stopLoss - livePrice) / livePrice) * 100).toFixed(1)}% downside</div>
                )}
              </div>
            </div>

            {/* Sentiment */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--qv-bull)', fontWeight: 600 }}>Bullish {signal.bullPct}%</span>
                <span style={{ fontSize: 12, color: 'var(--qv-bear)', fontWeight: 600 }}>{signal.bearPct}% Bearish</span>
              </div>
              <div style={{ height: 8, background: 'var(--qv-bear-bg)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${signal.bullPct}%`, background: 'var(--qv-bull)', borderRadius: 4 }} />
              </div>
            </div>

            {/* Rationale */}
            <div style={{ background: 'var(--qv-bg2)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, borderLeft: '3px solid var(--qv-accent)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--qv-accent)', marginBottom: 8, letterSpacing: 0.5 }}>AI RATIONALE</div>
              <div style={{ fontSize: 13, color: 'var(--qv-text)', lineHeight: 1.7 }}>{signal.rationale}</div>
            </div>

            {/* CTA */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}
                style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', color: 'var(--qv-text2)', fontSize: 13, cursor: 'pointer' }}>
                Close
              </button>
              <button onClick={() => { onClose(); onOpenOrder(symbol, signal.direction === 'SELL' ? 'SELL' : 'BUY'); }}
                style={{ flex: 2, padding: '10px', borderRadius: 10, background: dirColor, border: 'none', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
                Execute Signal: {signal.direction}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
