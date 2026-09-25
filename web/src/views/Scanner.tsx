import { useState } from 'react';
import { api, fmt, fmtPct, type ScannerHit } from '../lib/api';

interface Props {
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  theme: string;
}

type Condition = { field: string; op: string; value: string };

const FIELDS = ['rsi_14', 'change_pct', 'momentum_5d_pct', 'price'];
const OPS = ['>=', '<=', '>', '<'];
const UNIVERSES = ['NIFTY 50', 'NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO'];

export default function Scanner({ onOpenOrder, theme }: Props) {
  const [universe, setUniverse] = useState('NIFTY 50');
  const [conditions, setConditions] = useState<Condition[]>([
    { field: 'rsi_14', op: '>=', value: '50' },
    { field: 'change_pct', op: '>', value: '0.5' },
  ]);
  const [liveHits, setLiveHits] = useState<ScannerHit[] | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const dark = theme === 'dark';

  const addCondition = () => setConditions(prev => [...prev, { field: 'rsi_14', op: '>=', value: '50' }]);
  const removeCondition = (i: number) => setConditions(prev => prev.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, field: keyof Condition, val: string) => {
    setConditions(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  };

  const runScan = async () => {
    setRunning(true);
    setLiveHits(null);
    setError('');
    try {
      const rules = conditions.map(c => ({ field: c.field, operator: c.op, value: parseFloat(c.value) || 0 }));
      const res = await api.runScanner(universe, rules);
      setScannedCount(res.data?.scanned_count ?? 0);
      const hits = res.data?.hits || [];
      setLiveHits(hits);
      if (hits.length === 0) {
        setError(`Scanned ${res.data?.scanned_count ?? 0} instruments in ${universe}. No symbols met all criteria.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Screener engine offline. Please retry in a moment.');
    } finally {
      setRunning(false);
    }
  };

  const selectStyle = {
    background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', color: 'var(--qv-text)',
    borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none',
  };

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qv-text)', marginBottom: 2 }}>Stock Scanner</h1>
          <div style={{ fontSize: 12, color: 'var(--qv-text3)' }}>Real-time Market Technical Screener</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={runScan} disabled={running}
            style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: running ? 0.7 : 1 }}>
            {running ? <span style={{ width: 14, height: 14, display: 'inline-block', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> : <span className="material-symbols-outlined" style={{ fontSize: 15 }}>play_arrow</span>}
            {running ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        {/* Config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--qv-text)', marginBottom: 12 }}>Universe</div>
            <select value={universe} onChange={e => setUniverse(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
              {UNIVERSES.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>

          <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--qv-text)' }}>Filter Rules</div>
              <button onClick={addCondition} style={{ fontSize: 11, color: 'var(--qv-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add Rule</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conditions.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)} style={{ ...selectStyle, flex: 1.4 }}>
                    {FIELDS.map(f => <option key={f}>{f}</option>)}
                  </select>
                  <select value={c.op} onChange={e => updateCondition(i, 'op', e.target.value)} style={{ ...selectStyle, width: 52 }}>
                    {OPS.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <input value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)}
                    style={{ ...selectStyle, width: 60, fontFamily: 'JetBrains Mono, monospace' }} />
                  {conditions.length > 1 && (
                    <button onClick={() => removeCondition(i)} style={{ color: 'var(--qv-text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--qv-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qv-text)' }}>
                {liveHits ? `${liveHits.length} live matches (${scannedCount} scanned)` : 'Scanner Results'}
              </span>
              {running && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--qv-accent)', background: dark ? 'rgba(56,139,253,0.1)' : 'rgba(37,99,235,0.08)', padding: '2px 8px', borderRadius: 10 }}>
                  <span className="pulse-dot inline-block" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--qv-accent)' }} />
                  Scanning Live
                </span>
              )}
            </div>
          </div>

          {error && !running && (
            <div style={{ margin: 16, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
              {error}
            </div>
          )}

          {!liveHits && !running && (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: 'var(--qv-text3)', display: 'block', marginBottom: 12 }}>search_insights</span>
              <div style={{ color: 'var(--qv-text3)', fontSize: 13 }}>Configure your technical conditions and click Run Scan</div>
            </div>
          )}

          {running && (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, border: '3px solid var(--qv-border)', borderTopColor: 'var(--qv-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 14px' }} />
              <div style={{ color: 'var(--qv-text2)', fontSize: 13 }}>Evaluating real-time universe {universe}…</div>
              <div style={{ color: 'var(--qv-text3)', fontSize: 11, marginTop: 4 }}>Checking {conditions.length} conditions against live market feeds</div>
            </div>
          )}

          {liveHits && liveHits.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
                  {['Ticker', 'Price', 'Change %', 'RSI(14)', 'AI Signal', 'Action'].map(h => (
                    <th key={h} style={{ padding: '8px 20px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {liveHits.map(r => {
                  const bull = (r.change_pct ?? 0) >= 0;
                  return (
                    <tr key={r.symbol}
                      style={{ borderBottom: '1px solid var(--qv-border)', transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--qv-text)' }}>{r.symbol.replace('.NS', '')}</div>
                        <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>NSE · Live</div>
                      </td>
                      <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--qv-text)' }}>₹{fmt(r.price)}</td>
                      <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: bull ? 'var(--qv-bull)' : 'var(--qv-bear)' }}>
                        {fmtPct(r.change_pct)}
                      </td>
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: (r.rsi_14 ?? 50) > 70 ? 'var(--qv-bear)' : (r.rsi_14 ?? 50) < 30 ? 'var(--qv-bull)' : 'var(--qv-text)' }}>
                          {(r.rsi_14 ?? 50).toFixed(1)}
                        </div>
                      </td>
                      <td style={{ padding: '12px 20px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: 1, fontFamily: 'JetBrains Mono, monospace',
                          background: bull ? 'var(--qv-bull-bg)' : 'var(--qv-bear-bg)',
                          color: bull ? 'var(--qv-bull)' : 'var(--qv-bear)',
                        }}>{bull ? 'BUY' : 'SELL'}</span>
                      </td>
                      <td style={{ padding: '12px 20px' }}>
                        <button onClick={() => onOpenOrder(r.symbol, bull ? 'BUY' : 'SELL')}
                          style={{ background: 'none', border: '1px solid var(--qv-border)', color: 'var(--qv-text2)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          Trade
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
