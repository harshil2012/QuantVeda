import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { STOCKS } from '../lib/mock';
import { api, fmt, fmtChange, fmtPct, subscribePriceWs, type Candle, type JevPredictionData } from '../lib/api';

interface Props {
  symbol: string;
  onOpenOrder: (s: string, side: 'BUY' | 'SELL') => void;
  theme: string;
}

const TIMEFRAMES: { id: string; label: string; interval: string; range: string; desc: string }[] = [
  { id: '1m', label: '1m', interval: '1m', range: '1d', desc: '1-Minute' },
  { id: '5m', label: '5m', interval: '5m', range: '5d', desc: '5-Minute' },
  { id: '15m', label: '15m', interval: '15m', range: '1mo', desc: '15-Minute' },
  { id: '30m', label: '30m', interval: '30m', range: '1mo', desc: '30-Minute' },
  { id: '1H', label: '1H', interval: '60m', range: '3mo', desc: '1-Hour' },
  { id: '4H', label: '4H', interval: '60m', range: '6mo', desc: '4-Hour' },
  { id: '1D', label: '1D', interval: '1d', range: '2y', desc: 'Daily' },
  { id: '1W', label: '1W', interval: '1wk', range: '5y', desc: 'Weekly' },
  { id: '1M', label: '1M', interval: '1mo', range: '10y', desc: 'Monthly' },
];

const CHART_TYPES = [
  { id: 'Candles', label: 'Candlesticks', icon: 'candlestick_chart' },
  { id: 'Heikin-Ashi', label: 'Heikin-Ashi', icon: 'ssid_chart' },
  { id: 'Bars', label: 'OHLC Bars', icon: 'waterfall_chart' },
  { id: 'Line', label: 'Line Chart', icon: 'show_chart' },
  { id: 'Area', label: 'Area Chart', icon: 'area_chart' },
];

const POPULAR_INDIAN_STOCKS = [
  { symbol: 'RELIANCE.NS', label: 'RELIANCE' },
  { symbol: 'TCS.NS', label: 'TCS' },
  { symbol: 'INFY.NS', label: 'INFY' },
  { symbol: 'HDFCBANK.NS', label: 'HDFCBANK' },
  { symbol: 'TATAMOTORS.NS', label: 'TATAMOTORS' },
  { symbol: 'SBIN.NS', label: 'SBIN' },
  { symbol: '^NSEI', label: 'NIFTY 50' },
];

interface FormattedCandle {
  rawTime: number;
  timeLabel: string;
  fullTimeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isBull: boolean;
  sma20?: number;
  ema9?: number;
  haOpen?: number;
  haHigh?: number;
  haLow?: number;
  haClose?: number;
}

// Persistent module-level cache so chart data survives view toggling with 0ms delay
const globalCandleCache = new Map<string, FormattedCandle[]>();
const globalJevCache = new Map<string, JevPredictionData>();

export default function Charts({ symbol: initialSymbol, onOpenOrder, theme }: Props) {
  const defaultSym = initialSymbol || 'RELIANCE.NS';
  const [activeSymbol, setActiveSymbol] = useState(defaultSym);
  const [intervalId, setIntervalId] = useState('1D');
  const [selectedRange, setSelectedRange] = useState('6M');
  const [chartType, setChartType] = useState('Candles');
  const [showDropC, setShowDropC] = useState(false);

  // Initialize with cached data immediately on frame 0
  const initKey = `${defaultSym}_1d_6mo`;
  const [candles, setCandles] = useState<FormattedCandle[]>(() => globalCandleCache.get(initKey) || []);
  const [loading, setLoading] = useState(() => (globalCandleCache.get(initKey)?.length || 0) === 0);

  // Interactive Pan & Zoom state to view older historical candles
  const [visibleCount, setVisibleCount] = useState(60);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPanRef = useRef(0);

  // Live real-time price & market state
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChg, setLiveChg] = useState<number | null>(null);
  const [liveChgPct, setLiveChgPct] = useState<number | null>(null);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean | null>(null);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);
  const [tickFlash, setTickFlash] = useState<'up' | 'down' | null>(null);

  // Crosshair & mouse hover
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [indicators, setIndicators] = useState<string[]>(['sma', 'volume']);
  const [showIndicators, setShowIndicators] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // TypeSafe AI Jev™ Model Prediction State
  const [jevData, setJevData] = useState<JevPredictionData | null>(() => globalJevCache.get(defaultSym) || null);
  const [jevLoading, setJevLoading] = useState(false);
  const [showJevPanel, setShowJevPanel] = useState(true);
  const [showJevLines, setShowJevLines] = useState(true);
  const [showJevModal, setShowJevModal] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 850, height: 480 });
  const prevPriceRef = useRef<number | null>(null);
  const mouseMoveRafRef = useRef<number | null>(null);

  const dark = theme !== 'light';

  useEffect(() => {
    if (initialSymbol) {
      setActiveSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  const stock = STOCKS.find(s => s.symbol.toUpperCase() === activeSymbol.toUpperCase()) || {
    symbol: activeSymbol,
    name: activeSymbol.replace('.NS', '').replace('.BO', ''),
    exchange: activeSymbol.includes('.BO') ? 'BSE' : 'NSE',
    sector: 'Indian Equities',
  };

  const activeTf = useMemo(() => {
    return TIMEFRAMES.find(t => t.id === intervalId) || TIMEFRAMES[6];
  }, [intervalId]);

  // Responsive chart sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fullscreen toggle
  const toggleFullScreen = () => {
    const target = chartWrapperRef.current;
    if (!target) return;
    if (!document.fullscreenElement) {
      target.requestFullscreen().then(() => setIsFullScreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullScreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Format timestamp according to candle interval
  const formatTime = useCallback((epochSec: number, tfId: string) => {
    const d = new Date(epochSec * 1000);
    if (tfId === '1m' || tfId === '5m' || tfId === '15m' || tfId === '30m') {
      const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const fullStr = `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${timeStr}`;
      return { short: timeStr, full: fullStr };
    }
    if (tfId === '1H' || tfId === '4H') {
      const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
      return { short: `${dateStr} ${timeStr}`, full: `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ${timeStr}` };
    }
    if (tfId === '1D') {
      const short = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const full = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      return { short, full };
    }
    if (tfId === '1W') {
      const short = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
      const full = `Week of ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
      return { short, full };
    }
    const short = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    const full = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { short, full };
  }, []);

  // Real-Time Price Monitoring & Micro-Ticks
  useEffect(() => {
    let cancelled = false;
    prevPriceRef.current = null;

    const fetchPrice = async () => {
      try {
        const res = await api.quote(activeSymbol);
        if (cancelled || !res?.data) return;
        const fresh = res.data;
        if (fresh.is_market_open !== undefined) {
          setIsMarketOpen(fresh.is_market_open);
          setMarketStatus(fresh.market_status || (fresh.is_market_open ? 'MARKET OPEN' : 'MARKET CLOSED'));
        }
        if (fresh.price !== undefined) {
          // Only animate tick flash when the market is open
          if (fresh.is_market_open !== false && prevPriceRef.current !== null && fresh.price !== prevPriceRef.current) {
            setTickFlash(fresh.price > prevPriceRef.current ? 'up' : 'down');
            setTimeout(() => setTickFlash(null), 400);
          }
          prevPriceRef.current = fresh.price;
          setLivePrice(fresh.price);
          setLiveChg(fresh.change ?? null);
          setLiveChgPct(fresh.change_pct ?? null);
        }
      } catch {
        // silent retry
      }
    };

    fetchPrice();
    const intervalTimer = setInterval(fetchPrice, 1500);

    const unsubWs = subscribePriceWs(activeSymbol, payload => {
      if (cancelled || !payload || payload.price === undefined) return;
      if (payload.is_market_open !== undefined) {
        setIsMarketOpen(payload.is_market_open);
        setMarketStatus(payload.market_status || (payload.is_market_open ? 'MARKET OPEN' : 'MARKET CLOSED'));
      }
      // Only animate tick flash when the market is open
      if (payload.is_market_open !== false && prevPriceRef.current !== null && payload.price !== prevPriceRef.current) {
        setTickFlash(payload.price > prevPriceRef.current ? 'up' : 'down');
        setTimeout(() => setTickFlash(null), 400);
      }
      prevPriceRef.current = payload.price;
      setLivePrice(payload.price);
      if (payload.change !== undefined) setLiveChg(payload.change);
      if (payload.change_pct !== undefined) setLiveChgPct(payload.change_pct);
    });

    return () => {
      cancelled = true;
      clearInterval(intervalTimer);
      unsubWs();
    };
  }, [activeSymbol]);

  // Load TypeSafe Jev™ Model Prediction
  useEffect(() => {
    let cancelled = false;
    setJevLoading(true);

    api.jevPrediction(activeSymbol)
      .then(res => {
        if (!cancelled && res?.data) {
          globalJevCache.set(activeSymbol, res.data);
          setJevData(res.data);
        }
      })
      .catch(() => {
        // Fallback
      })
      .finally(() => {
        if (!cancelled) setJevLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSymbol]);

  // Global mouseup listener for smooth drag release anywhere
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleRangeSelect = (rangeId: string) => {
    setSelectedRange(rangeId);
    setPanOffset(0);
    if (rangeId === '1D') {
      setIntervalId('5m');
      setVisibleCount(78);
    } else if (rangeId === '5D') {
      setIntervalId('15m');
      setVisibleCount(100);
    } else if (rangeId === '1M') {
      setIntervalId('30m');
      setVisibleCount(100);
    } else if (rangeId === '3M') {
      setIntervalId('1H');
      setVisibleCount(120);
    } else if (rangeId === '6M') {
      setIntervalId('1D');
      setVisibleCount(120);
    } else if (rangeId === '1Y') {
      setIntervalId('1D');
      setVisibleCount(250);
    } else if (rangeId === '5Y') {
      setIntervalId('1W');
      setVisibleCount(260);
    } else if (rangeId === 'ALL') {
      setIntervalId('1M');
      setVisibleCount(200);
    }
  };

  // Fetch Candlestick Data via Fast In-Memory Backend with Instant Client Cache
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${activeSymbol}_${activeTf.interval}_${activeTf.range}`;
    const cached = globalCandleCache.get(cacheKey);

    // If previously loaded, display immediately (0ms delay, zero screen blanking)
    if (cached && cached.length > 0) {
      setCandles(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    api.candles(activeSymbol, activeTf.interval, activeTf.range)
      .then(res => {
        if (cancelled) return;
        const raw = res?.data?.candles;
        if (raw && Array.isArray(raw) && raw.length > 0) {
          const processed: FormattedCandle[] = raw.map((k: Candle) => {
            const times = formatTime(k.time, activeTf.id);
            return {
              rawTime: k.time,
              timeLabel: times.short,
              fullTimeLabel: times.full,
              open: Number(k.open),
              high: Number(k.high),
              low: Number(k.low),
              close: Number(k.close),
              volume: Number(k.volume || 0),
              isBull: Number(k.close) >= Number(k.open),
            };
          });

          // Calculate SMA(20) and EMA(9)
          for (let i = 0; i < processed.length; i++) {
            if (i >= 19) {
              const sum = processed.slice(i - 19, i + 1).reduce((acc, c) => acc + c.close, 0);
              processed[i].sma20 = round2(sum / 20);
            }
            if (i === 0) {
              processed[i].ema9 = processed[i].close;
            } else {
              const k = 2 / (9 + 1);
              const prev = processed[i - 1].ema9 ?? processed[i - 1].close;
              processed[i].ema9 = round2(processed[i].close * k + prev * (1 - k));
            }
          }

          // Calculate Heikin-Ashi
          for (let i = 0; i < processed.length; i++) {
            const cur = processed[i];
            const haClose = (cur.open + cur.high + cur.low + cur.close) / 4;
            let haOpen = cur.open;
            if (i > 0) {
              const prev = processed[i - 1];
              haOpen = ((prev.haOpen ?? prev.open) + (prev.haClose ?? prev.close)) / 2;
            }
            const haHigh = Math.max(cur.high, haOpen, haClose);
            const haLow = Math.min(cur.low, haOpen, haClose);
            processed[i].haOpen = round2(haOpen);
            processed[i].haClose = round2(haClose);
            processed[i].haHigh = round2(haHigh);
            processed[i].haLow = round2(haLow);
          }

          globalCandleCache.set(cacheKey, processed);
          setCandles(processed);
        } else if (!cached) {
          setCandles([]);
        }
      })
      .catch(() => {
        if (!cancelled && !cached) setCandles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSymbol, activeTf, formatTime]);

  // Synchronize live price into the active candle only during official trading hours
  useEffect(() => {
    if (isMarketOpen === false) return; // Never distort historical candles when market is closed
    if (livePrice === null || candles.length === 0) return;
    setCandles(prev => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = { ...next[next.length - 1] };
      last.close = livePrice;
      last.high = Math.max(last.high, livePrice);
      last.low = Math.min(last.low, livePrice);
      last.isBull = last.close >= last.open;
      next[next.length - 1] = last;
      return next;
    });
  }, [livePrice, isMarketOpen]);

  const bull = (liveChg ?? 0) >= 0;

  // Calculate visible slice based on visibleCount and panOffset (view older historical data)
  const { visibleCandles } = useMemo(() => {
    const total = candles.length;
    if (total === 0) return { visibleCandles: [] };
    const effectiveCount = Math.min(total, Math.max(15, visibleCount));
    const maxOffset = Math.max(0, total - effectiveCount);
    const clampedOffset = Math.min(maxOffset, Math.max(0, panOffset));
    const end = total - clampedOffset;
    const start = Math.max(0, end - effectiveCount);
    return {
      visibleCandles: candles.slice(start, end),
    };
  }, [candles, visibleCount, panOffset]);

  // Chart dimensions & coordinates calculation
  const chartW = dimensions.width;
  const chartH = dimensions.height;
  const chartPadding = { top: 20, right: 80, bottom: 65, left: 16 };
  const plotW = Math.max(50, chartW - chartPadding.left - chartPadding.right);
  const plotH = Math.max(50, chartH - chartPadding.top - chartPadding.bottom);

  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (visibleCandles.length === 0) return { minPrice: 0, maxPrice: 100, maxVolume: 1000 };
    let mn = Infinity;
    let mx = -Infinity;
    let mxV = 0;
    for (const c of visibleCandles) {
      const lo = chartType === 'Heikin-Ashi' ? (c.haLow ?? c.low) : c.low;
      const hi = chartType === 'Heikin-Ashi' ? (c.haHigh ?? c.high) : c.high;
      if (lo < mn) mn = lo;
      if (hi > mx) mx = hi;
      if (c.volume > mxV) mxV = c.volume;
    }
    // Include live price if viewing recent candles
    if (livePrice !== null && panOffset <= 5) {
      if (livePrice < mn) mn = livePrice;
      if (livePrice > mx) mx = livePrice;
    }
    // Include Jev Target, Stop Loss, and Predicted Close Price within reasonable bounds
    if (jevData && showJevLines && (livePrice || visibleCandles.length > 0)) {
      const anchor = livePrice || visibleCandles[visibleCandles.length - 1].close;
      if (jevData.target_price && Math.abs(jevData.target_price - anchor) < anchor * 0.35) {
        if (jevData.target_price > mx) mx = jevData.target_price;
        if (jevData.target_price < mn) mn = jevData.target_price;
      }
      if (jevData.stop_loss_price && Math.abs(jevData.stop_loss_price - anchor) < anchor * 0.35) {
        if (jevData.stop_loss_price > mx) mx = jevData.stop_loss_price;
        if (jevData.stop_loss_price < mn) mn = jevData.stop_loss_price;
      }
      if (jevData.predicted_close_price && Math.abs(jevData.predicted_close_price - anchor) < anchor * 0.35) {
        if (jevData.predicted_close_price > mx) mx = jevData.predicted_close_price;
        if (jevData.predicted_close_price < mn) mn = jevData.predicted_close_price;
      }
    }
    const pad = (mx - mn) * 0.06 || 1;
    return { minPrice: mn - pad, maxPrice: mx + pad, maxVolume: mxV || 1000 };
  }, [visibleCandles, chartType, livePrice, panOffset, jevData, showJevLines]);

  const priceToY = useCallback((p: number) => {
    if (maxPrice <= minPrice) return plotH / 2 + chartPadding.top;
    return chartPadding.top + plotH - ((p - minPrice) / (maxPrice - minPrice)) * plotH;
  }, [minPrice, maxPrice, plotH, chartPadding.top]);

  const yToPrice = useCallback((y: number) => {
    const norm = (chartPadding.top + plotH - y) / plotH;
    return minPrice + norm * (maxPrice - minPrice);
  }, [minPrice, maxPrice, plotH, chartPadding.top]);

  const candleCount = visibleCandles.length;
  const candleStep = candleCount > 0 ? plotW / candleCount : 10;
  const candleWidth = Math.max(2, Math.min(22, candleStep * 0.72));

  // Current active / hovered candle info
  const activeCandle = hoveredIdx !== null && hoveredIdx < visibleCandles.length
    ? visibleCandles[hoveredIdx]
    : visibleCandles[visibleCandles.length - 1];

  // Path generators for Line & Area
  const linePath = useMemo(() => {
    if (visibleCandles.length === 0) return '';
    return visibleCandles.reduce((acc, c, idx) => {
      const x = chartPadding.left + (idx + 0.5) * candleStep;
      const y = priceToY(c.close);
      return idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, '');
  }, [visibleCandles, candleStep, chartPadding.left, priceToY]);

  const areaPath = useMemo(() => {
    if (visibleCandles.length === 0 || !linePath) return '';
    const firstX = chartPadding.left + 0.5 * candleStep;
    const lastX = chartPadding.left + (visibleCandles.length - 0.5) * candleStep;
    const bottomY = chartPadding.top + plotH;
    return `${linePath} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`;
  }, [linePath, visibleCandles.length, candleStep, chartPadding, plotH]);

  const smaPath = useMemo(() => {
    if (!indicators.includes('sma')) return '';
    let p = '';
    visibleCandles.forEach((c, idx) => {
      if (c.sma20 === undefined) return;
      const x = chartPadding.left + (idx + 0.5) * candleStep;
      const y = priceToY(c.sma20);
      if (!p) p += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      else p += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return p;
  }, [visibleCandles, indicators, candleStep, chartPadding.left, priceToY]);

  const emaPath = useMemo(() => {
    if (!indicators.includes('ema')) return '';
    let p = '';
    visibleCandles.forEach((c, idx) => {
      if (c.ema9 === undefined) return;
      const x = chartPadding.left + (idx + 0.5) * candleStep;
      const y = priceToY(c.ema9);
      if (!p) p += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      else p += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return p;
  }, [visibleCandles, indicators, candleStep, chartPadding.left, priceToY]);

  // Drag to pan horizontally into older historical charts
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartPanRef.current = panOffset;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingRef.current) {
      const deltaX = e.clientX - dragStartXRef.current;
      const candleShift = Math.round(deltaX / Math.max(3, candleStep));
      const maxOffset = Math.max(0, candles.length - visibleCount);
      const newOffset = Math.max(0, Math.min(maxOffset, dragStartPanRef.current + candleShift));
      setPanOffset(newOffset);
      return;
    }

    if (mouseMoveRafRef.current !== null) {
      cancelAnimationFrame(mouseMoveRafRef.current);
    }
    mouseMoveRafRef.current = requestAnimationFrame(() => {
      setMousePos({ x: mouseX, y: mouseY });

      const relX = mouseX - chartPadding.left;
      if (relX >= 0 && relX <= plotW) {
        const idx = Math.floor(relX / candleStep);
        if (idx >= 0 && idx < visibleCandles.length) {
          setHoveredIdx(idx);
        }
      }
    });
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
    }
  };

  const handleMouseLeave = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
    }
    setHoveredIdx(null);
    setMousePos(null);
  };

  // Scroll wheel to zoom in / zoom out
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 6 : -6;
    setVisibleCount(prev => Math.min(Math.max(15, prev + zoomDelta), Math.max(candles.length, 300)));
  };

  const priceGridCount = 6;
  const priceGridLevels = Array.from({ length: priceGridCount }, (_, i) => {
    const p = minPrice + (maxPrice - minPrice) * (i / (priceGridCount - 1));
    return { price: p, y: priceToY(p) };
  });

  const timeStepInterval = Math.max(1, Math.floor(visibleCandles.length / 7));
  const timeGridTicks = visibleCandles.filter((_, idx) => idx % timeStepInterval === 0 || idx === visibleCandles.length - 1);

  return (
    <div
      ref={chartWrapperRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        background: 'var(--qv-bg)',
        height: '100%',
        width: '100%',
        userSelect: 'none',
      }}>
      {/* 1. Professional Header Toolbar */}
      <div style={{
        background: 'var(--qv-card)',
        borderBottom: '1px solid var(--qv-border)',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 52,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* Symbol & Live Price in INR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 800, color: 'var(--qv-text)' }}>
            {activeSymbol.replace('.NS', '').replace('.BO', '')}
          </span>
          <span style={{ fontSize: 10, color: 'var(--qv-text3)', background: 'var(--qv-bg2)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
            {stock.exchange}
          </span>

          {/* Live price silent */}
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--qv-text)',
          }}>
            {livePrice !== null ? `₹${fmt(livePrice)}` : <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>—</span>}
          </span>

          {liveChgPct !== null && (
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: bull ? 'var(--qv-bull)' : 'var(--qv-bear)', fontWeight: 600 }}>
              {fmtChange(liveChg)} ({fmtPct(liveChgPct)})
            </span>
          )}

          {/* Market Open / Closed Status Badge */}
          {isMarketOpen !== null && (
            <span style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              background: isMarketOpen ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.12)',
              color: isMarketOpen ? '#10b981' : '#94a3b8',
              border: `1px solid ${isMarketOpen ? 'rgba(16,185,129,0.25)' : 'rgba(148,163,184,0.25)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4
            }}>
              <span style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: isMarketOpen ? '#10b981' : '#94a3b8'
              }} />
              {marketStatus || (isMarketOpen ? 'MARKET OPEN' : 'MARKET CLOSED')}
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--qv-border)' }} />

        {/* Indian Market Symbol Switchers */}
        <div className="hidden lg:flex items-center gap-1.5">
          {POPULAR_INDIAN_STOCKS.map(item => {
            const isCur = activeSymbol.toUpperCase() === item.symbol.toUpperCase();
            return (
              <button
                key={item.symbol}
                onClick={() => setActiveSymbol(item.symbol)}
                style={{
                  background: isCur ? 'var(--qv-bg2)' : 'transparent',
                  color: isCur ? 'var(--qv-accent)' : 'var(--qv-text3)',
                  border: isCur ? '1px solid var(--qv-accent)' : '1px solid transparent',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: isCur ? 700 : 500,
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  transition: 'all 0.15s ease',
                }}>
                {item.label}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--qv-border)' }} />

        {/* Timeframe Interval Selector */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {TIMEFRAMES.map(tf => {
            const isActive = intervalId === tf.id;
            return (
              <button
                key={tf.id}
                onClick={() => setIntervalId(tf.id)}
                title={tf.desc}
                style={{
                  background: isActive ? 'var(--qv-accent)' : 'transparent',
                  color: isActive ? 'white' : 'var(--qv-text2)',
                  border: isActive ? '1px solid var(--qv-accent)' : '1px solid transparent',
                  borderRadius: 6,
                  padding: '3px 7px',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  transition: 'all 0.15s ease',
                }}>
                {tf.label}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--qv-border)' }} />

        {/* Chart Style Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowDropC(!showDropC)}
            style={{
              background: 'var(--qv-bg2)',
              border: '1px solid var(--qv-border)',
              color: 'var(--qv-text)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--qv-accent)' }}>
              {CHART_TYPES.find(c => c.id === chartType)?.icon || 'candlestick_chart'}
            </span>
            <span>{chartType}</span>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--qv-text3)' }}>arrow_drop_down</span>
          </button>
          {showDropC && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              background: 'var(--qv-card)',
              border: '1px solid var(--qv-border)',
              borderRadius: 8,
              zIndex: 50,
              minWidth: 150,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              padding: 4,
            }}>
              {CHART_TYPES.map(st => (
                <button
                  key={st.id}
                  onClick={() => { setChartType(st.id); setShowDropC(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 12,
                    background: chartType === st.id ? 'var(--qv-bg2)' : 'none',
                    color: chartType === st.id ? 'var(--qv-accent)' : 'var(--qv-text)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontWeight: chartType === st.id ? 700 : 400,
                  }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{st.icon}</span>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Technical Indicators Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowIndicators(!showIndicators)}
            style={{
              background: indicators.length ? 'var(--qv-accent-dim)' : 'var(--qv-bg2)',
              border: '1px solid var(--qv-border)',
              color: indicators.length ? 'var(--qv-accent)' : 'var(--qv-text2)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>timeline</span>
            <span>Indicators ({indicators.length})</span>
          </button>
          {showIndicators && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              background: 'var(--qv-card)',
              border: '1px solid var(--qv-border)',
              borderRadius: 8,
              zIndex: 50,
              minWidth: 150,
              padding: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {[
                { id: 'volume', label: 'Volume Bars', color: '#10b981' },
                { id: 'sma', label: 'SMA(20)', color: '#f59e0b' },
                { id: 'ema', label: 'EMA(9)', color: '#a855f7' },
              ].map(ind => (
                <label key={ind.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12, color: 'var(--qv-text)', cursor: 'pointer', borderRadius: 4 }}>
                  <input
                    type="checkbox"
                    checked={indicators.includes(ind.id)}
                    onChange={e => {
                      if (e.target.checked) setIndicators(prev => [...prev, ind.id]);
                      else setIndicators(prev => prev.filter(x => x !== ind.id));
                    }}
                  />
                  <span style={{ color: ind.color, fontWeight: 600 }}>{ind.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* TypeSafe Jev™ Model Toggle */}
        <button
          onClick={() => setShowJevPanel(!showJevPanel)}
          title="Toggle TypeSafe Jev™ System One Prediction Matrix"
          style={{
            background: showJevPanel ? 'rgba(99, 102, 241, 0.18)' : 'var(--qv-bg2)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            color: '#818cf8',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>psychology</span>
          Jev™ Model
        </button>

        {/* Toggle Jev Prediction Target & Stop Loss Lines */}
        <button
          onClick={() => setShowJevLines(!showJevLines)}
          title="Toggle Jev Target & Stop Loss Lines directly on chart"
          style={{
            background: showJevLines ? 'rgba(16, 185, 129, 0.14)' : 'var(--qv-bg2)',
            border: `1px solid ${showJevLines ? 'rgba(16, 185, 129, 0.4)' : 'var(--qv-border)'}`,
            color: showJevLines ? '#10b981' : 'var(--qv-text3)',
            borderRadius: 6,
            padding: '4px 9px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>track_changes</span>
          Target Lines {showJevLines ? 'ON' : 'OFF'}
        </button>

        {/* Right Action buttons */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={toggleFullScreen}
            title={isFullScreen ? 'Exit Fullscreen' : 'Expand Fullscreen Chart'}
            style={{
              background: 'var(--qv-bg2)',
              border: '1px solid var(--qv-border)',
              color: 'var(--qv-text)',
              borderRadius: 6,
              padding: '6px 9px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {isFullScreen ? 'fullscreen_exit' : 'fullscreen'}
            </span>
          </button>

          <button onClick={() => onOpenOrder(activeSymbol, 'BUY')}
            style={{ background: 'var(--qv-bull)', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            BUY
          </button>
          <button onClick={() => onOpenOrder(activeSymbol, 'SELL')}
            style={{ background: 'var(--qv-bear)', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            SELL
          </button>
        </div>
      </div>

      {/* 2. Top-Left Heads-Up Display (HUD) */}
      <div style={{
        background: 'var(--qv-bg2)',
        borderBottom: '1px solid var(--qv-border)',
        padding: '5px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--qv-text3)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}>
        {activeCandle ? (
          <>
            <span style={{ color: 'var(--qv-text)', fontWeight: 600 }}>{activeCandle.fullTimeLabel}</span>
            <span>
              O: <strong style={{ color: 'var(--qv-text)' }}>₹{fmt(chartType === 'Heikin-Ashi' ? (activeCandle.haOpen ?? activeCandle.open) : activeCandle.open)}</strong>
            </span>
            <span>
              H: <strong style={{ color: '#10b981' }}>₹{fmt(chartType === 'Heikin-Ashi' ? (activeCandle.haHigh ?? activeCandle.high) : activeCandle.high)}</strong>
            </span>
            <span>
              L: <strong style={{ color: '#ef4444' }}>₹{fmt(chartType === 'Heikin-Ashi' ? (activeCandle.haLow ?? activeCandle.low) : activeCandle.low)}</strong>
            </span>
            <span>
              C: <strong style={{ color: activeCandle.isBull ? '#10b981' : '#ef4444' }}>
                ₹{fmt(chartType === 'Heikin-Ashi' ? (activeCandle.haClose ?? activeCandle.close) : activeCandle.close)}
              </strong>
            </span>
            <span>
              Vol: <strong style={{ color: 'var(--qv-text)' }}>{activeCandle.volume.toLocaleString('en-IN')}</strong>
            </span>
            {indicators.includes('sma') && activeCandle.sma20 && (
              <span style={{ color: '#f59e0b' }}>
                SMA(20): <strong>₹{fmt(activeCandle.sma20)}</strong>
              </span>
            )}
            {indicators.includes('ema') && activeCandle.ema9 && (
              <span style={{ color: '#a855f7' }}>
                EMA(9): <strong>₹{fmt(activeCandle.ema9)}</strong>
              </span>
            )}
            {jevData?.predicted_close_price && (
              <span style={{ color: '#06b6d4', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span>🔮 Pred Close:</span>
                <strong style={{ color: '#06b6d4' }}>₹{fmt(jevData.predicted_close_price)}</strong>
                <span style={{ fontSize: 9.5 }}>
                  ({(jevData.predicted_close_pct ?? 0) >= 0 ? '+' : ''}{jevData.predicted_close_pct}%)
                </span>
              </span>
            )}
          </>
        ) : (
          <span>Streaming live exchange candles…</span>
        )}
      </div>

      {/* 3. TypeSafe Jev™ Model System One Prediction Matrix Panel */}
      {showJevPanel && jevData && (
        <div style={{
          background: dark ? '#0f1422' : '#f0f4ff',
          borderBottom: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: 'white',
              fontSize: 9.5,
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: 0.5,
            }}>
              JEV™ SYSTEM ONE
            </span>
            <span style={{
              background: jevData.action.includes('BUY') ? 'rgba(16,185,129,0.15)' : jevData.action.includes('SELL') ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
              color: jevData.action.includes('BUY') ? '#10b981' : jevData.action.includes('SELL') ? '#ef4444' : '#94a3b8',
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: 11,
            }}>
              {jevData.action}
            </span>
          </div>

          <div>
            <span style={{ color: 'var(--qv-text3)' }}>Confidence: </span>
            <strong style={{ color: '#818cf8' }}>{jevData.confidence_display}</strong>
            <span style={{ color: 'var(--qv-text3)' }}> ({jevData.conviction_pct}%)</span>
          </div>

          <div>
            <span style={{ color: 'var(--qv-text3)' }}>Trap Risk: </span>
            <strong style={{ color: jevData.trap_risk_pct < 25 ? '#10b981' : '#f59e0b' }}>
              {jevData.trap_risk_pct}% ({jevData.trap_risk_label})
            </strong>
          </div>

          <div>
            <span style={{ color: 'var(--qv-text3)' }}>Target: </span>
            <strong style={{ color: '#10b981' }}>₹{fmt(jevData.target_price)}</strong>
            <span style={{ color: '#10b981', fontSize: 10 }}> ({jevData.target_pct > 0 ? `+${jevData.target_pct}%` : `${jevData.target_pct}%`})</span>
          </div>

          <div>
            <span style={{ color: 'var(--qv-text3)' }}>Stop Loss: </span>
            <strong style={{ color: '#ef4444' }}>₹{fmt(jevData.stop_loss_price)}</strong>
          </div>

          {jevData.predicted_close_price && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--qv-text3)' }}>Pred Close: </span>
              <strong style={{ color: '#06b6d4' }}>₹{fmt(jevData.predicted_close_price)}</strong>
              <span style={{ color: '#06b6d4', fontSize: 10 }}>
                ({(jevData.predicted_close_pct ?? 0) >= 0 ? `+${jevData.predicted_close_pct}%` : `${jevData.predicted_close_pct}%`})
              </span>
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setShowJevModal(true)}
              style={{
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                color: '#818cf8',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>insights</span>
              Jev Analysis
            </button>
            <button
              onClick={() => onOpenOrder(activeSymbol, jevData.action.includes('SELL') ? 'SELL' : 'BUY')}
              style={{
                background: jevData.action.includes('SELL') ? 'var(--qv-bear)' : 'var(--qv-bull)',
                color: 'white',
                border: 'none',
                borderRadius: 5,
                padding: '4px 10px',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>bolt</span>
              Trade Jev ({jevData.action.includes('SELL') ? 'SELL' : 'BUY'})
            </button>
          </div>
        </div>
      )}

      {/* 4. Main Native SVG Financial Chart Engine */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading && candles.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--qv-bg)' }}>
            <div className="flex items-center gap-3 text-sm text-gray-400 font-mono">
              <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              Loading real-time candlestick series…
            </div>
          </div>
        ) : candles.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--qv-bg)', color: 'var(--qv-text3)' }}>
            No exchange candle data available for this timeframe.
          </div>
        ) : (
          <>
            {loading && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 2.5,
                background: 'linear-gradient(90deg, #6366f1, #10b981, #6366f1)',
                zIndex: 20
              }} />
            )}
            <svg
              width={chartW}
              height={chartH}
              style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'crosshair', userSelect: 'none' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onWheel={handleWheel}>
            <defs>
              <linearGradient id="areaGradNative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--qv-accent)" stopOpacity={0.25} />
                <stop offset="90%" stopColor="var(--qv-accent)" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            {/* Horizontal price grid lines & labels */}
            {priceGridLevels.map((lvl, i) => (
              <g key={i}>
                <line
                  x1={chartPadding.left}
                  y1={lvl.y}
                  x2={chartW - chartPadding.right}
                  y2={lvl.y}
                  stroke={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
                  strokeDasharray="3 3"
                />
                <text
                  x={chartW - chartPadding.right + 8}
                  y={lvl.y + 4}
                  fill="var(--qv-text3)"
                  fontSize={10}
                  fontFamily="JetBrains Mono, monospace">
                  ₹{fmt(lvl.price, 1)}
                </text>
              </g>
            ))}

            {/* Vertical time grid ticks */}
            {timeGridTicks.map((c, i) => {
              const idx = visibleCandles.indexOf(c);
              const x = chartPadding.left + (idx + 0.5) * candleStep;
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={chartPadding.top}
                    x2={x}
                    y2={chartPadding.top + plotH}
                    stroke={dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}
                    strokeDasharray="2 4"
                  />
                  <text
                    x={x}
                    y={chartPadding.top + plotH + 20}
                    textAnchor="middle"
                    fill="var(--qv-text3)"
                    fontSize={9.5}
                    fontFamily="JetBrains Mono, monospace">
                    {c.timeLabel}
                  </text>
                </g>
              );
            })}

            {/* Volume Histogram (bottom 20%) */}
            {indicators.includes('volume') && visibleCandles.map((c, idx) => {
              const x = chartPadding.left + idx * candleStep + (candleStep - candleWidth) / 2;
              const volH = Math.max(2, (c.volume / maxVolume) * 45);
              const volY = chartPadding.top + plotH - volH;
              return (
                <rect
                  key={`vol-${idx}`}
                  x={x}
                  y={volY}
                  width={candleWidth}
                  height={volH}
                  fill={c.isBull ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}
                  rx={1}
                />
              );
            })}

            {/* Area Chart Mode */}
            {chartType === 'Area' && (
              <>
                <path d={areaPath} fill="url(#areaGradNative)" />
                <path d={linePath} fill="none" stroke="var(--qv-accent)" strokeWidth={2} />
              </>
            )}

            {/* Line Chart Mode */}
            {chartType === 'Line' && (
              <path d={linePath} fill="none" stroke="var(--qv-accent)" strokeWidth={2} />
            )}

            {/* Candlesticks & Heikin-Ashi Modes */}
            {(chartType === 'Candles' || chartType === 'Heikin-Ashi') && (
              visibleCandles.map((c, idx) => {
                const o = chartType === 'Heikin-Ashi' ? (c.haOpen ?? c.open) : c.open;
                const h = chartType === 'Heikin-Ashi' ? (c.haHigh ?? c.high) : c.high;
                const l = chartType === 'Heikin-Ashi' ? (c.haLow ?? c.low) : c.low;
                const cl = chartType === 'Heikin-Ashi' ? (c.haClose ?? c.close) : c.close;
                const isBull = cl >= o;

                const candleColor = isBull ? '#10b981' : '#ef4444';
                const centerX = chartPadding.left + (idx + 0.5) * candleStep;
                const bodyX = chartPadding.left + idx * candleStep + (candleStep - candleWidth) / 2;

                const yHigh = priceToY(h);
                const yLow = priceToY(l);
                const yOpen = priceToY(o);
                const yClose = priceToY(cl);

                const bodyY = Math.min(yOpen, yClose);
                const bodyH = Math.max(2, Math.abs(yClose - yOpen));

                return (
                  <g key={`candle-${idx}`}>
                    <line
                      x1={centerX}
                      y1={yHigh}
                      x2={centerX}
                      y2={yLow}
                      stroke={candleColor}
                      strokeWidth={1.2}
                    />
                    <rect
                      x={bodyX}
                      y={bodyY}
                      width={candleWidth}
                      height={bodyH}
                      fill={candleColor}
                      stroke={candleColor}
                      strokeWidth={0.8}
                      rx={1}
                    />
                  </g>
                );
              })
            )}

            {/* OHLC Bars Mode */}
            {chartType === 'Bars' && (
              visibleCandles.map((c, idx) => {
                const isBull = c.close >= c.open;
                const barColor = isBull ? '#10b981' : '#ef4444';
                const centerX = chartPadding.left + (idx + 0.5) * candleStep;
                const yHigh = priceToY(c.high);
                const yLow = priceToY(c.low);
                const yOpen = priceToY(c.open);
                const yClose = priceToY(c.close);
                const tickW = candleWidth / 2;

                return (
                  <g key={`bar-${idx}`}>
                    <line x1={centerX} y1={yHigh} x2={centerX} y2={yLow} stroke={barColor} strokeWidth={1.5} />
                    <line x1={centerX - tickW} y1={yOpen} x2={centerX} y2={yOpen} stroke={barColor} strokeWidth={1.5} />
                    <line x1={centerX} y1={yClose} x2={centerX + tickW} y2={yClose} stroke={barColor} strokeWidth={1.5} />
                  </g>
                );
              })
            )}

            {/* SMA & EMA Overlay Lines */}
            {smaPath && <path d={smaPath} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />}
            {emaPath && <path d={emaPath} fill="none" stroke="#a855f7" strokeWidth={1.5} />}

            {/* Live Real-Time Price Line across entire chart */}
            {livePrice !== null && (
              <g>
                <line
                  x1={chartPadding.left}
                  y1={priceToY(livePrice)}
                  x2={chartW - chartPadding.right}
                  y2={priceToY(livePrice)}
                  stroke={tickFlash === 'up' ? '#10b981' : tickFlash === 'down' ? '#ef4444' : 'var(--qv-accent)'}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <rect
                  x={chartW - chartPadding.right + 2}
                  y={priceToY(livePrice) - 9}
                  width={72}
                  height={18}
                  fill={bull ? 'var(--qv-bull)' : 'var(--qv-bear)'}
                  rx={4}
                />
                <text
                  x={chartW - chartPadding.right + 38}
                  y={priceToY(livePrice) + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={10.5}
                  fontWeight="bold"
                  fontFamily="JetBrains Mono, monospace">
                  ₹{fmt(livePrice, 1)}
                </text>
              </g>
            )}

            {/* TypeSafe Jev™ Model System One Target, Stop Loss & Predicted Close Lines */}
            {jevData && showJevLines && (
              <g>
                {/* Jev Target Price Line (Emerald) */}
                <line
                  x1={chartPadding.left}
                  y1={priceToY(jevData.target_price)}
                  x2={chartW - chartPadding.right}
                  y2={priceToY(jevData.target_price)}
                  stroke="#10b981"
                  strokeWidth={1.8}
                  strokeDasharray="6 3"
                />
                <rect
                  x={chartW - chartPadding.right + 2}
                  y={priceToY(jevData.target_price) - 10}
                  width={76}
                  height={20}
                  fill="#10b981"
                  rx={4}
                />
                <text
                  x={chartW - chartPadding.right + 40}
                  y={priceToY(jevData.target_price) + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={9.5}
                  fontWeight="bold"
                  fontFamily="JetBrains Mono, monospace">
                  🎯 ₹{fmt(jevData.target_price, 0)}
                </text>

                {/* Jev Stop Loss Line (Rose/Red) */}
                <line
                  x1={chartPadding.left}
                  y1={priceToY(jevData.stop_loss_price)}
                  x2={chartW - chartPadding.right}
                  y2={priceToY(jevData.stop_loss_price)}
                  stroke="#ef4444"
                  strokeWidth={1.8}
                  strokeDasharray="6 3"
                />
                <rect
                  x={chartW - chartPadding.right + 2}
                  y={priceToY(jevData.stop_loss_price) - 10}
                  width={76}
                  height={20}
                  fill="#ef4444"
                  rx={4}
                />
                <text
                  x={chartW - chartPadding.right + 40}
                  y={priceToY(jevData.stop_loss_price) + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={9.5}
                  fontWeight="bold"
                  fontFamily="JetBrains Mono, monospace">
                  🛑 ₹{fmt(jevData.stop_loss_price, 0)}
                </text>

                {/* Jev Predicted Close Price Line (Cyan / Sky) */}
                {jevData.predicted_close_price && (
                  <g>
                    <line
                      x1={chartPadding.left}
                      y1={priceToY(jevData.predicted_close_price)}
                      x2={chartW - chartPadding.right}
                      y2={priceToY(jevData.predicted_close_price)}
                      stroke="#06b6d4"
                      strokeWidth={1.8}
                      strokeDasharray="4 4"
                    />
                    <rect
                      x={chartW - chartPadding.right + 2}
                      y={priceToY(jevData.predicted_close_price) - 10}
                      width={78}
                      height={20}
                      fill="#06b6d4"
                      rx={4}
                    />
                    <text
                      x={chartW - chartPadding.right + 41}
                      y={priceToY(jevData.predicted_close_price) + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={9.5}
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace">
                      🔮 ₹{fmt(jevData.predicted_close_price, 0)}
                    </text>
                  </g>
                )}

                {/* Shaded projection cone towards Jev Target */}
                {livePrice !== null && (
                  <polygon
                    points={`
                      ${chartPadding.left + (visibleCandles.length > 0 ? (visibleCandles.length - 1) * candleStep : 0)},${priceToY(livePrice)}
                      ${chartW - chartPadding.right},${priceToY(jevData.target_price)}
                      ${chartW - chartPadding.right},${priceToY(livePrice)}
                    `}
                    fill={jevData.action.includes('BUY') ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)'}
                  />
                )}
              </g>
            )}

            {/* Interactive Crosshair when hovering */}
            {mousePos && (
              <g>
                <line
                  x1={mousePos.x}
                  y1={chartPadding.top}
                  x2={mousePos.x}
                  y2={chartPadding.top + plotH}
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <line
                  x1={chartPadding.left}
                  y1={mousePos.y}
                  x2={chartW - chartPadding.right}
                  y2={mousePos.y}
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <rect
                  x={chartW - chartPadding.right + 2}
                  y={mousePos.y - 9}
                  width={72}
                  height={18}
                  fill="var(--qv-card)"
                  stroke="var(--qv-border)"
                  rx={4}
                />
                <text
                  x={chartW - chartPadding.right + 38}
                  y={mousePos.y + 4}
                  textAnchor="middle"
                  fill="var(--qv-text)"
                  fontSize={10}
                  fontFamily="JetBrains Mono, monospace">
                  ₹{fmt(yToPrice(mousePos.y), 1)}
                </text>
              </g>
            )}
          </svg>

          {/* Quick "Jump to Live" floating badge if user is viewing older candles */}
          {panOffset > 0 && (
            <button
              onClick={() => setPanOffset(0)}
              style={{
                position: 'absolute',
                bottom: 16,
                right: 96,
                background: 'rgba(99, 102, 241, 0.95)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 20,
                padding: '6px 14px',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
                zIndex: 15,
                transition: 'transform 0.15s ease',
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>fast_forward</span>
              Jump to Live ({panOffset} bars ago)
            </button>
          )}
          </>
        )}
      </div>

      {/* 5. Bottom Timeline & Range Bar (TradingView / Yahoo Finance style) */}
      <div style={{
        background: 'var(--qv-card)',
        borderTop: '1px solid var(--qv-border)',
        padding: '5px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--qv-text3)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--qv-text3)', marginRight: 4, fontWeight: 600 }}>TIMELINE:</span>
          {['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'ALL'].map(r => (
            <button
              key={r}
              onClick={() => handleRangeSelect(r)}
              style={{
                background: selectedRange === r ? 'var(--qv-accent)' : 'transparent',
                color: selectedRange === r ? '#ffffff' : 'var(--qv-text2)',
                border: selectedRange === r ? '1px solid var(--qv-accent)' : '1px solid transparent',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: selectedRange === r ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                transition: 'all 0.15s ease',
              }}>
              {r}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {panOffset > 0 && (
            <button
              onClick={() => setPanOffset(0)}
              style={{
                background: 'rgba(99, 102, 241, 0.2)',
                border: '1px solid rgba(99, 102, 241, 0.5)',
                color: '#818cf8',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>fast_forward</span>
              Reset View
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--qv-text3)' }}>
            <span>🖱️ Drag horizontal to pan past</span>
            <span>•</span>
            <span>Scroll wheel to zoom</span>
            <span>•</span>
            <span>{visibleCandles.length} / {candles.length} bars</span>
          </div>
        </div>
      </div>

      {/* TypeSafe Jev™ Model System One Detailed Breakdown Modal */}
      {showJevModal && jevData && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }} onClick={() => setShowJevModal(false)}>
          <div
            style={{
              background: 'var(--qv-card)',
              border: '1px solid var(--qv-border)',
              borderRadius: 14,
              width: '100%',
              maxWidth: 580,
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              color: 'var(--qv-text)',
              fontFamily: 'system-ui, sans-serif'
            }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 4,
                  letterSpacing: 1
                }}>
                  TYPESAFE JEV™
                </span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>
                  System One Intelligence Matrix
                </span>
              </div>
              <button
                onClick={() => setShowJevModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--qv-text3)', cursor: 'pointer' }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              <div style={{ background: 'var(--qv-bg2)', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Action Choice</div>
                <div style={{
                  fontSize: 16,
                  fontWeight: 800,
                  fontFamily: 'JetBrains Mono, monospace',
                  color: jevData.action.includes('BUY') ? 'var(--qv-bull)' : jevData.action.includes('SELL') ? 'var(--qv-bear)' : 'var(--qv-text2)',
                  marginTop: 4
                }}>
                  {jevData.action}
                </div>
              </div>
              <div style={{ background: 'var(--qv-bg2)', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Confidence Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#818cf8', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>
                  {jevData.confidence_display}
                </div>
              </div>
              <div style={{ background: 'var(--qv-bg2)', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Conviction</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--qv-text)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>
                  {jevData.conviction_pct}%
                </div>
              </div>
            </div>

            {/* Risk Noul Gauges */}
            <div style={{ background: 'var(--qv-bg2)', padding: 14, borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>Quantitative Risk Assessment</span>
                <span style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Noul Probability Engine</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--qv-text2)' }}>Bull / Bear Trap Risk</span>
                    <strong style={{ color: jevData.trap_risk_pct < 25 ? 'var(--qv-bull)' : '#f59e0b' }}>
                      {jevData.trap_risk_pct}% ({jevData.trap_risk_label})
                    </strong>
                  </div>
                  <div style={{ height: 6, background: 'var(--qv-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${jevData.trap_risk_pct}%`,
                      background: jevData.trap_risk_pct < 25 ? 'var(--qv-bull)' : '#f59e0b'
                    }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--qv-text2)' }}>Volatility Spike Risk</span>
                    <strong style={{ color: jevData.volatility_risk_pct > 40 ? '#ef4444' : 'var(--qv-text2)' }}>
                      {jevData.volatility_risk_pct}% ({jevData.volatility_risk_label})
                    </strong>
                  </div>
                  <div style={{ height: 6, background: 'var(--qv-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${jevData.volatility_risk_pct}%`,
                      background: jevData.volatility_risk_pct > 40 ? '#ef4444' : '#38bdf8'
                    }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Target, Predicted Close & Stop Loss Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: jevData.predicted_close_price ? 'repeat(3, 1fr)' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>Projected Target</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#10b981', marginTop: 2 }}>
                  ₹{fmt(jevData.target_price)}
                </div>
                <div style={{ fontSize: 11, color: '#10b981', marginTop: 2 }}>
                  {jevData.target_pct > 0 ? `+${jevData.target_pct}%` : `${jevData.target_pct}%`} upside
                </div>
              </div>
              {jevData.predicted_close_price && (
                <div style={{ border: '1px solid rgba(6,182,212,0.4)', background: 'rgba(6,182,212,0.06)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#06b6d4', fontWeight: 600 }}>Predicted Close</div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#06b6d4', marginTop: 2 }}>
                    ₹{fmt(jevData.predicted_close_price)}
                  </div>
                  <div style={{ fontSize: 11, color: '#06b6d4', marginTop: 2 }}>
                    {(jevData.predicted_close_pct ?? 0) >= 0 ? `+${jevData.predicted_close_pct}%` : `${jevData.predicted_close_pct}%`} expected
                  </div>
                </div>
              )}
              <div style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Calculated Stop Loss</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#ef4444', marginTop: 2 }}>
                  ₹{fmt(jevData.stop_loss_price)}
                </div>
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                  {jevData.stop_loss_pct}% downside protection
                </div>
              </div>
            </div>

            {/* Rationale */}
            <div style={{ fontSize: 12, color: 'var(--qv-text2)', lineHeight: 1.6, background: 'var(--qv-bg)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
              {jevData.summary}
            </div>

            {/* Order Action Button */}
            <button
              onClick={() => {
                setShowJevModal(false);
                onOpenOrder(activeSymbol, jevData.action.includes('SELL') ? 'SELL' : 'BUY');
              }}
              style={{
                width: '100%',
                background: jevData.action.includes('SELL') ? 'var(--qv-bear)' : 'var(--qv-bull)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                padding: '12px',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
              Execute Jev Signal ({jevData.action.replace('_', ' ')}) on {activeSymbol.replace('.NS', '')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
