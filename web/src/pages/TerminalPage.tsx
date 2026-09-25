import { useState } from 'react';
import Sidenav from '../components/Sidenav';
import Topbar from '../components/Topbar';
import OrderModal from '../components/OrderModal';
import AIModal from '../components/AIModal';
import Dashboard from '../views/Dashboard';
import Charts from '../views/Charts';
import Watchlists from '../views/Watchlists';
import Portfolio from '../views/Portfolio';
import Scanner from '../views/Scanner';
import Accuracy from '../views/Accuracy';
import Settings from '../views/Settings';

type View = 'dashboard' | 'charts' | 'watchlists' | 'portfolio' | 'scanner' | 'accuracy' | 'settings';

interface Props {
  user: { name: string; id: string; balance: number } | null;
  theme: string;
  setTheme: (t: string) => void;
  onLogout: () => void;
}

export default function TerminalPage({ user, theme, setTheme, onLogout }: Props) {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [orderModal, setOrderModal] = useState<{ sym: string; side: 'BUY' | 'SELL' } | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSearch = (sym: string) => {
    setSymbol(sym);
    setCurrentView('dashboard');
  };

  const handleOpenOrder = (sym: string, side: 'BUY' | 'SELL') => {
    setOrderModal({ sym, side });
  };

  const handleSymbolChange = (sym: string) => {
    setSymbol(sym);
    setCurrentView('charts');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--qv-bg)', position: 'relative' }}>
      <div className="qv-ambient" />

      {/* Desktop sidenav */}
      <div className="hidden md:flex" style={{ display: 'flex', flexShrink: 0, position: 'relative', zIndex: 10 }}>
        <Sidenav currentView={currentView} setView={setCurrentView} collapsed={collapsed} setCollapsed={setCollapsed} theme={theme} />
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setMobileOpen(false)} />
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 240, background: 'var(--qv-sidenav)', zIndex: 51 }}>
            <Sidenav currentView={currentView} setView={v => { setCurrentView(v); setMobileOpen(false); }} collapsed={false} setCollapsed={() => {}} theme={theme} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        <Topbar
          theme={theme}
          setTheme={setTheme}
          user={user}
          onLogout={onLogout}
          onSearch={handleSearch}
          onOpenAI={() => setShowAI(true)}
          onOpenOrder={handleOpenOrder}
          symbol={symbol}
          onToggleMobile={() => setMobileOpen(true)}
        />

        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ flex: 1, display: currentView === 'dashboard' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Dashboard symbol={symbol} onSymbolChange={handleSymbolChange} onOpenAI={() => setShowAI(true)} onOpenOrder={handleOpenOrder} theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'charts' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Charts symbol={symbol} onOpenOrder={handleOpenOrder} theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'watchlists' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Watchlists onOpenOrder={handleOpenOrder} onSymbolChange={handleSymbolChange} theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'portfolio' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Portfolio user={user} onOpenOrder={handleOpenOrder} theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'scanner' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Scanner onOpenOrder={handleOpenOrder} theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'accuracy' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Accuracy theme={theme} />
          </div>
          <div style={{ flex: 1, display: currentView === 'settings' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            <Settings theme={theme} setTheme={setTheme} user={user} onLogout={onLogout} />
          </div>
        </main>
      </div>

      {/* Modals */}
      {orderModal && (
        <OrderModal
          symbol={orderModal.sym}
          side={orderModal.side}
          onClose={() => setOrderModal(null)}
          user={user}
        />
      )}
      {showAI && (
        <AIModal
          symbol={symbol}
          onClose={() => setShowAI(false)}
          onOpenOrder={(s, side) => { setShowAI(false); setOrderModal({ sym: s, side }); }}
        />
      )}
    </div>
  );
}
