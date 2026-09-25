import { useEffect, useRef, memo } from 'react';

interface Props {
  symbol: string;
  theme: string;
  interval?: string;
  autosize?: boolean;
}

/**
 * Normalizes any US or Global ticker symbol to TradingView exchange:symbol format
 */
export function toTradingViewSymbol(sym: string): string {
  if (!sym) return 'NASDAQ:AAPL';
  const clean = sym.trim().toUpperCase().replace('.NS', '').replace('.BO', '');
  if (clean.includes(':')) return clean;

  if (clean === 'AAPL') return 'NASDAQ:AAPL';
  if (clean === 'NVDA') return 'NASDAQ:NVDA';
  if (clean === 'TSLA') return 'NASDAQ:TSLA';
  if (clean === 'MSFT') return 'NASDAQ:MSFT';
  if (clean === 'AMZN') return 'NASDAQ:AMZN';
  if (clean === 'GOOGL' || clean === 'GOOG') return 'NASDAQ:GOOGL';
  if (clean === 'META') return 'NASDAQ:META';
  if (clean === 'SPY') return 'AMEX:SPY';
  if (clean === 'QQQ') return 'NASDAQ:QQQ';
  if (clean === 'AMD') return 'NASDAQ:AMD';
  if (clean === 'NFLX') return 'NASDAQ:NFLX';
  if (clean === 'BTC' || clean === 'BTC-USD' || clean === 'BTCUSD') return 'BINANCE:BTCUSDT';
  if (clean === 'ETH' || clean === 'ETH-USD' || clean === 'ETHUSD') return 'BINANCE:ETHUSDT';
  if (clean === 'SOL' || clean === 'SOL-USD' || clean === 'SOLUSD') return 'BINANCE:SOLUSDT';

  // Default to NASDAQ for US equity tickers
  return `NASDAQ:${clean}`;
}

/**
 * Maps interval string to TradingView interval code
 */
export function toTradingViewInterval(intv: string): string {
  switch (intv) {
    case '1m': return '1';
    case '3m': return '3';
    case '5m': return '5';
    case '15m': return '15';
    case '30m': return '30';
    case '1H':
    case '60m': return '60';
    case '2H':
    case '120m': return '120';
    case '4H':
    case '240m': return '240';
    case '1D':
    case '1d':
    case 'D': return 'D';
    case '1W':
    case '1wk':
    case 'W': return 'W';
    case '1M':
    case '1mo':
    case 'M': return 'M';
    default: return 'D';
  }
}

function TradingViewChartComponent({ symbol, theme, interval = 'D', autosize = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tvSymbol = toTradingViewSymbol(symbol);
  const tvInterval = toTradingViewInterval(interval);
  const isDark = theme !== 'light';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous widget
    container.innerHTML = '';

    // Create wrapper div
    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.width = '100%';
    widgetDiv.style.height = '100%';
    container.appendChild(widgetDiv);

    // Create script tag with TradingView Advanced Chart configuration
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    const widgetConfig = {
      autosize: autosize,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'America/New_York',
      theme: isDark ? 'dark' : 'light',
      style: '1', // 1 = Candlestick
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false, // Enables full left drawing toolbar
      save_image: true,
      withdateranges: true, // Enables full bottom timeline bar: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, ALL
      range: 'YTD',
      details: true,
      hotlist: false,
      show_popup_button: false,
      studies: [
        'STD;SMA',
        'STD;EMA',
        'STD;RSI',
        'STD;Volume'
      ],
      backgroundColor: isDark ? '#0d1117' : '#ffffff',
      gridColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
    };

    script.innerHTML = JSON.stringify(widgetConfig);
    container.appendChild(script);

    return () => {
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [tvSymbol, tvInterval, isDark, autosize]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 450,
        position: 'relative',
        background: isDark ? '#0d1117' : '#ffffff',
        overflow: 'hidden',
      }}
    />
  );
}

export const TradingViewChart = memo(TradingViewChartComponent);
export default TradingViewChart;
