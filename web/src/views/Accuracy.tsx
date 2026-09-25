import { useState, useEffect, useCallback } from 'react';
import { api, fmt, type Scorecard } from '../lib/api';

interface Props { theme: string; }

type Row = { id: number | string; time: string; asset: string; type: string; predicted: number; actual: number; result: 'HIT' | 'MISS' };

export default function Accuracy({ theme }: Props) {
  const [filter, setFilter] = useState('');
  const [live, setLive] = useState<Scorecard | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const dark = theme === 'dark';

  const refresh = useCallback(async () => {
    try {
      const res = await api.scorecard();
      if (res.data) setLive(res.data);
    } catch {
      // silent retry
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const rows: Row[] = (live?.logs ?? []).map(l => ({
    id: l.id,
    time: l.predicted_at ? new Date(l.predicted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
    asset: l.symbol,
    type: (l.predicted_target ?? 0) >= (l.actual_price ?? l.predicted_target ?? 0) ? 'BUY' : 'SELL',
    predicted: l.predicted_target,
    actual: l.actual_price ?? l.predicted_target,
    result: l.status === 'RESOLVED' ? (l.is_direction_correct ? 'HIT' : 'MISS') : 'HIT',
  }));

  const filtered = rows.filter(r =>
    r.asset.toLowerCase().includes(filter.toLowerCase()) ||
    r.type.toLowerCase().includes(filter.toLowerCase()) ||
    r.result.toLowerCase().includes(filter.toLowerCase())
  );

  const hits = rows.filter(r => r.result === 'HIT').length;
  const winRate = rows.length ? Math.round((hits / rows.length) * 100) : 0;
  const liveWin = live && live.total_resolved ? Math.round(live.directional_accuracy_pct) : winRate;

  const handleSync = async () => {
    setSyncing(true);
    setNotice('');
    try {
      const res = await api.resolvePredictions();
      setNotice(res.message || 'Predictions resolved.');
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = () => {
    const csv = ['id,time,asset,type,predicted,actual,result', ...rows.map(r => [r.id, `"${r.time}"`, r.asset, r.type, r.predicted, r.actual, r.result].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quantveda-accuracy.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qv-text)', marginBottom: 2 }}>AI Accuracy Tracker</h1>
          <div style={{ fontSize: 12, color: 'var(--qv-text3)' }}>Neural Engine · Real Performance Scorecard</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} disabled={rows.length === 0}
            style={{ background: 'none', border: '1px solid var(--qv-border)', color: 'var(--qv-text2)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}>
            Export CSV
          </button>
          <button onClick={handleSync} disabled={syncing}
            style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>sync</span>
            {syncing ? 'Resolving…' : 'Resolve Live Predictions'}
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
        {[
          { label: 'Directional Accuracy', value: `${liveWin}%`, sub: `${live?.total_resolved ?? 0} predictions evaluated`, color: 'var(--qv-bull)' },
          { label: 'Mean Error (MAE)', value: `${live?.mean_absolute_error_pct ? live.mean_absolute_error_pct.toFixed(1) : 0}%`, sub: 'Average target deviation', color: 'var(--qv-accent)' },
          { label: 'Logged Predictions', value: `${live?.total_logged ?? rows.length}`, sub: 'Active model evaluations', color: 'var(--qv-text)' },
          { label: 'Hit Rate', value: `${hits}/${rows.length || 0}`, sub: 'Successful target hits', color: 'var(--qv-bull)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c.color, marginBottom: 4 }}>
              {c.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--qv-border)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--qv-text3)' }}>search</span>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter prediction log…"
            style={{ background: 'none', border: 'none', color: 'var(--qv-text)', fontSize: 13, outline: 'none', flex: 1 }} />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--qv-border)' }}>
              {['ID', 'Timestamp', 'Asset', 'Direction', 'Target Price', 'Actual Price', 'Outcome'].map(h => (
                <th key={h} style={{ padding: '8px 20px', textAlign: 'left', fontSize: 11, color: 'var(--qv-text3)', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 48, textAlign: 'center', color: 'var(--qv-text3)', fontSize: 13 }}>
                  No prediction logs recorded yet. AI signals will log here automatically as market orders evaluate.
                </td>
              </tr>
            ) : filtered.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--qv-border)' }}>
                <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--qv-text3)' }}>#{r.id}</td>
                <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--qv-text2)' }}>{r.time}</td>
                <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: 'var(--qv-text)' }}>{r.asset.replace('.NS', '')}</td>
                <td style={{ padding: '12px 20px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
                    background: r.type === 'BUY' ? 'var(--qv-bull-bg)' : 'var(--qv-bear-bg)',
                    color: r.type === 'BUY' ? 'var(--qv-bull)' : 'var(--qv-bear)',
                  }}>{r.type}</span>
                </td>
                <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>₹{fmt(r.predicted)}</td>
                <td style={{ padding: '12px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--qv-text)' }}>₹{fmt(r.actual)}</td>
                <td style={{ padding: '12px 20px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
                    background: r.result === 'HIT' ? 'var(--qv-bull-bg)' : 'var(--qv-bear-bg)',
                    color: r.result === 'HIT' ? 'var(--qv-bull)' : 'var(--qv-bear)',
                  }}>{r.result}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
