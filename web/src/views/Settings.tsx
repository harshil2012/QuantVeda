import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface Props {
  theme: string;
  setTheme: (t: string) => void;
  user: { name: string; id: string; balance: number } | null;
  onLogout: () => void;
}

export default function Settings({ theme, setTheme, user, onLogout }: Props) {
  const [topupAmount, setTopupAmount] = useState('');
  const [balance, setBalance] = useState(user?.balance ?? 100000);
  const [startingBalance, setStartingBalance] = useState(user?.balance ?? 100000);
  const [walletError, setWalletError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const w = await api.wallet();
        if (w.data) {
          setBalance(w.data.cash_balance);
          setStartingBalance(w.data.starting_balance);
        }
      } catch {
        setWalletError('Wallet service unreachable — showing last known balance.');
      }
    })();
  }, []);
  const [defaultMarket, setDefaultMarket] = useState('NSE');
  const [currency, setCurrency] = useState('₹');
  const [defaultTf, setDefaultTf] = useState('1D');
  const [prefs, setPrefs] = useState({ volume: true, grid: true, autoScale: true, crosshair: true });
  const [topupSuccess, setTopupSuccess] = useState(false);

  const pnl = balance - startingBalance;

  const doTopup = async () => {
    const amt = parseFloat(topupAmount);
    if (!amt || amt <= 0) return;
    setBusy(true);
    setWalletError('');
    try {
      const res = await api.topup(amt);
      setBalance(res.data.cash_balance);
      setStartingBalance(res.data.starting_balance);
      setTopupAmount('');
      setTopupSuccess(true);
      setTimeout(() => setTopupSuccess(false), 2000);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!confirm('Reset wallet? This will clear all holdings and orders.')) return;
    setBusy(true);
    setWalletError('');
    try {
      await api.resetWallet();
      const w = await api.wallet();
      setBalance(w.data.cash_balance);
      setStartingBalance(w.data.starting_balance);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', color: 'var(--qv-text)',
    padding: '8px 12px', borderRadius: 8, fontSize: 13, outline: 'none', width: '100%',
  };

  const selectStyle = { ...inputStyle };

  const SectionHeader = ({ title }: { title: string }) => (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qv-text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>{title}</div>
  );

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qv-text)', marginBottom: 2 }}>Settings</h1>
        <div style={{ fontSize: 12, color: 'var(--qv-text3)' }}>Preferences & Account</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Theme */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 24 }}>
          <SectionHeader title="Appearance" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { id: 'light', label: 'Light', icon: 'light_mode' },
              { id: 'dark', label: 'Dark', icon: 'dark_mode' },
            ].map(t => (
              <button key={t.id} onClick={() => setTheme(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                  background: theme === t.id ? (theme === 'dark' ? 'rgba(56,139,253,0.12)' : 'rgba(37,99,235,0.08)') : 'var(--qv-bg2)',
                  border: `1px solid ${theme === t.id ? 'var(--qv-accent)' : 'var(--qv-border)'}`,
                  color: theme === t.id ? 'var(--qv-accent)' : 'var(--qv-text)',
                  transition: 'all 0.15s', textAlign: 'left',
                }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 13, fontWeight: theme === t.id ? 600 : 400 }}>{t.label}</span>
                {theme === t.id && <span className="material-symbols-outlined" style={{ fontSize: 16, marginLeft: 'auto' }}>check</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Preferences */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 24 }}>
          <SectionHeader title="Preferences" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--qv-text3)', marginBottom: 6 }}>Default Market</div>
              <select value={defaultMarket} onChange={e => setDefaultMarket(e.target.value)} style={selectStyle}>
                {['NSE', 'BSE', 'NASDAQ', 'NYSE'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--qv-text3)', marginBottom: 6 }}>Currency</div>
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={selectStyle}>
                {['₹', '$'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--qv-text3)', marginBottom: 6 }}>Default Timeframe</div>
              <select value={defaultTf} onChange={e => setDefaultTf(e.target.value)} style={selectStyle}>
                {['1m', '5m', '15m', '1H', '4H', '1D', '1W'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Wallet */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 24 }}>
          <SectionHeader title="Paper Wallet" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
            {[
              { l: 'Cash Balance', v: `₹${balance.toLocaleString('en-IN')}`, c: 'var(--qv-text)' },
              { l: 'Starting Balance', v: `₹${startingBalance.toLocaleString('en-IN')}`, c: 'var(--qv-text3)' },
              { l: 'Total P&L', v: `${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}`, c: pnl >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background: 'var(--qv-bg2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--qv-text3)', marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--qv-text3)', marginBottom: 8 }}>Top-up amount (₹)</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter amount" type="number"
              style={{ ...inputStyle, flex: 1 }} />
            <button onClick={doTopup} disabled={busy}
              style={{ background: 'var(--qv-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Working…' : 'Add Funds'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: topupSuccess ? 8 : 0 }}>
            {[50000, 100000, 500000, 1000000].map(amt => (
              <button key={amt} onClick={() => setTopupAmount(String(amt))}
                style={{ background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', color: 'var(--qv-text2)', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                {amt >= 100000 ? `${amt / 100000}L` : `${amt / 1000}K`}
              </button>
            ))}
          </div>

          {topupSuccess && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--qv-bull)' }}>✓ Funds added successfully!</div>}
          {walletError && <div style={{ marginTop: 8, fontSize: 12, color: '#f85149' }}>{walletError}</div>}

          <button onClick={doReset}
            style={{ marginTop: 16, width: '100%', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', color: 'var(--qv-bear)', borderRadius: 8, padding: '9px', fontSize: 13, cursor: 'pointer' }}>
            Reset Wallet & Clear Portfolio
          </button>
        </div>

        {/* Chart prefs */}
        <div style={{ background: 'var(--qv-card)', border: '1px solid var(--qv-border)', borderRadius: 'var(--qv-radius)', padding: 24 }}>
          <SectionHeader title="Chart Preferences" />
          {[
            { id: 'volume', label: 'Show Volume', desc: 'Display volume bars below price' },
            { id: 'grid', label: 'Show Grid', desc: 'Display background grid lines' },
            { id: 'autoScale', label: 'Auto Scale', desc: 'Automatically fit price range' },
            { id: 'crosshair', label: 'Crosshair', desc: 'Show crosshair on hover' },
          ].map(({ id, label, desc }) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBlock: 13, borderBottom: '1px solid var(--qv-border)' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--qv-text)', fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>{desc}</div>
              </div>
              <button
                onClick={() => setPrefs(p => ({ ...p, [id]: !p[id as keyof typeof p] }))}
                style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: prefs[id as keyof typeof prefs] ? 'var(--qv-accent)' : 'var(--qv-border)', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: prefs[id as keyof typeof prefs] ? 21 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </button>
            </div>
          ))}

          {/* Account */}
          {user && (
            <div style={{ marginTop: 20 }}>
              <SectionHeader title="Account" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qv-text)' }}>{user.name}</div>
                  <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text3)' }}>{user.id}</div>
                </div>
                <button onClick={onLogout}
                  style={{ background: 'none', border: '1px solid var(--qv-bear)', color: 'var(--qv-bear)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
