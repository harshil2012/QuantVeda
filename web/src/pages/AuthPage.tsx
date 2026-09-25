import { useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import { googleIdToken } from '../lib/firebase';
import CyberBackground from '../components/CyberBackground';

interface AuthPageProps {
  onAuth: (user: AuthUser, token?: string) => void;
}

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳', label: 'India (+91)' },
  { code: '+1', flag: '🇺🇸', label: 'United States (+1)' },
  { code: '+44', flag: '🇬🇧', label: 'United Kingdom (+44)' },
  { code: '+971', flag: '🇦🇪', label: 'UAE (+971)' },
  { code: '+65', flag: '🇸🇬', label: 'Singapore (+65)' },
  { code: '+61', flag: '🇦🇺', label: 'Australia (+61)' },
  { code: '+49', flag: '🇩🇪', label: 'Germany (+49)' },
];

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [stage, setStage] = useState<1 | 3>(1);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('+91');
  const [regPassword, setRegPassword] = useState('');

  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [doneUser, setDoneUser] = useState<{ name: string; email?: string; phone?: string; id: string; balance: number } | null>(null);
  const [progress, setProgress] = useState(0);

  const finishLogin = (data: { token?: string; access_token?: string; user: AuthUser; is_new_user?: boolean }) => {
    const token = data.token || data.access_token || '';
    const bal = Number(data.user?.cash_balance ?? 100000);
    setDoneUser({
      name: data.user?.name || data.user?.email?.split('@')[0] || 'Trader',
      email: data.user?.email,
      phone: data.user?.phone,
      id: String(data.user?.id ?? ''),
      balance: bal,
    });
    setStage(3);
    setProgress(0);
    let p = 0;
    const t = setInterval(() => {
      p += 5;
      setProgress(p);
      if (p >= 100) {
        clearInterval(t);
        setTimeout(() => onAuth(data.user, token), 300);
      }
    }, 60);
  };

  const handleLoginSubmit = async () => {
    const ident = loginIdentifier.trim();
    if (!ident) {
      setAlert({ type: 'error', msg: 'Please enter your email address or mobile number.' });
      return;
    }
    if (!loginPassword) {
      setAlert({ type: 'error', msg: 'Please enter your password.' });
      return;
    }

    setAlert(null);
    setLoading(true);
    try {
      const data = await api.login(ident, loginPassword);
      finishLogin(data);
    } catch (e) {
      setAlert({ type: 'error', msg: e instanceof Error ? e.message : 'Sign in failed. Please check your credentials.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async () => {
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim().replace(/\s+/g, '');

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setAlert({ type: 'error', msg: 'Please enter a valid email address.' });
      return;
    }
    if (!cleanPhone) {
      setAlert({ type: 'error', msg: 'Please enter your mobile phone number.' });
      return;
    }
    if (!regPassword || regPassword.length < 4) {
      setAlert({ type: 'error', msg: 'Password must be at least 4 characters long.' });
      return;
    }

    const fullPhone = cleanPhone.startsWith('+')
      ? cleanPhone
      : `${country}${cleanPhone.replace(/^0+/, '')}`;

    setAlert(null);
    setLoading(true);
    try {
      const data = await api.register({
        name: name.trim() || cleanEmail.split('@')[0] || 'Trader',
        email: cleanEmail,
        phone: fullPhone,
        password: regPassword,
      });
      finishLogin(data);
    } catch (e) {
      setAlert({ type: 'error', msg: e instanceof Error ? e.message : 'Account registration failed.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setAlert(null);
    setGoogleLoading(true);
    try {
      const idToken = await googleIdToken();
      const data = await api.firebaseLogin(idToken);
      finishLogin(data);
    } catch (e) {
      setAlert({ type: 'error', msg: e instanceof Error ? e.message : 'Google sign-in was canceled or failed.' });
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-between overflow-x-hidden selection:bg-blue-600/30 selection:text-white">
      {/* Dynamic Cybernetic Quant Background Canvas */}
      <CyberBackground showTicker={true} />

      {/* Main Container: Split Hero & Glassmorphism Gateway */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 md:py-14 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-14">
        
        {/* LEFT COLUMN: QuantVeda Platform Showcase */}
        <div className="w-full lg:w-1/2 space-y-7 text-left">
          
          <div className="space-y-4">
            <div className="flex items-center gap-3.5">
              <img src="/logo-mark.png" alt="QuantVeda AI" className="w-14 h-14 rounded-2xl border border-cyan-500/30 shadow-lg shadow-cyan-500/20 object-cover" />
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-medium mb-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                  <span>QUANTVEDA SECURE GATEWAY v2.0</span>
                </div>
                <div className="text-xs font-mono text-cyan-300/80 tracking-wider">INSTITUTIONAL AI TRADING ENGINE</div>
              </div>
            </div>
            
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.15]">
              Algorithmic Precision.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400">
                Vedic Discipline.
              </span>
            </h1>
            
            <p className="text-sm sm:text-base text-gray-400 leading-relaxed max-w-xl">
              Sign in instantly with Google 1-Click Authentication or your saved Email, Mobile Number &amp; Password. 100% bank-grade cryptographic protection.
            </p>
          </div>

          {/* Value Props Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-xl">
            
            <div className="p-4 rounded-xl bg-[#0f1422]/80 backdrop-blur-md border border-[#1f293d] hover:border-emerald-500/40 transition-all duration-300 group">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-xl">account_balance_wallet</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-0.5">₹100,000 Virtual Capital</h4>
              <p className="text-xs text-gray-400 leading-normal">Instant pre-seeded paper wallet allocated to every trader upon sign-in.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0f1422]/80 backdrop-blur-md border border-[#1f293d] hover:border-blue-500/40 transition-all duration-300 group">
              <div className="w-9 h-9 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-xl">key</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-0.5">Google 1-Click Access</h4>
              <p className="text-xs text-gray-400 leading-normal">Instant single sign-on backed by Google OAuth &amp; Firebase security.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0f1422]/80 backdrop-blur-md border border-[#1f293d] hover:border-cyan-500/40 transition-all duration-300 group">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-xl">lock</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-0.5">Email, Mobile &amp; Password</h4>
              <p className="text-xs text-gray-400 leading-normal">Save your email, mobile number &amp; password with salted PBKDF2-SHA256 encryption.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0f1422]/80 backdrop-blur-md border border-[#1f293d] hover:border-purple-500/40 transition-all duration-300 group">
              <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-xl">insights</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-0.5">Multi-Horizon AI Sentiment</h4>
              <p className="text-xs text-gray-400 leading-normal">Vedic planetary cycles combined with Gemini predictive neural models.</p>
            </div>

          </div>

          {/* Trader Quote */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-950/40 to-indigo-950/30 border border-blue-900/30 flex items-center gap-3 max-w-xl">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-mono font-bold flex-shrink-0">
              ★
            </div>
            <p className="text-xs text-gray-300 italic">
              &ldquo;The speed of an institutional terminal, the intelligence of AI, and seamless password &amp; Google sign-in.&rdquo;
            </p>
          </div>

        </div>

        {/* RIGHT COLUMN: The Interactive Glassmorphism Auth Card */}
        <div className="w-full lg:w-1/2 max-w-md">
          
          <div 
            style={{ 
              background: 'rgba(15, 20, 34, 0.88)', 
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(56, 139, 253, 0.22)',
              boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 0 45px -10px rgba(56, 139, 253, 0.16)'
            }}
            className="rounded-3xl p-6 sm:p-8 relative overflow-hidden transition-all"
          >
            {/* Ambient Top Glow Line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-80" />

            {/* STAGE 1: PASSWORD LOGIN / REGISTER & GOOGLE SIGN-IN */}
            {stage === 1 && (
              <div className="space-y-4">
                
                {/* Header */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      Terminal Access
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                      Password Auth
                    </span>
                  </div>
                  <div className="flex justify-center py-1">
                    <img src="/logo.png" alt="QuantVeda AI" className="h-24 rounded-xl border border-blue-500/20 shadow-lg object-contain" />
                  </div>
                  <h2 className="text-xl font-bold text-white tracking-tight text-center">
                    {mode === 'login' ? 'Sign In to QuantVeda' : 'Create Trader Account'}
                  </h2>
                  <p className="text-xs text-gray-400 text-center">
                    {mode === 'login'
                      ? 'Enter your saved email/mobile and password or continue with Google.'
                      : 'Save your email, mobile number & password for instant access.'}
                  </p>
                </div>

                {/* Primary Google Sign-In Button */}
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={googleLoading || loading}
                  className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white bg-[#161c2c] hover:bg-[#1c2438] border border-[#2d3b58] hover:border-blue-500/50 shadow-md transition-all flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60 active:scale-[0.99]"
                >
                  {googleLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Connecting to Google…</span>
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
                      </svg>
                      <span>Continue with Google</span>
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 h-px bg-[#1f293d]" />
                  <span className="text-[11px] font-mono text-gray-500 uppercase tracking-wider">or use password</span>
                  <div className="flex-1 h-px bg-[#1f293d]" />
                </div>

                {/* Mode Segmented Tabs: Sign In vs Create Account */}
                <div className="p-1 rounded-xl bg-[#090d16] border border-[#1f293d] flex gap-1 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setAlert(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      mode === 'login' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">login</span>
                    <span>Sign In</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setAlert(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      mode === 'register' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">person_add</span>
                    <span>Create Account</span>
                  </button>
                </div>

                {mode === 'login' ? (
                  <div className="space-y-3">
                    {/* Login Identifier (Email or Mobile) */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-gray-300">Email Address or Mobile Number</label>
                      <div className="relative group">
                        <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                          person
                        </span>
                        <input
                          type="text"
                          value={loginIdentifier}
                          onChange={e => setLoginIdentifier(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleLoginSubmit()}
                          placeholder="trader@gmail.com or 9876543210"
                          className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                        />
                      </div>
                    </div>

                    {/* Login Password */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-gray-300">Password</label>
                      <div className="relative group">
                        <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                          lock
                        </span>
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={e => setLoginPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleLoginSubmit()}
                          placeholder="Enter your password"
                          className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-11 pr-10 py-2.5 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-2.5 text-gray-400 hover:text-white cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-lg">
                            {showPass ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Trader Name */}
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-300">Full Name</label>
                      <div className="relative group">
                        <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                          badge
                        </span>
                        <input
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder="Trader Name"
                          className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-11 pr-4 py-2 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                        />
                      </div>
                    </div>

                    {/* Email Address */}
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-300">Email Address</label>
                      <div className="relative group">
                        <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                          alternate_email
                        </span>
                        <input
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="trader@gmail.com"
                          className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-11 pr-4 py-2 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-gray-500 font-mono">Quick:</span>
                        {['@gmail.com', '@yahoo.com', '@outlook.com'].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setEmail(prev => (prev.split('@')[0] || 'trader') + d)}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#13192a] border border-[#1f293d] text-gray-400 hover:text-blue-400 hover:border-blue-500/40 transition-colors cursor-pointer"
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mobile Number */}
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-300">Mobile Phone Number</label>
                      <div className="flex gap-2">
                        <select
                          value={country}
                          onChange={e => setCountry(e.target.value)}
                          className="w-24 bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 rounded-xl py-2 px-2 text-xs text-white font-mono font-bold outline-none cursor-pointer appearance-none text-center"
                        >
                          {COUNTRY_CODES.map(c => (
                            <option key={c.code} value={c.code}>
                              {c.flag} {c.code}
                            </option>
                          ))}
                        </select>
                        <div className="relative flex-1 group">
                          <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                            call
                          </span>
                          <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="98765 43210"
                            className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-10 pr-3 py-2 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-300">Create Password</label>
                      <div className="relative group">
                        <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-gray-400 text-lg group-focus-within:text-blue-400 transition-colors">
                          lock
                        </span>
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={regPassword}
                          onChange={e => setRegPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRegisterSubmit()}
                          placeholder="Create a strong password"
                          className="w-full bg-[#0c101c] border border-[#1f293d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl pl-11 pr-10 py-2 text-sm text-white placeholder:text-gray-500 font-mono outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-2 text-gray-400 hover:text-white cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-lg">
                            {showPass ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Alert Box */}
                {alert && (
                  <div
                    className={`rounded-xl px-3.5 py-2.5 text-xs font-mono border ${
                      alert.type === 'error'
                        ? 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                        : 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    }`}
                  >
                    {alert.msg}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={mode === 'login' ? handleLoginSubmit : handleRegisterSubmit}
                  disabled={loading || googleLoading}
                  style={{ background: 'linear-gradient(135deg, #388bfd, #2563eb)' }}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>{mode === 'login' ? 'Signing In…' : 'Saving Account…'}</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">
                        {mode === 'login' ? 'login' : 'how_to_reg'}
                      </span>
                      <span>
                        {mode === 'login' ? 'Sign In to Terminal' : 'Save Account & Launch Terminal'}
                      </span>
                    </>
                  )}
                </button>

                {/* Guest Mode Link */}
                <div className="pt-2 border-t border-[#1f293d]/60 text-center">
                  <a
                    href="?guest=1"
                    className="text-xs text-gray-400 hover:text-blue-400 font-mono inline-flex items-center gap-1 transition-colors"
                  >
                    <span>Looking around first?</span>
                    <span className="font-bold underline">Explore Terminal as Guest &rarr;</span>
                  </a>
                </div>

              </div>
            )}

            {/* STAGE 3: SUCCESS ANIMATION & AUTO LAUNCH */}
            {stage === 3 && doneUser && (
              <div className="space-y-6 text-center py-4">
                
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/20">
                  <span className="material-symbols-outlined text-3xl animate-bounce">check</span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-2xl font-bold text-white tracking-tight">Access Authorized</h3>
                  <p className="text-sm text-gray-300">Welcome to QuantVeda Terminal, {doneUser.name}!</p>
                </div>

                <div className="p-4 rounded-2xl bg-[#13192a] border border-[#1f293d] text-left space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-400">Trader Handle:</span>
                    <span className="font-bold text-white">{doneUser.name}</span>
                  </div>
                  {doneUser.email && (
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-gray-400">Saved Email:</span>
                      <span className="font-bold text-cyan-400">{doneUser.email}</span>
                    </div>
                  )}
                  {doneUser.phone && (
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-gray-400">Saved Mobile:</span>
                      <span className="font-bold text-cyan-400">{doneUser.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-400">Paper Balance:</span>
                    <span className="font-bold text-emerald-400">₹{doneUser.balance.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-400">Session Protection:</span>
                    <span className="text-blue-400 font-semibold">256-Bit Signed JWT</span>
                  </div>
                </div>

                {/* Launch Progress Bar */}
                <div className="space-y-2 pt-2">
                  <div className="w-full bg-[#090d16] rounded-full h-2 overflow-hidden border border-[#1f293d]">
                    <div
                      style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #388bfd, #10b981)' }}
                      className="h-full transition-all duration-100 ease-out"
                    />
                  </div>
                  <p className="text-xs text-gray-400 font-mono">Launching trading workspace…</p>
                </div>

              </div>
            )}

          </div>

          {/* Bottom Card Security Badges */}
          <div className="mt-5 flex items-center justify-around text-[11px] font-mono text-gray-500">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-gray-400">lock</span>
              <span>256-Bit SSL</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-gray-400">verified_user</span>
              <span>PBKDF2 Encrypted</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-gray-400">bolt</span>
              <span>Sub-ms Execution</span>
            </div>
          </div>

        </div>

      </main>

      {/* Global Footer */}
      <footer className="relative z-10 w-full border-t border-[#1f293d]/80 py-3.5 px-6 text-center text-xs text-gray-500 font-mono flex flex-col sm:flex-row items-center justify-between gap-2 bg-[#090d16]/80 backdrop-blur-sm">
        <div>&copy; 2026 QuantVeda AI. All rights reserved. SEBI Compliant Simulation Engine.</div>
        <div className="flex items-center gap-4">
          <a href="?guest=1" className="hover:text-blue-400 transition-colors">Guest Terminal</a>
          <span className="text-gray-700">&bull;</span>
          <a href="/docs" className="hover:text-blue-400 transition-colors">API Docs</a>
          <span className="text-gray-700">&bull;</span>
          <span className="text-gray-400">Status: <span className="text-emerald-400 font-semibold">● Online</span></span>
        </div>
      </footer>
    </div>
  );
}
