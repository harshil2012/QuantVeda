import { useEffect, useRef, useState } from 'react';
import { api, fmt, fmtChange, fmtPct, type QuoteData } from '../lib/api';

interface CyberBackgroundProps {
  showTicker?: boolean;
}

const DEFAULT_SYMBOLS = [
  { symbol: '^NSEI', display: 'NIFTY 50' },
  { symbol: '^NSEBANK', display: 'BANKNIFTY' },
  { symbol: 'RELIANCE.NS', display: 'RELIANCE' },
  { symbol: 'TCS.NS', display: 'TCS' },
  { symbol: 'HDFCBANK.NS', display: 'HDFCBANK' },
  { symbol: 'INFY.NS', display: 'INFY' },
  { symbol: 'ICICIBANK.NS', display: 'ICICIBANK' },
  { symbol: 'BHARTIARTL.NS', display: 'BHARTIARTL' },
];

export default function CyberBackground({ showTicker = true }: CyberBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tickerData, setTickerData] = useState<Record<string, QuoteData>>({});
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!showTicker) return;
    let cancelled = false;

    const fetchTicker = async () => {
      try {
        const syms = DEFAULT_SYMBOLS.map(s => s.symbol);
        const res = await api.quotes(syms);
        if (cancelled) return;
        if (res?.data && Array.isArray(res.data)) {
          const map: Record<string, QuoteData> = {};
          res.data.forEach(q => {
            if (q && q.symbol) map[q.symbol.toUpperCase()] = q;
          });
          setTickerData(map);
          setIsLive(true);
        }
      } catch {
        // network silent retry
      }
    };

    fetchTicker();
    // 1-second real-time refresh interval
    const interval = setInterval(fetchTicker, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showTicker]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Generate quant particle nodes and candlestick waves
    const particleCount = Math.min(35, Math.floor(width / 35));
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 1.8 + 0.8,
      alpha: Math.random() * 0.4 + 0.15,
      color: Math.random() > 0.5 ? '56, 139, 253' : '63, 185, 80',
    }));

    // Background floating candles
    const candleCount = 12;
    const candles = Array.from({ length: candleCount }, (_, i) => ({
      x: (width / candleCount) * i + Math.random() * 30,
      y: height * 0.6 + (Math.sin(i * 0.8) * 80),
      w: 8 + Math.random() * 8,
      h: 20 + Math.random() * 50,
      wickTop: 10 + Math.random() * 20,
      wickBottom: 10 + Math.random() * 20,
      bull: Math.random() > 0.4,
      speed: 0.15 + Math.random() * 0.1,
    }));

    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = Math.min(32, time - lastTime);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      // Render subtle floating candlesticks in background
      for (const c of candles) {
        c.y -= c.speed * (dt / 16);
        if (c.y < height * 0.2) c.y = height * 0.85;

        const color = c.bull ? 'rgba(63, 185, 80, 0.07)' : 'rgba(248, 81, 73, 0.06)';
        const wickColor = c.bull ? 'rgba(63, 185, 80, 0.12)' : 'rgba(248, 81, 73, 0.10)';

        // Wick
        ctx.strokeStyle = wickColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c.x + c.w / 2, c.y - c.wickTop);
        ctx.lineTo(c.x + c.w / 2, c.y + c.h + c.wickBottom);
        ctx.stroke();

        // Candle body
        ctx.fillStyle = color;
        ctx.fillRect(c.x, c.y, c.w, c.h);
      }

      // Update & render quant particle nodes
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        // Connect nearby particles with subtle lines
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            const lineAlpha = (1 - dist / 110) * 0.12;
            ctx.strokeStyle = `rgba(56, 139, 253, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <>
      {/* Deep Space Background Matrix Grid */}
      <div 
        className="fixed inset-0 pointer-events-none z-0" 
        style={{
          backgroundColor: '#090d16',
          backgroundImage: `
            radial-gradient(ellipse 70% 55% at 20% 25%, rgba(56, 139, 253, 0.14) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 85% 75%, rgba(63, 185, 80, 0.10) 0%, transparent 55%),
            radial-gradient(ellipse 45% 45% at 65% 15%, rgba(163, 113, 247, 0.08) 0%, transparent 50%),
            linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 100% 100%, 100% 100%, 36px 36px, 36px 36px'
        }}
      />

      {/* Floating Animated Luminous Orbs */}
      <div className="fixed top-[-10%] left-[-5%] w-[520px] h-[520px] rounded-full bg-blue-600/15 blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '6s' }} />
      <div className="fixed bottom-[-10%] right-[-5%] w-[550px] h-[550px] rounded-full bg-emerald-500/10 blur-[150px] pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="fixed top-[35%] right-[25%] w-[380px] h-[380px] rounded-full bg-indigo-600/10 blur-[130px] pointer-events-none" />

      {/* Live Canvas Particle and Candlestick Matrix */}
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 opacity-80" />

      {/* Top Market Ribbon (silent, themed) */}
      {showTicker && (
        <div className="relative z-20 w-full bg-[#0a0f1d]/90 backdrop-blur-md border-b border-[#1f293d] py-1.5 px-4 overflow-hidden">
          <div className="flex items-center gap-6 text-[11px] font-mono overflow-x-auto whitespace-nowrap no-scrollbar">
            <div className="flex items-center gap-1.5 text-gray-400 font-bold uppercase tracking-wider pl-2 flex-shrink-0">
              <span>Market</span>
            </div>
            {DEFAULT_SYMBOLS.map((s, idx) => {
              const q = tickerData[s.symbol.toUpperCase()] || tickerData[s.symbol.replace('.NS', '')];
              const price = q?.price;
              const chg = q?.change ?? 0;
              const pct = q?.change_pct ?? 0;
              const bull = pct >= 0;
              const curSym = q?.currency_symbol || '₹';

              return (
                <div key={idx} className="flex items-center gap-2 flex-shrink-0 transition-colors duration-300">
                  <span className="text-gray-300 font-semibold">{s.display}</span>
                  {price !== undefined && price !== null && price > 0 ? (
                    <>
                      <span className="text-white font-mono">{curSym}{fmt(price)}</span>
                      <span className={bull ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                        {fmtChange(chg)} ({fmtPct(pct)}) {bull ? '▲' : '▼'}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-500 italic text-[10px]">fetching real-time…</span>
                  )}
                  <span className="text-gray-700 ml-2">•</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
