type View = 'dashboard' | 'charts' | 'watchlists' | 'portfolio' | 'scanner' | 'accuracy' | 'settings';

interface Props {
  currentView: View;
  setView: (v: View) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  theme: string;
}

const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { view: 'charts', icon: 'query_stats', label: 'Charts' },
  { view: 'watchlists', icon: 'list_alt', label: 'Watchlists' },
  { view: 'portfolio', icon: 'account_balance_wallet', label: 'Portfolio' },
  { view: 'scanner', icon: 'search_insights', label: 'Scanner' },
  { view: 'accuracy', icon: 'track_changes', label: 'Accuracy' },
  { view: 'settings', icon: 'settings', label: 'Settings' },
];

export default function Sidenav({ currentView, setView, collapsed, setCollapsed, theme }: Props) {
  const dark = theme === 'dark';

  return (
    <aside style={{
      width: collapsed ? 68 : 240,
      background: 'var(--qv-sidenav)',
      borderRight: '1px solid var(--qv-border)',
      transition: 'width 0.2s ease',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      position: 'relative',
    }}>
      {/* Logo */}
      <div style={{ padding: collapsed ? '18px 14px' : '16px 18px', borderBottom: '1px solid var(--qv-border)' }}
        className="flex items-center gap-3 overflow-hidden">
        <img src="/logo-mark.png" alt="QuantVeda Logo"
          style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 0 12px rgba(56,189,248,0.25)', border: '1px solid rgba(56,189,248,0.2)' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        {!collapsed && (
          <div className="overflow-hidden">
            <div style={{ color: 'var(--qv-text)', fontSize: 14, letterSpacing: 0.5 }} className="font-bold leading-tight whitespace-nowrap">QUANTVEDA</div>
            <div style={{ color: 'var(--qv-accent)', fontSize: 10, letterSpacing: 1 }} className="font-mono whitespace-nowrap">AI ENGINE</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = currentView === item.view;
          return (
            <button key={item.view}
              onClick={() => setView(item.view)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '10px 20px' : '10px 16px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: active ? (dark ? 'rgba(56,139,253,0.12)' : 'rgba(37,99,235,0.08)') : 'transparent',
                borderLeft: active ? `3px solid var(--qv-accent)` : '3px solid transparent',
                color: active ? 'var(--qv-accent)' : 'var(--qv-text2)',
                transition: 'all 0.15s',
                cursor: 'pointer',
                border: 'none',
                borderRight: 'none',
                borderTop: 'none',
                borderBottom: 'none',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, flexShrink: 0, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                {item.icon}
              </span>
              {!collapsed && (
                <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--qv-border)', padding: collapsed ? '12px 14px' : '12px 16px' }}>
        <button onClick={() => setCollapsed(!collapsed)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, justifyContent: collapsed ? 'center' : 'flex-start', color: 'var(--qv-text3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: 6 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--qv-text3)'}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
          {!collapsed && <span style={{ fontSize: 12 }}>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
