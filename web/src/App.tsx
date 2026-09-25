import { useState, useEffect, useCallback } from 'react';
import AuthPage from './pages/AuthPage';
import TerminalPage from './pages/TerminalPage';
import { api, getStoredUser, setSession, clearSession, type AuthUser } from './lib/api';

export type AppUser = {
  name: string;
  id: string;
  balance: number;
  email?: string | null;
  phone?: string | null;
};

function toAppUser(u: AuthUser, fallbackBalance = 100000): AppUser {
  const name =
    u.name ||
    (u.email ? String(u.email).split('@')[0] : null) ||
    (u.phone ? `Trader ${String(u.phone).slice(-4)}` : null) ||
    'Trader';
  return {
    name,
    id: String(u.id ?? 'guest'),
    balance: Number(u.cash_balance ?? fallbackBalance),
    email: u.email ?? null,
    phone: u.phone ?? null,
  };
}

function applyTheme(theme: string) {
  const effective = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', effective === 'dark');
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(true);
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('quantveda-theme') ?? 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('quantveda-theme', theme === 'light' ? 'light' : 'dark');
    } catch { /* ignore */ }
  }, [theme]);

  // No system listener - only dark / light

  // Restore session via backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.has('guest')) {
          if (!cancelled) {
            setUser({ name: 'Guest', id: 'guest', balance: 100000 });
            setAuthed(true);
            setBooting(false);
          }
          return;
        }
        const stored = getStoredUser<AuthUser>();
        if (!stored && !(localStorage.getItem('quantveda_auth_token') || localStorage.getItem('quantveda_token'))) {
          setBooting(false);
          return;
        }
        const me = await api.me();
        if (cancelled) return;
        const bal = me.wallet?.cash_balance ?? me.user?.cash_balance ?? 100000;
        setUser(toAppUser({ ...me.user, cash_balance: bal }));
        setAuthed(true);
      } catch {
        clearSession();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    const onUnauth = () => {
      clearSession();
      setUser(null);
      setAuthed(false);
    };
    window.addEventListener('qv:unauthorized', onUnauth);
    return () => {
      cancelled = true;
      window.removeEventListener('qv:unauthorized', onUnauth);
    };
  }, []);

  const handleAuth = useCallback((u: AuthUser, token?: string) => {
    if (token) setSession(token, u);
    setUser(toAppUser(u));
    setAuthed(true);
  }, []);

  const handleLogout = useCallback(() => {
    api.logout().catch(() => undefined);
    clearSession();
    setUser(null);
    setAuthed(false);
  }, []);

  if (booting) {
    return (
      <div className="qv-auth-bg min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--qv-text2)' }}>
          <span className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--qv-border)', borderTopColor: 'var(--qv-accent)' }} />
          Connecting to QuantVeda engine…
        </div>
      </div>
    );
  }

  if (!authed) {
    return <AuthPage onAuth={handleAuth} />;
  }

  return <TerminalPage user={user} theme={theme} setTheme={setTheme} onLogout={handleLogout} />;
}
