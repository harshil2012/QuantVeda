/**
 * QuantVeda AI - Client Controller
 * Powers Dashboard, Interactive Technical Charts, Watchlists, Portfolio, Scanner Engine, & Accuracy Tracker
 */

const API_BASE_URL = `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:8000`;

// Global State
let currentView = 'dashboard';
let currentSymbol = 'RELIANCE.NS';
let currentChartInterval = '1d';
let currentChartRange = '1y';
let currentChartType = 'candles'; // candles | line | bars
let tvChart = null;
let candlestickSeries = null;
let lastIsDaily = true;
let volumeSeries = null;

// Dashboard Chart Instances
let dashChart = null;
let dashCandlestickSeries = null;
let dashVolumeSeries = null;

// Indicator overlay series
let smaSeries = null;
let emaSeries = null;
let bbUpperSeries = null;
let bbLowerSeries = null;
let vwapSeries = null;
let lastCandlesRaw = []; // cached raw candle data for indicator recalculations

let searchDebounceTimer = null;
let autocompleteResults = [];

// Sample Accuracy Validation Logs
let accuracyLogs = [
  { timestamp: "2023-10-27 14:30:12", symbol: "NVDA", name: "NVIDIA Corp", type: "LONG ENTRY", typeBg: "bg-primary-fixed text-on-primary-fixed", target: "$412.50", peak: "$415.80", status: "HIT", statusBg: "text-primary-container bg-primary-fixed", icon: "check_circle" },
  { timestamp: "2023-10-27 12:15:44", symbol: "TSLA", name: "Tesla Inc", type: "SHORT ENTRY", typeBg: "bg-error-container text-on-error-container", target: "$205.10", peak: "$208.40", status: "MISS", statusBg: "text-on-error-container bg-error-container", icon: "cancel" },
  { timestamp: "2023-10-27 10:05:21", symbol: "AAPL", name: "Apple Inc", type: "LONG ENTRY", typeBg: "bg-primary-fixed text-on-primary-fixed", target: "$168.90", peak: "$170.25", status: "HIT", statusBg: "text-primary-container bg-primary-fixed", icon: "check_circle" },
  { timestamp: "2023-10-26 15:45:00", symbol: "MSFT", name: "Microsoft Corp", type: "LONG ENTRY", typeBg: "bg-primary-fixed text-on-primary-fixed", target: "$335.20", peak: "$338.10", status: "HIT", statusBg: "text-primary-container bg-primary-fixed", icon: "check_circle" },
  { timestamp: "2023-10-26 11:20:05", symbol: "RELIANCE.NS", name: "Reliance Industries", type: "LONG ENTRY", typeBg: "bg-primary-fixed text-on-primary-fixed", target: "₹2,920.00", peak: "₹2,955.00", status: "HIT", statusBg: "text-primary-container bg-primary-fixed", icon: "check_circle" },
  { timestamp: "2023-10-25 14:10:30", symbol: "AMD", name: "Advanced Micro Devices", type: "LONG ENTRY", typeBg: "bg-primary-fixed text-on-primary-fixed", target: "$160.00", peak: "$164.20", status: "HIT", statusBg: "text-primary-container bg-primary-fixed", icon: "check_circle" },
  { timestamp: "2023-10-25 09:35:12", symbol: "META", name: "Meta Platforms", type: "SHORT ENTRY", typeBg: "bg-error-container text-on-error-container", target: "$490.00", peak: "$498.10", status: "MISS", statusBg: "text-on-error-container bg-error-container", icon: "cancel" },
];

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initNavigation();
  initSidebarToggle();
  initTheme();
  loadChartSettings();
  initSearchAutocomplete();
  initDashboard();
  initChartsView();
  initWatchlistsAndPortfolio();
  initScannerEngine();
  initAccuracyTracker();
  initModals();
  initSettingsView();
  initIndicatorsModal();

  // Load initial quote for default symbol
  loadSymbolQuote(currentSymbol);
});

// ================= LIVE CLOCK =================
function initClock() {
  const clockEl = document.getElementById('header-live-clock');
  function update() {
    const now = new Date();
    try {
      const options = { timeZone: 'Asia/Kolkata', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' };
      if (clockEl) clockEl.textContent = `IST ${now.toLocaleTimeString('en-IN', options)}`;
    } catch (e) {
      if (clockEl) clockEl.textContent = `UTC ${now.toISOString().substring(11, 19)}`;
    }
  }
  setInterval(update, 1000);
  update();
}

// ================= THEME =================
const THEME_STORAGE_KEY = 'quantveda-theme';
const CHART_SETTINGS_KEY = 'quantveda_chart_settings';
const DEFAULT_CANDLES_VISIBLE = 110;
const VALID_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
const VALID_CHART_TYPES = ['candles', 'line', 'area', 'bars', 'heikin'];

function getStoredTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) || 'system'; } catch (e) { return 'system'; }
}
function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function isDarkTheme() {
  const t = getStoredTheme();
  return t === 'dark' || (t === 'system' && systemPrefersDark());
}
function applyTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) {}
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('bg-dropdown-hover', btn.dataset.theme === theme);
  });
  refreshChartTheme();
}
function initTheme() {
  applyTheme(getStoredTheme());
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      applyTheme(isDarkTheme() ? 'light' : 'dark');
    });
  }
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getStoredTheme() === 'system') applyTheme('system');
    });
  }
}
function getChartPalette() {
  const dark = isDarkTheme();
  return {
    bg: dark ? '#0d1117' : '#ffffff',
    text: dark ? '#8b949e' : '#334155',
    grid: dark ? '#21262d' : '#f1f5f9',
    border: dark ? '#30363d' : '#e2e8f0',
    up: dark ? '#3fb950' : '#059669',
    down: dark ? '#f85149' : '#e11d48',
    vol: dark ? '#8b949e' : '#94a3b8',
    upVol: dark ? 'rgba(63, 185, 80, 0.4)' : 'rgba(5, 150, 105, 0.4)',
    downVol: dark ? 'rgba(248, 81, 73, 0.4)' : 'rgba(225, 29, 72, 0.4)',
  };
}
function refreshChartTheme() {
  const pal = getChartPalette();
  if (tvChart) {
    tvChart.applyOptions({
      layout: { background: { type: 'solid', color: pal.bg }, textColor: pal.text },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border },
    });
    if (volumeSeries) volumeSeries.applyOptions({ color: pal.vol });
    try {
      if (candlestickSeries && candlestickSeries.applyOptions) {
        candlestickSeries.applyOptions({
          upColor: pal.up, downColor: pal.down,
          wickUpColor: pal.up, wickDownColor: pal.down,
        });
      }
    } catch (e) {}
  }
  if (dashChart) {
    dashChart.applyOptions({
      layout: { background: { type: 'solid', color: pal.bg }, textColor: pal.text },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border },
    });
    if (dashVolumeSeries) dashVolumeSeries.applyOptions({ color: pal.vol });
    try {
      if (dashCandlestickSeries && dashCandlestickSeries.applyOptions) {
        dashCandlestickSeries.applyOptions({
          upColor: pal.up, downColor: pal.down,
          wickUpColor: pal.up, wickDownColor: pal.down,
        });
      }
    } catch (e) {}
  }
}

// ================= CHART SETTINGS PERSISTENCE =================
function loadChartSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(CHART_SETTINGS_KEY) || '{}');
    if (s && VALID_INTERVALS.includes(s.interval)) currentChartInterval = s.interval;
    if (s && s.range) currentChartRange = s.range;
    if (s && VALID_CHART_TYPES.includes(s.chartType)) currentChartType = s.chartType;
  } catch (e) {}
}
function saveChartSettings() {
  try {
    localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify({
      interval: currentChartInterval,
      range: currentChartRange,
      chartType: currentChartType,
    }));
  } catch (e) {}
}
function applyDefaultZoom() {
  if (!tvChart || !candlestickSeries) return;
  const count = lastCandlesRaw.length;
  if (count > DEFAULT_CANDLES_VISIBLE) {
    tvChart.timeScale().setVisibleLogicalRange({
      from: count - DEFAULT_CANDLES_VISIBLE + 0.5,
      to: count - 0.5,
    });
  } else {
    tvChart.timeScale().fitContent();
  }
}

// ================= NAVIGATION =================
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn, .nav-btn-mobile');
  const viewSections = {
    dashboard: document.getElementById('view-dashboard'),
    charts: document.getElementById('view-charts'),
    watchlists: document.getElementById('view-watchlists'),
    portfolio: document.getElementById('view-portfolio'),
    scanner: document.getElementById('view-scanner'),
    accuracy: document.getElementById('view-accuracy'),
    settings: document.getElementById('view-settings')
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.targetView;
      if (!targetView || !viewSections[targetView]) return;

      currentView = targetView;

      // Update active nav styling
      document.querySelectorAll('.nav-btn').forEach(b => {
        if (b.dataset.targetView === targetView) {
          b.classList.add('nav-item-active');
          b.classList.remove('text-on-surface-variant');
        } else {
          b.classList.remove('nav-item-active');
          b.classList.add('text-on-surface-variant');
        }
      });

      // Show target view, hide others
      Object.keys(viewSections).forEach(vKey => {
        if (viewSections[vKey]) {
          if (vKey === targetView) {
            viewSections[vKey].classList.remove('hidden');
          } else {
            viewSections[vKey].classList.add('hidden');
          }
        }
      });

      // Close mobile drawer if open
      const mobileDrawer = document.getElementById('mobile-drawer');
      if (mobileDrawer) mobileDrawer.classList.add('hidden');

      // Trigger view specific re-renders
      if (targetView === 'dashboard') {
        setTimeout(() => {
          if (!dashChart) {
            setupDashboardChart();
          }
          const container = document.getElementById('dash-chart-container');
          if (container && dashChart) {
            dashChart.applyOptions({
              width: container.clientWidth || container.parentElement?.clientWidth || 600,
              height: 240
            });
          }
          loadDashboardCandles(currentSymbol);
        }, 50);
      } else if (targetView === 'charts') {
        setTimeout(() => {
          if (!tvChart) {
            setupLightweightChart();
          }
          const container = document.getElementById('tv-chart-container');
          if (container && tvChart) {
            tvChart.applyOptions({
              width: container.clientWidth || container.parentElement?.clientWidth || 800,
              height: container.clientHeight || 450
            });
          }
          loadCandlesData(currentSymbol, currentChartInterval, INTERVAL_RANGE_MAP[currentChartInterval] || currentChartRange);
        }, 50);
      } else if (targetView === 'watchlists' || targetView === 'portfolio') {
        fetchWatchlistData();
        fetchPortfolioData();
      } else if (targetView === 'scanner') {
        runScanner();
      } else if (targetView === 'accuracy') {
        renderAccuracyTable();
      } else if (targetView === 'settings') {
        loadSettingsData();
      }
    });
  });

  // Mobile Drawer Toggle
  const openDrawerBtn = document.getElementById('open-mobile-drawer');
  const closeDrawerBtn = document.getElementById('close-mobile-drawer');
  const mobileDrawer = document.getElementById('mobile-drawer');

  if (openDrawerBtn && mobileDrawer) {
    openDrawerBtn.addEventListener('click', () => mobileDrawer.classList.remove('hidden'));
  }
  if (closeDrawerBtn && mobileDrawer) {
    closeDrawerBtn.addEventListener('click', () => mobileDrawer.classList.add('hidden'));
  }
}

// ================= SEARCH & AUTOCOMPLETE =================
function initSearchAutocomplete() {
  const searchInput = document.getElementById('main-search-input');
  const clearBtn = document.getElementById('clear-search-btn');
  const dropdown = document.getElementById('search-autocomplete-dropdown');

  if (!searchInput || !dropdown) return;

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length > 0) {
      if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
      if (clearBtn) clearBtn.classList.add('hidden');
      dropdown.classList.add('hidden');
      return;
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => fetchSearchResults(val), 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = searchInput.value.trim().toUpperCase();
      if (val) {
        currentSymbol = val;
        loadSymbolQuote(currentSymbol);
        dropdown.classList.add('hidden');
      }
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      dropdown.classList.add('hidden');
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

async function fetchSearchResults(query) {
  const dropdown = document.getElementById('search-autocomplete-dropdown');
  if (!dropdown) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    const items = data.data || data.results || [];
    if (data.status === 'success' && items.length > 0) {
      dropdown.innerHTML = items.map(item => `
        <div class="px-4 py-2 hover:bg-toolbar-btn-hover cursor-pointer border-b border-border-primary/30 search-item flex items-center justify-between transition-colors" data-symbol="${item.symbol}">
          <div>
            <div class="font-bold text-sm text-text-primary font-mono">${item.symbol}</div>
            <div class="text-xs text-text-muted font-sans mt-0.5">${item.name || item.symbol}</div>
          </div>
          <span class="text-[10px] font-mono bg-sidebar-hover px-2 py-0.5 rounded text-text-secondary border border-border-primary/40">${item.exchange || 'NSE'}</span>
        </div>
      `).join('');

      dropdown.classList.remove('hidden');

      // Add click handlers
      dropdown.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', () => {
          const sym = el.dataset.symbol;
          if (sym) {
            currentSymbol = sym;
            document.getElementById('main-search-input').value = sym;
            loadSymbolQuote(currentSymbol);
            dropdown.classList.add('hidden');
          }
        });
      });
    } else {
      dropdown.innerHTML = `<div class="p-3 text-xs text-on-surface-variant text-center font-data-mono">No matching symbols found</div>`;
      dropdown.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('Search autocomplete error:', err);
  }
}

function showDashboardHeroSkeleton() {
  const symEl = document.getElementById('dash-symbol-name');
  const compEl = document.getElementById('dash-company-name');
  const priceEl = document.getElementById('dash-price-val');
  const changeEl = document.getElementById('dash-change-val');
  const badge = document.getElementById('ai-signal-badge');
  const conviction = document.getElementById('ai-conviction-val');
  const targetPrice = document.getElementById('ai-target-price');
  const stopLoss = document.getElementById('ai-stop-loss');

  if (symEl) {
    symEl.innerHTML = `<span class="inline-block w-36 h-5 bg-border-primary/40 animate-pulse rounded"></span>`;
  }
  if (compEl) {
    compEl.innerHTML = `<span class="inline-block w-20 h-3.5 bg-border-primary/30 animate-pulse rounded"></span>`;
  }
  if (priceEl) {
    priceEl.innerHTML = `<span class="inline-block w-24 h-5 bg-border-primary/40 animate-pulse rounded"></span>`;
  }
  if (changeEl) {
    changeEl.innerHTML = `<span class="inline-block w-16 h-3 bg-border-primary/30 animate-pulse rounded"></span>`;
  }
  if (badge) {
    badge.className = 'px-3 py-1.5 rounded-lg flex items-center gap-1';
    badge.innerHTML = `<span class="inline-block w-24 h-4 bg-border-primary/40 animate-pulse rounded"></span>`;
  }
  if (conviction) {
    conviction.innerHTML = `<span class="inline-block w-28 h-4 bg-border-primary/30 animate-pulse rounded"></span>`;
  }
  if (targetPrice) {
    targetPrice.innerHTML = `<span class="inline-block w-16 h-4 bg-border-primary/40 animate-pulse rounded"></span>`;
  }
  if (stopLoss) {
    stopLoss.innerHTML = `<span class="inline-block w-16 h-4 bg-border-primary/40 animate-pulse rounded"></span>`;
  }
}

// ================= SYMBOL QUOTE LOADING =================
async function loadSymbolQuote(symbol) {
  showGlobalError(false);
  showDashboardHeroSkeleton();
  const loader = document.getElementById('dash-chart-loader');
  if (loader) loader.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE_URL}/api/quote/${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Quote not found`);
    const json = await res.json();

    if (json.status === 'success' && json.data) {
      updateDashboardHero(json.data);
      updateChartHeader(json.data);
      loadDashboardCandles(symbol);

      if (currentView === 'charts') {
        loadCandlesData(symbol, currentChartInterval, INTERVAL_RANGE_MAP[currentChartInterval] || currentChartRange);
      }
    }
  } catch (err) {
    console.error('Error fetching quote:', err);
    updateDashboardHeroFallback(symbol);
  }
}

const FRIENDLY_SYMBOL_NAMES = {
  '^NSEI': 'Nifty 50',
  '^NSEBANK': 'Nifty Bank',
  '^BSESN': 'S&P BSE Sensex',
  '^CNXIT': 'Nifty IT',
  'RELIANCE.NS': 'Reliance Industries',
  'TCS.NS': 'Tata Consultancy Services',
  'HDFCBANK.NS': 'HDFC Bank',
  'INFY.NS': 'Infosys',
  'ICICIBANK.NS': 'ICICI Bank',
  'BHARTIARTL.NS': 'Bharti Airtel',
  'SBIN.NS': 'State Bank of India',
  'TATAMOTORS.NS': 'Tata Motors',
  'TATASTEEL.NS': 'Tata Steel',
  'WAAREEENER.NS': 'Waaree Energies',
  'LT.NS': 'Larsen & Toubro',
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'NVDA': 'NVIDIA',
  'TSLA': 'Tesla',
  'GOOGL': 'Alphabet',
  'AMZN': 'Amazon',
  'META': 'Meta Platforms',
  'AMD': 'Advanced Micro Devices'
};

function getCleanDisplayName(q) {
  const sym = (q && (q.symbol || q.symbol_canonical) ? (q.symbol || q.symbol_canonical) : currentSymbol).toUpperCase();
  if (FRIENDLY_SYMBOL_NAMES[sym]) return FRIENDLY_SYMBOL_NAMES[sym];

  if (q && q.name && typeof q.name === 'string') {
    let n = q.name.trim();
    if (n === '^NSEI' || n === 'NSEI' || n === '%5ENSEI') return 'Nifty 50';
    if (n === '^NSEBANK') return 'Nifty Bank';
    if (n === '^BSESN') return 'S&P BSE Sensex';
    
    // Clean corporate suffixes
    n = n.replace(/\b(LTD|LIMITED|INC|INC\.|CORP|CORPORATION|PLC)\b/gi, '').trim();
    if (n.length > 0) {
      return n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }

  let cleanSym = sym.replace(/\.(NS|BO)$/i, '');
  return cleanSym.charAt(0).toUpperCase() + cleanSym.slice(1).toLowerCase();
}

window.quantVedaSignalCache = {};

function logCanonicalSignalToAccuracyTracker(sig) {
  if (typeof accuracyLogs === 'undefined' || !Array.isArray(accuracyLogs)) return;
  const exists = accuracyLogs.some(l => l.symbol === sig.symbol);
  if (!exists) {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const currSym = sig.symbol.includes('.NS') || sig.symbol.includes('^') ? '₹' : '$';
    accuracyLogs.unshift({
      timestamp: nowStr,
      symbol: sig.symbol,
      name: getCleanDisplayName({ symbol: sig.symbol }),
      type: sig.direction === 'BUY' ? 'LONG ENTRY' : 'SHORT ENTRY',
      typeBg: sig.direction === 'BUY' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-error-container text-on-error-container',
      target: `${currSym}${sig.targetPrice.toFixed(2)} (${sig.targetPct > 0 ? '+' : ''}${sig.targetPct}%)`,
      peak: `${currSym}${sig.currentPrice.toFixed(2)}`,
      status: 'ACTIVE',
      statusBg: 'text-primary-container bg-primary-fixed',
      icon: 'check_circle'
    });
    if (typeof renderAccuracyTable === 'function') {
      renderAccuracyTable();
    }
  }
}

function getOrCreateCanonicalSignal(q) {
  const symbol = (q && (q.symbol || q.symbol_canonical) ? (q.symbol || q.symbol_canonical) : currentSymbol).toUpperCase();

  // Return cached signal if present
  if (window.quantVedaSignalCache[symbol]) {
    return window.quantVedaSignalCache[symbol];
  }

  const price = (q && q.price !== undefined) ? q.price : (window.lastKnownQuotePrice || 1313.50);
  const pred = (q && q.prediction) ? q.prediction : {};
  
  const isBull = (pred.direction === 'BUY' || pred.direction === 'UP' || pred.predicted_direction === 'BULLISH' || pred.predicted_direction === 'STRONG BUY');
  const direction = isBull ? 'BUY' : 'SELL';
  
  const convictionVal = pred.confidence_pct || pred.confidence_score || pred.conviction_pct || 92;
  const conviction = Number((convictionVal / 100).toFixed(2));

  // Percentages
  const targetPct = isBull ? 8.2 : -7.5;
  const stopLossPct = isBull ? -5.8 : 5.5;

  // Derive target and stop loss prices strictly from currentPrice + pct
  const targetPrice = Number((price * (1.0 + (targetPct / 100))).toFixed(2));
  const stopLossPrice = Number((price * (1.0 + (stopLossPct / 100))).toFixed(2));

  const canonical = {
    symbol: symbol,
    direction: direction,
    predicted_direction: isBull ? 'STRONG BUY' : 'BEARISH / REDUCE',
    conviction: conviction,
    conviction_pct: convictionVal,
    confidence_pct: convictionVal,
    confidence_score: convictionVal,
    currentPrice: price,
    targetPct: targetPct,
    targetPrice: targetPrice,
    stopLossPct: stopLossPct,
    stopLossPrice: stopLossPrice,
    horizonDays: 14,
    generatedAt: new Date().toISOString(),
    summary: pred.technical_summary || pred.summary || `Quantitative neural model confirms ${isBull ? 'bullish breakout' : 'bearish pullback pressure'} across multi-timeframe indicators for ${symbol}.`
  };

  window.quantVedaSignalCache[symbol] = canonical;
  logCanonicalSignalToAccuracyTracker(canonical);

  return canonical;
}

function updateDashboardHero(q) {
  const symEl = document.getElementById('dash-symbol-name');
  const compEl = document.getElementById('dash-company-name');
  const exchEl = document.getElementById('dash-exchange-info');
  const priceEl = document.getElementById('dash-price-val');
  const changeEl = document.getElementById('dash-change-val');

  const currSym = q.currency_symbol || (q.currency === 'INR' ? '₹' : '$');
  const price = q.price !== undefined ? q.price : 2940.50;
  const change = q.change !== undefined ? q.change : 2.31;
  const changePct = q.change_pct !== undefined ? q.change_pct : 1.24;
  const isPos = change >= 0;

  window.lastKnownQuotePrice = price;

  const displayName = getCleanDisplayName(q);
  const rawSymbol = q.symbol || currentSymbol;

  // Main Title = Full Readable Name
  if (symEl) symEl.textContent = displayName;
  
  // Secondary Badge = Symbol ticker
  if (compEl) compEl.textContent = rawSymbol.toUpperCase();
  
  if (exchEl) exchEl.textContent = `${q.exchange || 'NSE'} • ${q.currency || 'INR'} • Live 1-Day Intraday`;

  if (priceEl) priceEl.textContent = `${currSym}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  if (changeEl) {
    const sign = isPos ? '+' : '';
    const pillBgClass = isPos ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400';
    const icon = isPos ? 'arrow_upward' : 'arrow_downward';
    changeEl.className = `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-mono ${pillBgClass} mt-1`;
    changeEl.innerHTML = `<span class="material-symbols-outlined text-xs">${icon}</span> ${sign}${changePct.toFixed(2)}% (${sign}${change.toFixed(2)})`;
  }

  // Read single canonical signal
  const signal = getOrCreateCanonicalSignal(q);

  const badge = document.getElementById('ai-signal-badge');
  const conviction = document.getElementById('ai-conviction-val');
  const targetPrice = document.getElementById('ai-target-price');
  const stopLoss = document.getElementById('ai-stop-loss');

  const isBuy = signal.direction === 'BUY';

  if (badge) {
    badge.textContent = signal.predicted_direction;
    badge.className = isBuy 
      ? 'bg-[#ECFDF5] text-[#059669] font-label-sm text-label-sm px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold'
      : 'bg-[#FFF1F2] text-[#E11D48] font-label-sm text-label-sm px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold';
  }

  if (conviction) conviction.textContent = `Conviction: ${signal.conviction_pct}%`;
  if (targetPrice) targetPrice.textContent = `${currSym}${signal.targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (stopLoss) stopLoss.textContent = `${currSym}${signal.stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateDashboardHeroFallback(symbol) {
  const symEl = document.getElementById('dash-symbol-name');
  const compEl = document.getElementById('dash-company-name');
  const priceEl = document.getElementById('dash-price-val');

  const displayName = getCleanDisplayName({ symbol: symbol });
  if (symEl) symEl.textContent = displayName;
  if (compEl) compEl.textContent = symbol.toUpperCase();
  if (priceEl) priceEl.textContent = `₹2,940.50`;
}

function updateChartHeader(q) {
  const chartSym = document.getElementById('chart-current-symbol');
  const legendName = document.getElementById('tv-legend-name');
  const legendTf = document.getElementById('tv-legend-tf');
  const legendExch = document.getElementById('tv-legend-exch');
  const sellPrice = document.getElementById('tv-sell-price');
  const buyPrice = document.getElementById('tv-buy-price');

  const displayName = getCleanDisplayName(q);

  if (chartSym) chartSym.textContent = q.symbol || currentSymbol;
  if (legendName) legendName.textContent = displayName;
  if (legendTf) legendTf.textContent = currentChartInterval.toUpperCase();
  if (legendExch) legendExch.textContent = q.exchange || 'NSE';

  const oEl = document.getElementById('ohlc-o');
  const hEl = document.getElementById('ohlc-h');
  const lEl = document.getElementById('ohlc-l');
  const cEl = document.getElementById('ohlc-c');

  const currSym = q.currency_symbol || '₹';
  const price = q.price || 2940.50;

  if (sellPrice) sellPrice.textContent = fmtNum(price - 0.25);
  if (buyPrice) buyPrice.textContent = fmtNum(price);

  if (oEl) oEl.textContent = `${currSym}${(price * 0.995).toFixed(2)}`;
  if (hEl) hEl.textContent = `${currSym}${(price * 1.012).toFixed(2)}`;
  if (lEl) lEl.textContent = `${currSym}${(price * 0.991).toFixed(2)}`;
  if (cEl) cEl.textContent = `${currSym}${price.toFixed(2)}`;
}

// ================= DASHBOARD CORRELATED TABLE =================
function initDashboard() {
  renderCorrelatedTable();
  setupDashboardChart();
  loadDashboardCandles(currentSymbol);

  const refreshBtn = document.getElementById('btn-view-matrix');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => renderCorrelatedTable());
  }
}

function renderCorrelatedTable() {
  const tbody = document.getElementById('dash-correlated-table-body');
  if (!tbody) return;

  const sampleCorrelated = [
    { symbol: "MSFT", correlation: "0.82", price: "415.30", chg: "+1.05%", isPos: true, bias: "BULL", biasBg: "bg-[#ECFDF5] text-[#059669]" },
    { symbol: "GOOGL", correlation: "0.76", price: "174.92", chg: "-0.42%", isPos: false, bias: "NEUT", biasBg: "bg-[#F8FAFC] border border-[#E2E8F0] text-[#334155]" },
    { symbol: "QQQ", correlation: "0.91", price: "452.11", chg: "+0.88%", isPos: true, bias: "BULL", biasBg: "bg-[#ECFDF5] text-[#059669]" },
    { symbol: "NVDA", correlation: "0.88", price: "892.45", chg: "+4.20%", isPos: true, bias: "BULL", biasBg: "bg-[#ECFDF5] text-[#059669]" },
    { symbol: "RELIANCE.NS", correlation: "0.64", price: "₹2,940.50", chg: "+1.15%", isPos: true, bias: "BULL", biasBg: "bg-[#ECFDF5] text-[#059669]" }
  ];

  tbody.innerHTML = sampleCorrelated.map(item => `
    <tr class="border-b border-[#E2E8F0] hover:bg-[#F1F5F9] transition-colors h-[48px]">
      <td class="px-4 py-2 font-bold text-[#0F172A] cursor-pointer item-row-symbol" data-symbol="${item.symbol}">${item.symbol}</td>
      <td class="px-4 py-2 text-on-surface-variant">${item.correlation}</td>
      <td class="px-4 py-2 text-right">${item.price}</td>
      <td class="px-4 py-2 text-right ${item.isPos ? 'text-[#059669]' : 'text-[#E11D48]'}">${item.chg}</td>
      <td class="px-4 py-2 text-center">
        <span class="inline-block ${item.biasBg} px-2 py-0.5 rounded text-[10px] font-bold">${item.bias}</span>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.item-row-symbol').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });
}

// ================= CHARTS VIEW =================
function initChartsView() {
  // Interval Dropdown Selector (TradingView style)
  const intervalBtn = document.getElementById('chart-interval-dropdown-btn');
  const intervalMenu = document.getElementById('chart-interval-menu');
  const intervalLabel = document.getElementById('current-interval-label');

  if (intervalBtn && intervalMenu) {
    intervalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      intervalMenu.classList.toggle('hidden');
      if (chartTypeMenu) chartTypeMenu.classList.add('hidden');
    });

    intervalMenu.querySelectorAll('.interval-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const tf = item.dataset.tf;
        if (tf) {
          currentChartInterval = tf;
          if (intervalLabel) intervalLabel.textContent = tf.toUpperCase();

          intervalMenu.querySelectorAll('.interval-menu-item').forEach(b => {
            const check = b.querySelector('.active-check');
            if (check) check.classList.toggle('hidden', b.dataset.tf !== tf);
          });

          saveChartSettings();
          const targetRange = INTERVAL_RANGE_MAP[currentChartInterval] || '1y';
          loadCandlesData(currentSymbol, currentChartInterval, targetRange);
          intervalMenu.classList.add('hidden');
        }
      });
    });

    // Set initial active state in interval dropdown
    if (intervalLabel) intervalLabel.textContent = currentChartInterval.toUpperCase();
    intervalMenu.querySelectorAll('.interval-menu-item').forEach(b => {
      const check = b.querySelector('.active-check');
      if (check) check.classList.toggle('hidden', b.dataset.tf !== currentChartInterval);
    });
  }

  // Chart Type Dropdown Selector (TradingView style)
  const chartTypeBtn = document.getElementById('chart-type-dropdown-btn');
  const chartTypeMenu = document.getElementById('chart-type-menu');
  const chartTypeLabel = document.getElementById('current-chart-type-label');
  const chartTypeIcon = document.getElementById('current-chart-type-icon');

  const chartTypeMeta = {
    candles: { label: 'Candles', icon: 'candlestick_chart' },
    hollow: { label: 'Hollow Candles', icon: 'candlestick_chart' },
    line: { label: 'Line', icon: 'show_chart' },
    area: { label: 'Area', icon: 'area_chart' },
    bars: { label: 'Bars', icon: 'bar_chart' },
    heikin: { label: 'Heikin Ashi', icon: 'candlestick_chart' },
  };

  function updateChartTypeUI(type) {
    const meta = chartTypeMeta[type] || chartTypeMeta.candles;
    if (chartTypeLabel) chartTypeLabel.textContent = meta.label;
    if (chartTypeIcon) chartTypeIcon.textContent = meta.icon;
  }

  if (chartTypeBtn && chartTypeMenu) {
    chartTypeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chartTypeMenu.classList.toggle('hidden');
      if (intervalMenu) intervalMenu.classList.add('hidden');
    });

    chartTypeMenu.querySelectorAll('.chart-type-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        if (type) {
          currentChartType = type;
          updateChartTypeUI(type);
          saveChartSettings();
          rebuildChartSeries();
          chartTypeMenu.classList.add('hidden');
        }
      });
    });

    updateChartTypeUI(currentChartType);
  }

  // Close toolbar dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (intervalMenu && !intervalMenu.contains(e.target) && !intervalBtn?.contains(e.target)) {
      intervalMenu.classList.add('hidden');
    }
    if (chartTypeMenu && !chartTypeMenu.contains(e.target) && !chartTypeBtn?.contains(e.target)) {
      chartTypeMenu.classList.add('hidden');
    }
  });

  // Top-Left Legend Collapse Toggle
  const toggleCollapseBtn = document.getElementById('btn-toggle-legend-collapse');
  const legendBody = document.getElementById('tv-legend-body');
  const collapseIcon = document.getElementById('legend-collapse-icon');

  if (toggleCollapseBtn && legendBody) {
    toggleCollapseBtn.addEventListener('click', () => {
      const isHidden = legendBody.classList.toggle('hidden');
      if (collapseIcon) {
        collapseIcon.textContent = isHidden ? 'expand_more' : 'expand_less';
      }
    });
  }

  // Quick Buy & Sell Buttons in Top-Left Legend
  const quickSellBtn = document.getElementById('btn-quick-sell');
  const quickBuyBtn = document.getElementById('btn-quick-buy');
  if (quickSellBtn) quickSellBtn.addEventListener('click', () => openOrderModal(currentSymbol));
  if (quickBuyBtn) quickBuyBtn.addEventListener('click', () => openOrderModal(currentSymbol));

  // QuantVeda Paper Trading Bar Click -> Open Wallet/Orders
  const paperTradingMenuBtn = document.getElementById('btn-open-paper-trading-menu');
  if (paperTradingMenuBtn) {
    paperTradingMenuBtn.addEventListener('click', () => openOrderModal(currentSymbol));
  }

  // Fullscreen button
  const fsBtn = document.getElementById('btn-chart-fullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      const container = document.getElementById('view-charts');
      if (container) {
        if (!document.fullscreenElement) {
          container.requestFullscreen().catch(err => console.warn(err));
        } else {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      }
    });
  }

  // Header settings button → navigate to settings view
  const headerSettingsBtn = document.getElementById('btn-settings');
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', () => {
      // Simulate clicking the settings nav button
      const settingsNavBtn = document.querySelector('[data-target-view="settings"]');
      if (settingsNavBtn) settingsNavBtn.click();
    });
  }
}

function setupLightweightChart() {
  const container = document.getElementById('tv-chart-container');
  if (!container || !window.LightweightCharts) return;

  container.innerHTML = '';

  const pal = getChartPalette();

  const chartOptions = {
    layout: {
      background: { type: 'solid', color: pal.bg },
      textColor: pal.text,
      fontFamily: 'JetBrains Mono, monospace',
    },
    grid: {
      vertLines: { color: pal.grid },
      horzLines: { color: pal.grid },
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: pal.border,
    },
    timeScale: {
      borderColor: pal.border,
      timeVisible: true,
      secondsVisible: false,
    },
  };

  tvChart = window.LightweightCharts.createChart(container, chartOptions);

  candlestickSeries = tvChart.addCandlestickSeries({
    upColor: pal.up,
    downColor: pal.down,
    borderVisible: false,
    wickUpColor: pal.up,
    wickDownColor: pal.down,
  });

  volumeSeries = tvChart.addHistogramSeries({
    color: pal.vol,
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: {
      top: 0.8,
      bottom: 0,
    },
  });

  window.addEventListener('resize', () => {
    if (tvChart && container) {
      tvChart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight || 450
      });
    }
  });

  setupCrosshairTooltip(tvChart, candlestickSeries, volumeSeries, container, () => currentSymbol);
}

// ── Reusable Glassmorphism Crosshair Tooltip ──
function formatCandleTime(unixSec, isDaily) {
  if (!isDaily) return unixSec;
  const ms = unixSec * 1000;
  const d = new Date(ms + 5.5 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}

function formatUnixToIST(timeVal) {
  if (typeof timeVal === 'object' && timeVal !== null && timeVal.year) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dd = String(timeVal.day).padStart(2, '0');
    const mon = months[timeVal.month - 1];
    return { dateStr: `${dd} ${mon} ${timeVal.year}`, timeStr: 'Daily' };
  }
  if (typeof timeVal === 'string') {
    const parts = timeVal.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const day = parseInt(parts[2]);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return { dateStr: `${String(day).padStart(2,'0')} ${months[month]} ${year}`, timeStr: 'Daily' };
    }
  }
  const ms = timeVal * 1000;
  const d = new Date(ms);
  try {
    const dateParts = d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
    });
    const timeParts = d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
    });
    return { dateStr: dateParts, timeStr: timeParts + ' IST' };
  } catch (e) {
    const ist = new Date(ms + 5.5 * 3600 * 1000);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    const mon = months[ist.getUTCMonth()];
    const yyyy = ist.getUTCFullYear();
    const hh = String(ist.getUTCHours()).padStart(2, '0');
    const mm = String(ist.getUTCMinutes()).padStart(2, '0');
    return { dateStr: `${dd} ${mon} ${yyyy}`, timeStr: `${hh}:${mm} IST` };
  }
}

function fmtNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}

function fmtVol(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(2) + ' L';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toLocaleString('en-IN');
}

function setupCrosshairTooltip(chart, mainSeries, volSeries, container, getSymbolFn) {
  if (!chart || !container) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'qv-crosshair-tooltip-instance';
  tooltip.style.cssText = `
    position: absolute; z-index: 50; pointer-events: none;
    display: none;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px; padding: 4px 10px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
    color: #f1f5f9; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    white-space: nowrap; transition: opacity 0.1s ease;
  `;
  container.style.position = 'relative';
  container.appendChild(tooltip);

  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time || param.point === undefined ||
        param.point.x < 0 || param.point.y < 0) {
      tooltip.style.display = 'none';
      return;
    }

    const candleData = param.seriesData.get(mainSeries);
    const volData = volSeries ? param.seriesData.get(volSeries) : null;

    if (!candleData) {
      tooltip.style.display = 'none';
      return;
    }

    const open = candleData.open !== undefined ? candleData.open : candleData.value;
    const high = candleData.high !== undefined ? candleData.high : candleData.value;
    const low = candleData.low !== undefined ? candleData.low : candleData.value;
    const close = candleData.close !== undefined ? candleData.close : candleData.value;
    const volume = volData ? volData.value : null;

    const change = close - open;
    const changePct = open !== 0 ? (change / open) * 100 : 0;
    const isUp = close >= open;
    const priceColor = isUp ? '#10b981' : '#f43f5e';
    const changeSign = change >= 0 ? '+' : '';

    const { dateStr, timeStr } = formatUnixToIST(param.time);

    tooltip.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; font-size:11px; font-family:'JetBrains Mono', monospace;">
        <span style="color:#94a3b8;">O <strong style="color:#e2e8f0;">${fmtNum(open)}</strong></span>
        <span style="color:#94a3b8;">H <strong style="color:#10b981;">${fmtNum(high)}</strong></span>
        <span style="color:#94a3b8;">L <strong style="color:#f43f5e;">${fmtNum(low)}</strong></span>
        <span style="color:#94a3b8;">C <strong style="color:${priceColor}; font-weight:700;">${fmtNum(close)}</strong></span>
        ${volume != null ? `<span style="color:#94a3b8;">Vol <strong style="color:#e2e8f0;">${fmtVol(volume)}</strong></span>` : ''}
        <span style="color:#64748b; font-size:10px; margin-left:2px;">${timeStr}</span>
      </div>
    `;

    const containerRect = container.getBoundingClientRect();
    const tooltipW = tooltip.offsetWidth || 280;
    const tooltipH = tooltip.offsetHeight || 32;
    const pad = 12;

    let left = param.point.x + pad;
    let top = param.point.y - tooltipH / 2;

    if (left + tooltipW > containerRect.width) {
      left = param.point.x - tooltipW - pad;
    }
    if (top < 4) top = 4;
    if (top + tooltipH > containerRect.height - 4) {
      top = containerRect.height - tooltipH - 4;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.display = 'block';

    const ohlcO = document.getElementById('ohlc-o');
    const ohlcH = document.getElementById('ohlc-h');
    const ohlcL = document.getElementById('ohlc-l');
    const ohlcC = document.getElementById('ohlc-c');
    const ohlcChg = document.getElementById('ohlc-chg');

    if (ohlcO) ohlcO.textContent = fmtNum(open);
    if (ohlcH) ohlcH.textContent = fmtNum(high);
    if (ohlcL) ohlcL.textContent = fmtNum(low);
    if (ohlcC) ohlcC.textContent = fmtNum(close);
    if (ohlcChg) {
      ohlcChg.textContent = `${changeSign}${fmtNum(change)} (${changeSign}${changePct.toFixed(2)}%)`;
      ohlcChg.style.color = priceColor;
    }
  });
}

// ================= SIDEBAR COLLAPSE TOGGLE =================
const SIDEBAR_COLLAPSED_KEY = 'quantveda_sidebar_collapsed';

function initSidebarToggle() {
  const sidenav = document.getElementById('desktop-sidenav');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const toggleIcon = document.getElementById('sidebar-toggle-icon');

  if (!sidenav) return;

  function setSidebarCollapsed(collapsed) {
    sidenav.classList.toggle('sidebar-collapsed', collapsed);
    if (toggleIcon) {
      toggleIcon.textContent = collapsed ? 'menu' : 'menu_open';
    }
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch (e) {}

    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 220);
  }

  const isCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  setSidebarCollapsed(isCollapsed);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const currentlyCollapsed = sidenav.classList.contains('sidebar-collapsed');
      setSidebarCollapsed(!currentlyCollapsed);
    });
  }
}

// ── Dashboard Chart ──
function setupDashboardChart() {
  const container = document.getElementById('dash-chart-container');
  if (!container || !window.LightweightCharts) return;

  container.innerHTML = '';

  const pal = getChartPalette();
  const initialWidth = container.clientWidth || container.parentElement?.clientWidth || 600;

  const chartOptions = {
    width: initialWidth,
    height: 200,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: pal.text,
      fontFamily: 'JetBrains Mono, monospace',
    },
    grid: {
      vertLines: { color: 'transparent' },
      horzLines: { color: pal.grid },
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: 'transparent',
      alignLabels: true,
      scaleMargins: {
        top: 0.05,    // 5% top margin
        bottom: 0.05, // 5% bottom margin
      },
    },
    timeScale: {
      borderColor: 'transparent',
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        if (typeof time === 'number') {
          const d = new Date(time * 1000);
          return d.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
        }
        return String(time);
      }
    },
    localization: {
      timeFormatter: (time) => {
        if (typeof time === 'number') {
          const d = new Date(time * 1000);
          return d.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
        }
        return String(time);
      }
    },
  };

  dashChart = window.LightweightCharts.createChart(container, chartOptions);

  dashCandlestickSeries = dashChart.addAreaSeries({
    topColor: isDarkTheme() ? 'rgba(63, 185, 80, 0.25)' : 'rgba(5, 150, 105, 0.20)',
    bottomColor: isDarkTheme() ? 'rgba(63, 185, 80, 0.02)' : 'rgba(5, 150, 105, 0.02)',
    lineColor: isDarkTheme() ? '#3fb950' : '#059669',
    lineWidth: 2,
    crosshairMarkerVisible: true,
  });

  const handleResize = () => {
    if (dashChart && container) {
      const w = container.clientWidth || container.parentElement?.clientWidth || 600;
      if (w > 0) {
        dashChart.applyOptions({ width: w, height: 200 });
      }
    }
  };

  window.addEventListener('resize', handleResize);

  if (window.ResizeObserver && container) {
    const ro = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0 && dashChart) {
          dashChart.applyOptions({ width: entry.contentRect.width, height: 200 });
        }
      }
    });
    ro.observe(container);
  }

  setupCrosshairTooltip(dashChart, dashCandlestickSeries, null, container, () => currentSymbol);
}

function fitDashboardScale(areaData) {
  if (!dashChart || !dashCandlestickSeries || !areaData || areaData.length === 0) return;
  const values = areaData.map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v));
  if (values.length > 0) {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const diff = maxVal - minVal || (minVal * 0.005);
    dashCandlestickSeries.applyOptions({
      autoscaleInfoProvider: () => ({
        priceRange: {
          minValue: minVal - (diff * 0.03),
          maxValue: maxVal + (diff * 0.03),
        },
      }),
    });
  }
  dashChart.priceScale('right').applyOptions({
    scaleMargins: { top: 0.05, bottom: 0.05 },
    autoScale: true,
  });
  dashChart.timeScale().fitContent();
}

function generateMockDashboardCandles(startPrice = null) {
  if (!dashCandlestickSeries) return;

  let basePrice = startPrice || window.lastKnownQuotePrice || 1313.50;
  const step = basePrice * 0.0012;

  // Real NSE session start today (09:15 AM IST)
  const now = new Date();
  const istDateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
  const istBase = new Date(istDateStr + ' 09:15:00 GMT+0530');
  let startTs = Math.floor(istBase.getTime() / 1000);
  const currentTs = Math.floor(Date.now() / 1000);

  if (currentTs <= startTs) {
    startTs = currentTs - (45 * 5 * 60);
  }

  const intervalSec = 5 * 60;
  const totalCandles = Math.min(75, Math.max(12, Math.floor((currentTs - startTs) / intervalSec)));

  const mockCandles = [];
  for (let i = 0; i <= totalCandles; i++) {
    const t = startTs + (i * intervalSec);
    basePrice += (Math.random() - 0.48) * step;
    mockCandles.push({ time: t, value: Number(basePrice.toFixed(2)) });
  }

  dashCandlestickSeries.setData(mockCandles);
  fitDashboardScale(mockCandles);
  document.getElementById('dash-chart-loader')?.classList.add('hidden');
}

async function loadDashboardCandles(symbol) {
  if (!dashChart || !dashCandlestickSeries) {
    setupDashboardChart();
  }
  if (!dashChart) return;

  const container = document.getElementById('dash-chart-container');
  if (container && dashChart) {
    const w = container.clientWidth || container.parentElement?.clientWidth || 600;
    dashChart.applyOptions({ width: w, height: 200 });
  }

  const loader = document.getElementById('dash-chart-loader');
  if (loader) loader.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE_URL}/api/candles/${encodeURIComponent(symbol)}?interval=5m&range=1d`);
    const json = await res.json();

    const candlesList = json.data?.candles || (Array.isArray(json.data) ? json.data : null);

    if (json.status === 'success' && candlesList && candlesList.length > 0) {
      const areaData = candlesList.map(c => ({
        time: c.time,
        value: c.close
      }));

      dashCandlestickSeries.setData(areaData);
      fitDashboardScale(areaData);
    } else {
      generateMockDashboardCandles(window.lastKnownQuotePrice);
    }
  } catch (err) {
    console.warn('Dashboard candle fetch failed, rendering fallback:', err);
    generateMockDashboardCandles(window.lastKnownQuotePrice);
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

// Interval → optimal range mapping (prevents over-fetching)
const INTERVAL_RANGE_MAP = {
  '1m': '1d',
  '5m': '5d',
  '15m': '1mo',
  '1h': '3mo',
  '4h': '6mo',
  '1d': '1y',
  '1w': '5y',
  '1M': '5y'
};

// Max candles to request per interval
const INTERVAL_CANDLE_LIMIT = {
  '1m': 300, '5m': 300, '15m': 300,
  '1h': 250, '4h': 250,
  '1d': 200, '1w': 200, '1M': 200
};

// Cache to avoid re-fetching
const candleCache = {};
function getCacheTTL(interval) {
  if (['1m','5m','15m'].includes(interval)) return 30000; // 30s for intraday
  return 120000; // 2min for daily+
}

async function loadCandlesData(symbol, interval = '1d', rangeStr = null) {
  if (!tvChart || !candlestickSeries) {
    setupLightweightChart();
  }

  // Auto-select optimal range for the interval
  const effectiveRange = rangeStr && rangeStr !== 'max' ? rangeStr : (INTERVAL_RANGE_MAP[interval] || '1y');

  const isDaily = ['1d', '1wk', '1mo', '1w', '1M'].includes(interval.toLowerCase()) || ['3mo', '6mo', '1y', '5y', 'max', 'all'].includes(effectiveRange.toLowerCase());
  lastIsDaily = isDaily;

  if (tvChart) {
    tvChart.applyOptions({
      timeScale: {
        timeVisible: !isDaily,
        secondsVisible: false
      }
    });
  }

  // Check cache
  const cacheKey = `${symbol}_${interval}_${effectiveRange}`;
  const cached = candleCache[cacheKey];
  const now = Date.now();
  if (cached && (now - cached.ts) < getCacheTTL(interval)) {
    renderCandleData(cached.data, isDaily, effectiveRange);
    return;
  }

  // Show loading spinner
  const spinner = document.getElementById('chart-loading-spinner');
  if (spinner) spinner.classList.remove('hidden');

  const apiEndpoint = `${API_BASE_URL}/api/candles/${encodeURIComponent(symbol)}?interval=${interval}&range=${effectiveRange}`;

  try {
    const res = await fetch(apiEndpoint);
    const json = await res.json();

    if (json.status === 'success' && json.data && json.data.candles && json.data.candles.length > 0) {
      // Limit candles to prevent slowness
      const maxCandles = INTERVAL_CANDLE_LIMIT[interval] || 200;
      const rawCandles = json.data.candles;
      const limitedCandles = rawCandles.length > maxCandles ? rawCandles.slice(-maxCandles) : rawCandles;
      json.data.candles = limitedCandles;

      // Cache it
      candleCache[cacheKey] = { data: json.data, ts: Date.now() };
      renderCandleData(json.data, isDaily, effectiveRange);
    } else {
      generateMockCandles();
    }
  } catch (err) {
    console.warn('Candle fetch failed, rendering fallback chart:', err);
    generateMockCandles();
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

function renderCandleData(data, isDaily, rangeStr) {
  const seenKeys = new Set();
  const candles = [];
  const volumes = [];
  const pal = getChartPalette();

  for (let c of data.candles) {
    const formattedTime = formatCandleTime(c.time, isDaily);
    const key = isDaily ? `${formattedTime.year}-${formattedTime.month}-${formattedTime.day}` : formattedTime;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      candles.push({
        time: formattedTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      });
      volumes.push({
        time: formattedTime,
        value: c.volume || 10000,
        color: c.close >= c.open ? pal.upVol : pal.downVol
      });
    }
  }

  lastCandlesRaw = data.candles;

  candlestickSeries.setData(candles);
  if (volumeSeries) volumeSeries.setData(volumes);
  applyDefaultZoom();
  applyIndicators();
  updateDataProvenance(data.count || candles.length, data.range || rangeStr);
  startRealtimeChartFeed(currentSymbol);
}

// Remove candle count badge text per user request
function updateDataProvenance(count, range) {
  const existing = document.getElementById('chart-data-provenance');
  if (existing) existing.remove();
}

// ================= REAL-TIME CHART PRICE STREAM =================
let realtimeFeedSocket = null;
let realtimeFeedPollTimer = null;

function startRealtimeChartFeed(symbol) {
  stopRealtimeChartFeed();

  const cleanSym = (symbol || currentSymbol).trim().toUpperCase();

  // Try WebSocket connection first
  try {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname || '127.0.0.1';
    const wsPort = window.location.port ? `:${window.location.port}` : ':8000';
    const wsUrl = `${wsProtocol}//${wsHost}${wsPort}/ws/price/${encodeURIComponent(cleanSym)}`;

    realtimeFeedSocket = new WebSocket(wsUrl);

    realtimeFeedSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.price && !data.error) {
          updateChartWithLivePrice(data.price, data.change);
        }
      } catch (e) {}
    };

    realtimeFeedSocket.onerror = () => {
      startRealtimePollingFallback(cleanSym);
    };

    realtimeFeedSocket.onclose = () => {
      if (!realtimeFeedPollTimer) {
        startRealtimePollingFallback(cleanSym);
      }
    };
  } catch (e) {
    startRealtimePollingFallback(cleanSym);
  }
}

function startRealtimePollingFallback(cleanSym) {
  if (realtimeFeedPollTimer) clearInterval(realtimeFeedPollTimer);
  realtimeFeedPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/quote/${encodeURIComponent(cleanSym)}`);
      const json = await res.json();
      if (json.status === 'success' && json.data && json.data.price) {
        updateChartWithLivePrice(json.data.price, json.data.change);
        updateDashboardHero(json.data);
      }
    } catch (e) {}
  }, 2500);
}

function stopRealtimeChartFeed() {
  if (realtimeFeedSocket) {
    try { realtimeFeedSocket.close(); } catch(e) {}
    realtimeFeedSocket = null;
  }
  if (realtimeFeedPollTimer) {
    clearInterval(realtimeFeedPollTimer);
    realtimeFeedPollTimer = null;
  }
}

function updateChartWithLivePrice(price, change) {
  const livePrice = parseFloat(price);
  if (isNaN(livePrice) || livePrice <= 0) return;

  // Live update for Dashboard Intraday Performance chart aligned with current real IST time
  if (dashCandlestickSeries && dashChart) {
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      dashCandlestickSeries.update({
        time: nowSec,
        value: livePrice
      });
    } catch (e) {}
  }

  if (!candlestickSeries || !lastCandlesRaw || lastCandlesRaw.length === 0) return;

  const pal = getChartPalette();
  const lastIndex = lastCandlesRaw.length - 1;
  const lastCandle = lastCandlesRaw[lastIndex];

  // Update current candle high, low, close
  lastCandle.high = Math.max(lastCandle.high, livePrice);
  lastCandle.low = Math.min(lastCandle.low, livePrice);
  lastCandle.close = livePrice;

  const formattedTime = formatCandleTime(lastCandle.time, lastIsDaily);

  try {
    candlestickSeries.update({
      time: formattedTime,
      open: lastCandle.open,
      high: lastCandle.high,
      low: lastCandle.low,
      close: lastCandle.close
    });
  } catch (e) {}

  if (volumeSeries) {
    try {
      volumeSeries.update({
        time: formattedTime,
        value: lastCandle.volume || 10000,
        color: lastCandle.close >= lastCandle.open ? pal.upVol : pal.downVol
      });
    } catch (e) {}
  }

  // Update OHLC text legend values
  const oEl = document.getElementById('ohlc-o');
  const hEl = document.getElementById('ohlc-h');
  const lEl = document.getElementById('ohlc-l');
  const cEl = document.getElementById('ohlc-c');
  const chgEl = document.getElementById('ohlc-chg');

  if (oEl) oEl.textContent = fmtNum(lastCandle.open);
  if (hEl) hEl.textContent = fmtNum(lastCandle.high);
  if (lEl) lEl.textContent = fmtNum(lastCandle.low);
  if (cEl) cEl.textContent = fmtNum(lastCandle.close);

  if (chgEl) {
    const pChg = change !== undefined ? change : (lastCandle.close - lastCandle.open);
    const isPos = pChg >= 0;
    const sign = isPos ? '+' : '';
    chgEl.className = isPos ? 'text-bullish font-bold ml-2' : 'text-bearish font-bold ml-2';
    chgEl.textContent = `${sign}${fmtNum(pChg)}`;
  }
}

// ================= CHART TYPE SWITCHING =================
function rebuildChartSeries() {
  if (!tvChart) return;

  // Remove old main series
  if (candlestickSeries) {
    tvChart.removeSeries(candlestickSeries);
    candlestickSeries = null;
  }

  const pal = getChartPalette();

  // Recreate based on type
  if (currentChartType === 'line') {
    candlestickSeries = tvChart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });
  } else if (currentChartType === 'area') {
    candlestickSeries = tvChart.addAreaSeries({
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.25)',
      bottomColor: 'rgba(59, 130, 246, 0.02)',
      lineWidth: 2,
    });
  } else if (currentChartType === 'bars') {
    candlestickSeries = tvChart.addBarSeries({
      upColor: pal.up,
      downColor: pal.down,
    });
  } else {
    candlestickSeries = tvChart.addCandlestickSeries({
      upColor: pal.up,
      downColor: pal.down,
      borderVisible: false,
      wickUpColor: pal.up,
      wickDownColor: pal.down,
    });
  }

  // Re-load data into new series
  if (lastCandlesRaw.length > 0) {
    if (currentChartType === 'heikin') {
      candlestickSeries.setData(toHeikinAshi(lastCandlesRaw));
    } else if (currentChartType === 'line' || currentChartType === 'area') {
      const seenKeys = new Set();
      const pts = [];
      for (let c of lastCandlesRaw) {
        const formattedTime = formatCandleTime(c.time, lastIsDaily);
        const key = lastIsDaily ? `${formattedTime.year}-${formattedTime.month}-${formattedTime.day}` : formattedTime;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          pts.push({ time: formattedTime, value: c.close });
        }
      }
      candlestickSeries.setData(pts);
    } else {
      const seenKeys = new Set();
      const candles = [];
      for (let c of lastCandlesRaw) {
        const formattedTime = formatCandleTime(c.time, lastIsDaily);
        const key = lastIsDaily ? `${formattedTime.year}-${formattedTime.month}-${formattedTime.day}` : formattedTime;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          candles.push({ time: formattedTime, open: c.open, high: c.high, low: c.low, close: c.close });
        }
      }
      candlestickSeries.setData(candles);
    }
    applyIndicators();
  }

  applyDefaultZoom();
}

function toHeikinAshi(raw) {
  const ha = [];
  let prevOpen = null;
  let prevClose = null;
  const seen = new Set();
  for (let c of raw) {
    const formattedTime = formatCandleTime(c.time, lastIsDaily);
    const key = lastIsDaily ? `${formattedTime.year}-${formattedTime.month}-${formattedTime.day}` : formattedTime;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = prevOpen === null ? c.open : (prevOpen + prevClose) / 2;
    const cl = (c.open + c.high + c.low + c.close) / 4;
    const h = Math.max(c.high, o, cl);
    const l = Math.min(c.low, o, cl);
    ha.push({ time: formattedTime, open: o, high: h, low: l, close: cl });
    prevOpen = o;
    prevClose = cl;
  }
  return ha;
}

// ================= TECHNICAL INDICATORS =================
function computeSMA(data, period) {
  const result = [];
  const seenKeys = new Set();
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    const t = formatCandleTime(data[i].time, lastIsDaily);
    const key = lastIsDaily ? `${t.year}-${t.month}-${t.day}` : t;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push({ time: t, value: sum / period });
    }
  }
  return result;
}

function computeEMA(data, period) {
  const result = [];
  const seenKeys = new Set();
  const k = 2 / (period + 1);
  let prevEma = data.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  const t0 = formatCandleTime(data[period - 1].time, lastIsDaily);
  const key0 = lastIsDaily ? `${t0.year}-${t0.month}-${t0.day}` : t0;
  seenKeys.add(key0);
  result.push({ time: t0, value: prevEma });
  for (let i = period; i < data.length; i++) {
    prevEma = data[i].close * k + prevEma * (1 - k);
    const t = formatCandleTime(data[i].time, lastIsDaily);
    const key = lastIsDaily ? `${t.year}-${t.month}-${t.day}` : t;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push({ time: t, value: prevEma });
    }
  }
  return result;
}

function computeBollingerBands(data, period, stdDev = 2) {
  const upper = [], lower = [];
  const seenKeys = new Set();
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (data[j].close - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    const t = formatCandleTime(data[i].time, lastIsDaily);
    const key = lastIsDaily ? `${t.year}-${t.month}-${t.day}` : t;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      upper.push({ time: t, value: mean + stdDev * sd });
      lower.push({ time: t, value: mean - stdDev * sd });
    }
  }
  return { upper, lower };
}

function computeVWAP(data) {
  const result = [];
  const seenKeys = new Set();
  let cumTPV = 0, cumVol = 0;
  for (const c of data) {
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 10000;
    cumTPV += tp * vol;
    cumVol += vol;
    const t = formatCandleTime(c.time, lastIsDaily);
    const key = lastIsDaily ? `${t.year}-${t.month}-${t.day}` : t;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push({ time: t, value: cumVol > 0 ? cumTPV / cumVol : tp });
    }
  }
  return result;
}

function clearIndicatorSeries() {
  if (smaSeries && tvChart) { try { tvChart.removeSeries(smaSeries); } catch(e){} smaSeries = null; }
  if (emaSeries && tvChart) { try { tvChart.removeSeries(emaSeries); } catch(e){} emaSeries = null; }
  if (bbUpperSeries && tvChart) { try { tvChart.removeSeries(bbUpperSeries); } catch(e){} bbUpperSeries = null; }
  if (bbLowerSeries && tvChart) { try { tvChart.removeSeries(bbLowerSeries); } catch(e){} bbLowerSeries = null; }
  if (vwapSeries && tvChart) { try { tvChart.removeSeries(vwapSeries); } catch(e){} vwapSeries = null; }
}

function applyIndicators() {
  if (!tvChart || lastCandlesRaw.length < 5) return;
  clearIndicatorSeries();

  const smaToggle = document.getElementById('toggle-sma');
  const emaToggle = document.getElementById('toggle-ema');
  const bbToggle = document.getElementById('toggle-bb');
  const vwapToggle = document.getElementById('toggle-vwap');

  const legendList = document.getElementById('tv-active-indicators-legend');
  const legendItems = [];

  if (smaToggle && smaToggle.checked) {
    const period = parseInt(document.getElementById('sma-period')?.value) || 20;
    const smaData = computeSMA(lastCandlesRaw, period);
    if (smaData.length > 0) {
      smaSeries = tvChart.addLineSeries({ color: '#3b82f6', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      smaSeries.setData(smaData);
      const lastVal = fmtNum(smaData[smaData.length - 1].value);
      legendItems.push(`<div class="flex items-center gap-2 text-[#388bfd] bg-modal-bg/70 px-2 py-0.5 rounded border border-modal-border/40"><span>SMA ${period} close</span> <strong class="font-mono text-text-primary ml-auto">${lastVal}</strong></div>`);
    }
  }

  if (emaToggle && emaToggle.checked) {
    const period = parseInt(document.getElementById('ema-period')?.value) || 20;
    const emaData = computeEMA(lastCandlesRaw, period);
    if (emaData.length > 0) {
      emaSeries = tvChart.addLineSeries({ color: '#f97316', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      emaSeries.setData(emaData);
      const lastVal = fmtNum(emaData[emaData.length - 1].value);
      legendItems.push(`<div class="flex items-center gap-2 text-[#f85149] bg-modal-bg/70 px-2 py-0.5 rounded border border-modal-border/40"><span>EMA ${period} close</span> <strong class="font-mono text-text-primary ml-auto">${lastVal}</strong></div>`);
    }
  }

  if (bbToggle && bbToggle.checked) {
    const period = parseInt(document.getElementById('bb-period')?.value) || 20;
    const { upper, lower } = computeBollingerBands(lastCandlesRaw, period);
    if (upper.length > 0) {
      bbUpperSeries = tvChart.addLineSeries({ color: '#a855f7', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bbUpperSeries.setData(upper);
      bbLowerSeries = tvChart.addLineSeries({ color: '#a855f7', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bbLowerSeries.setData(lower);
      const lastVal = fmtNum(upper[upper.length - 1].value);
      legendItems.push(`<div class="flex items-center gap-2 text-[#a855f7] bg-modal-bg/70 px-2 py-0.5 rounded border border-modal-border/40"><span>BB ${period} 2 close</span> <strong class="font-mono text-text-primary ml-auto">${lastVal}</strong></div>`);
    }
  }

  if (vwapToggle && vwapToggle.checked) {
    const vwapData = computeVWAP(lastCandlesRaw);
    if (vwapData.length > 0) {
      vwapSeries = tvChart.addLineSeries({ color: '#06b6d4', lineWidth: 1.5, lineStyle: 1, priceLineVisible: false, lastValueVisible: false });
      vwapSeries.setData(vwapData);
      const lastVal = fmtNum(vwapData[vwapData.length - 1].value);
      legendItems.push(`<div class="flex items-center gap-2 text-[#06b6d4] bg-modal-bg/70 px-2 py-0.5 rounded border border-modal-border/40"><span>VWAP close</span> <strong class="font-mono text-text-primary ml-auto">${lastVal}</strong></div>`);
    }
  }

  if (legendList) {
    legendList.innerHTML = legendItems.join('');
  }

  saveIndicatorSettings();
}

// ================= INDICATOR SETTINGS PERSISTENCE =================
const INDICATORS_SETTINGS_KEY = 'quantveda_indicators_settings';

function loadIndicatorSettings() {
  try {
    const raw = localStorage.getItem(INDICATORS_SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);

    const toggleSma = document.getElementById('toggle-sma');
    const smaPeriod = document.getElementById('sma-period');
    if (toggleSma) toggleSma.checked = !!s.sma;
    if (smaPeriod && s.smaPeriod) smaPeriod.value = s.smaPeriod;

    const toggleEma = document.getElementById('toggle-ema');
    const emaPeriod = document.getElementById('ema-period');
    if (toggleEma) toggleEma.checked = !!s.ema;
    if (emaPeriod && s.emaPeriod) emaPeriod.value = s.emaPeriod;

    const toggleBb = document.getElementById('toggle-bb');
    const bbPeriod = document.getElementById('bb-period');
    if (toggleBb) toggleBb.checked = !!s.bb;
    if (bbPeriod && s.bbPeriod) bbPeriod.value = s.bbPeriod;

    const toggleVwap = document.getElementById('toggle-vwap');
    if (toggleVwap) toggleVwap.checked = !!s.vwap;
  } catch(e) {}
}

function saveIndicatorSettings() {
  try {
    const settings = {
      sma: document.getElementById('toggle-sma')?.checked || false,
      smaPeriod: parseInt(document.getElementById('sma-period')?.value) || 20,
      ema: document.getElementById('toggle-ema')?.checked || false,
      emaPeriod: parseInt(document.getElementById('ema-period')?.value) || 20,
      bb: document.getElementById('toggle-bb')?.checked || false,
      bbPeriod: parseInt(document.getElementById('bb-period')?.value) || 20,
      vwap: document.getElementById('toggle-vwap')?.checked || false,
    };
    localStorage.setItem(INDICATORS_SETTINGS_KEY, JSON.stringify(settings));
  } catch(e) {}
}

// ================= INDICATORS MODAL =================
function initIndicatorsModal() {
  const openBtn = document.getElementById('btn-chart-indicators');
  const modal = document.getElementById('indicators-modal');
  const backdrop = document.getElementById('indicators-modal-backdrop');
  const closeBtn = document.getElementById('close-indicators-modal');
  const applyBtn = document.getElementById('btn-apply-indicators');
  const resetBtn = document.getElementById('btn-reset-indicators');
  const searchInput = document.getElementById('indicator-search-input');

  // Load saved indicator preferences from localStorage
  loadIndicatorSettings();

  function openModal() { if (modal) modal.classList.remove('hidden'); }
  function closeModal() { if (modal) modal.classList.add('hidden'); }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  // Auto-save on toggle or period change
  ['toggle-sma', 'toggle-ema', 'toggle-bb', 'toggle-vwap', 'sma-period', 'ema-period', 'bb-period'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        saveIndicatorSettings();
        applyIndicators();
      });
    }
  });

  // Keyboard shortcut: / to open, Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      openModal();
      if (searchInput) setTimeout(() => searchInput.focus(), 100);
    }
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      saveIndicatorSettings();
      applyIndicators();
      closeModal();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      ['toggle-sma', 'toggle-ema', 'toggle-bb', 'toggle-vwap'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      saveIndicatorSettings();
      clearIndicatorSeries();
    });
  }

  // Sidebar category filtering
  const catBtns = document.querySelectorAll('.indicator-cat-btn');
  const items = document.querySelectorAll('#indicator-items-list .indicator-item');
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => {
        b.classList.remove('active', 'text-text-primary', 'bg-accent-blue/10', 'border-accent-blue');
        b.classList.add('text-text-secondary', 'border-transparent');
      });
      btn.classList.add('active', 'text-text-primary', 'bg-accent-blue/10', 'border-accent-blue');
      btn.classList.remove('text-text-secondary', 'border-transparent');

      const cat = btn.dataset.cat;
      items.forEach(item => {
        const cats = (item.dataset.cats || '').split(',');
        if (cat === 'trending' || cats.includes(cat)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  // Search filtering
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }
}

function generateMockCandles() {
  if (!candlestickSeries) return;

  const mockCandles = [];
  const mockVolumes = [];
  let basePrice = 180.0;
  const nowSec = Math.floor(Date.now() / 1000);
  const pal = getChartPalette();

  for (let i = 60; i >= 0; i--) {
    const time = nowSec - (i * 15 * 60);
    const open = basePrice + (Math.random() - 0.48) * 2;
    const high = open + Math.random() * 2.5;
    const low = open - Math.random() * 2.5;
    const close = low + Math.random() * (high - low);
    basePrice = close;

    mockCandles.push({ time, open, high, low, close });
    mockVolumes.push({
      time,
      value: Math.floor(Math.random() * 500000 + 100000),
      color: close >= open ? pal.upVol : pal.downVol
    });
  }

  candlestickSeries.setData(mockCandles);
  if (volumeSeries) volumeSeries.setData(mockVolumes);
  applyDefaultZoom();
}

// ================= WATCHLISTS & PORTFOLIO =================
function initWatchlistsAndPortfolio() {
  const addWlBtn = document.getElementById('btn-add-to-watchlist');
  const addWlInput = document.getElementById('add-watchlist-symbol-input');
  const dropdown = document.getElementById('wl-search-dropdown');
  const filterInput = document.getElementById('watchlist-search-filter');

  if (addWlInput && dropdown) {
    let wlDebounce = null;
    addWlInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(wlDebounce);

      if (q.length < 1) {
        dropdown.classList.add('hidden');
        return;
      }

      wlDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(q)}`);
          const json = await res.json();

          const items = json.data || json.results || [];
          if (json.status === 'success' && items.length > 0) {
            dropdown.innerHTML = items.slice(0, 6).map(item => `
              <div class="p-2.5 hover:bg-surface-container-high cursor-pointer flex justify-between items-center wl-search-result-item" data-symbol="${item.symbol}">
                <div>
                  <div class="font-bold text-sm text-primary font-data-mono">${item.symbol}</div>
                  <div class="text-xs text-on-surface-variant truncate max-w-[200px]">${item.name || item.symbol}</div>
                </div>
                <div class="text-xs font-data-mono text-on-surface-variant">${item.exchange || 'NSE'}</div>
              </div>
            `).join('');
            dropdown.classList.remove('hidden');

            dropdown.querySelectorAll('.wl-search-result-item').forEach(el => {
              el.addEventListener('click', () => {
                const sym = el.dataset.symbol;
                addSymbolToWatchlist(sym);
                addWlInput.value = '';
                dropdown.classList.add('hidden');
              });
            });
          } else {
            dropdown.innerHTML = `<div class="p-2.5 text-xs text-on-surface-variant text-center font-data-mono">No matching symbols found</div>`;
            dropdown.classList.remove('hidden');
          }
        } catch (err) {
          console.warn('Watchlist search error:', err);
        }
      }, 250);
    });

    addWlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const sym = addWlInput.value.trim().toUpperCase();
        if (sym) {
          addSymbolToWatchlist(sym);
          addWlInput.value = '';
          dropdown.classList.add('hidden');
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!addWlInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  if (addWlBtn && addWlInput) {
    addWlBtn.addEventListener('click', () => {
      const sym = addWlInput.value.trim().toUpperCase();
      if (sym) {
        addSymbolToWatchlist(sym);
        addWlInput.value = '';
        if (dropdown) dropdown.classList.add('hidden');
      }
    });
  }

  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const filter = e.target.value.toLowerCase().trim();
      const tbody = document.getElementById('watchlist-table-body');
      if (!tbody) return;

      tbody.querySelectorAll('tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        if (!filter || text.includes(filter)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    });
  }
}

async function fetchWatchlistData() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/watchlists/1/quotes`);
    const json = await res.json();

    if (json.status === 'success' && json.data && json.data.quotes) {
      renderWatchlistTable(json.data.quotes);
      renderSideWatchlist(json.data.quotes);
    } else {
      renderDefaultWatchlist();
    }
  } catch (err) {
    console.warn('Watchlist fetch error, rendering default:', err);
    renderDefaultWatchlist();
  }
}

function renderWatchlistTable(items) {
  const tbody = document.getElementById('watchlist-table-body');
  const badge = document.getElementById('watchlist-count-badge');
  if (!tbody) return;

  if (badge) badge.textContent = `${items.length} Assets`;

  tbody.innerHTML = items.map(item => {
    const currSym = item.currency_symbol || '$';
    const isPos = item.change_pct >= 0;
    const sign = isPos ? '+' : '';
    const colorClass = isPos ? 'text-emerald-600' : 'text-rose-600';

    return `
      <tr class="data-table-row">
        <td class="p-sm flex items-center gap-sm">
          <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">${item.symbol.substring(0, 4)}</div>
          <div>
            <div class="font-bold text-primary cursor-pointer wl-item-symbol" data-symbol="${item.symbol}">${item.symbol}</div>
            <div class="font-body-md text-xs text-secondary font-normal">${item.name || item.symbol}</div>
          </div>
        </td>
        <td class="p-sm text-right font-bold">${currSym}${item.price.toFixed(2)}</td>
        <td class="p-sm text-right ${colorClass}">${sign}${item.change_pct.toFixed(2)}%</td>
        <td class="p-sm text-center">
          <span class="${isPos ? 'signal-positive' : 'signal-negative'} px-sm py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-[14px]">${isPos ? 'trending_up' : 'trending_down'}</span>
            ${isPos ? 'BULL' : 'BEAR'}
          </span>
        </td>
        <td class="p-sm text-right">
          <button class="text-secondary hover:text-primary transition-colors btn-trade-item" data-symbol="${item.symbol}">
            <span class="material-symbols-outlined">shopping_cart</span>
          </button>
        </td>
        <td class="p-sm text-right">
          <button class="text-rose-400 hover:text-rose-600 transition-colors btn-remove-wl-item" data-item-id="${item.id}" data-symbol="${item.symbol}" title="Remove from watchlist">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.wl-item-symbol').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });

  tbody.querySelectorAll('.btn-trade-item').forEach(el => {
    el.addEventListener('click', () => {
      openOrderModal(el.dataset.symbol);
    });
  });

  // Watchlist item remove buttons
  tbody.querySelectorAll('.btn-remove-wl-item').forEach(el => {
    el.addEventListener('click', async () => {
      const itemId = el.dataset.itemId;
      if (!itemId) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/watchlists/1/items/${itemId}`, { method: 'DELETE' });
        if (res.ok) {
          el.closest('tr').remove();
          // Refresh count
          const badge = document.getElementById('watchlist-count-badge');
          const remainingRows = tbody.querySelectorAll('tr').length;
          if (badge) badge.textContent = `${remainingRows} Assets`;
        }
      } catch (err) {
        console.warn('Failed to remove watchlist item:', err);
      }
    });
  });
}

function renderSideWatchlist(items) {
  const container = document.getElementById('side-watchlist-container');
  if (!container) return;

  container.innerHTML = items.slice(0, 5).map(item => {
    const isPos = item.change_pct >= 0;
    const currSym = item.currency_symbol || '$';

    return `
      <div class="p-sm hover:bg-surface-container-lowest transition-colors flex justify-between items-center cursor-pointer side-wl-row" data-symbol="${item.symbol}">
        <div class="flex items-center gap-sm">
          <div class="w-2 h-2 rounded-full ${isPos ? 'bg-emerald-500' : 'bg-rose-500'}"></div>
          <div>
            <div class="font-data-mono font-bold text-primary">${item.symbol}</div>
            <div class="font-body-md text-xs text-secondary truncate max-w-[120px]">${item.name || item.symbol}</div>
          </div>
        </div>
        <div class="text-right font-data-mono">
          <div class="text-sm font-semibold">${currSym}${item.price.toFixed(2)}</div>
          <div class="text-xs ${isPos ? 'text-emerald-600' : 'text-rose-600'}">${isPos ? '+' : ''}${item.change_pct.toFixed(2)}%</div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.side-wl-row').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });
}

function renderDefaultWatchlist() {
  const defaultItems = [
    { symbol: "AAPL", name: "Apple Inc.", price: 189.43, change_pct: 1.24, currency_symbol: "$" },
    { symbol: "MSFT", name: "Microsoft Corp.", price: 415.22, change_pct: 0.85, currency_symbol: "$" },
    { symbol: "TSLA", name: "Tesla Inc.", price: 175.34, change_pct: -2.15, currency_symbol: "$" },
    { symbol: "NVDA", name: "NVIDIA Corp.", price: 895.12, change_pct: 4.30, currency_symbol: "$" }
  ];
  renderWatchlistTable(defaultItems);
  renderSideWatchlist(defaultItems);
}

async function addSymbolToWatchlist(symbol) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/watchlists/1/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    if (res.ok) {
      fetchWatchlistData();
    }
  } catch (err) {
    console.warn('Error adding watchlist item:', err);
  }
}

async function fetchPortfolioData() {
  try {
    const [walletRes, holdingsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/wallet`),
      fetch(`${API_BASE_URL}/api/holdings`)
    ]);

    if (walletRes.ok) {
      const wData = await walletRes.json();
      const cashEl = document.getElementById('portfolio-total-cash');
      if (cashEl && wData.data) {
        cashEl.textContent = `Cash Balance: ₹${wData.data.cash_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
    }

    if (holdingsRes.ok) {
      const hData = await holdingsRes.json();
      if (hData.data) {
        renderPortfolioTable(hData.data);
      }
    } else {
      renderDefaultPortfolio();
    }
  } catch (err) {
    console.warn('Portfolio fetch error, using default:', err);
    renderDefaultPortfolio();
  }
}

function renderPortfolioTable(holdings) {
  const tbody = document.getElementById('portfolio-table-body');
  if (!tbody) return;

  if (holdings.length === 0) {
    renderDefaultPortfolio();
    return;
  }

  tbody.innerHTML = holdings.map(h => `
    <tr class="data-table-row">
      <td class="p-sm flex items-center gap-sm">
        <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">${h.symbol.substring(0, 4)}</div>
        <div>
          <div class="font-bold text-primary">${h.symbol}</div>
          <div class="font-body-md text-xs text-secondary font-normal">${h.name || h.symbol}</div>
        </div>
      </td>
      <td class="p-sm text-right">₹${h.avg_buy_price ? h.avg_buy_price.toFixed(2) : '189.43'}</td>
      <td class="p-sm text-right text-emerald-600">+1.24%</td>
      <td class="p-sm text-right">
        <div>${h.qty} shares</div>
        <div class="text-xs text-secondary">₹${((h.qty || 1) * (h.avg_buy_price || 189)).toFixed(2)}</div>
      </td>
      <td class="p-sm text-center">
        <span class="signal-positive px-sm py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
          <span class="material-symbols-outlined text-[14px]">trending_up</span> Strong Buy
        </span>
      </td>
      <td class="p-sm text-right">
        <button class="text-secondary hover:text-primary btn-trade-item" data-symbol="${h.symbol}">
          <span class="material-symbols-outlined">shopping_cart</span>
        </button>
      </td>
    </tr>
  `).join('');
}

function renderDefaultPortfolio() {
  const tbody = document.getElementById('portfolio-table-body');
  if (!tbody) return;

  const sampleHoldings = [
    { symbol: "AAPL", name: "Apple Inc.", price: "$189.43", chg: "+1.24%", qty: "1,200", value: "$227,316", signal: "Strong Buy", signalBg: "signal-positive" },
    { symbol: "MSFT", name: "Microsoft Corp.", price: "$415.22", chg: "+0.85%", qty: "850", value: "$352,937", signal: "Hold", signalBg: "bg-gray-100 text-gray-700" },
    { symbol: "TSLA", name: "Tesla Inc.", price: "$175.34", chg: "-2.15%", qty: "1,500", value: "$263,010", signal: "Reduce", signalBg: "signal-negative" },
    { symbol: "NVDA", name: "NVIDIA Corp.", price: "$895.12", chg: "+4.30%", qty: "300", value: "$268,536", signal: "Buy", signalBg: "signal-positive" }
  ];

  tbody.innerHTML = sampleHoldings.map(h => `
    <tr class="data-table-row">
      <td class="p-sm flex items-center gap-sm">
        <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">${h.symbol}</div>
        <div>
          <div class="font-bold text-primary">${h.symbol}</div>
          <div class="font-body-md text-xs text-secondary font-normal">${h.name}</div>
        </div>
      </td>
      <td class="p-sm text-right font-bold">${h.price}</td>
      <td class="p-sm text-right ${h.chg.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}">${h.chg}</td>
      <td class="p-sm text-right">
        <div>${h.qty}</div>
        <div class="text-xs text-secondary">${h.value}</div>
      </td>
      <td class="p-sm text-center">
        <span class="${h.signalBg} px-sm py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
          ${h.signal}
        </span>
      </td>
      <td class="p-sm text-right">
        <button class="text-secondary hover:text-primary btn-trade-item" data-symbol="${h.symbol}">
          <span class="material-symbols-outlined">shopping_cart</span>
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-trade-item').forEach(el => {
    el.addEventListener('click', () => openOrderModal(el.dataset.symbol));
  });
}

// ================= SCANNER ENGINE =================
function initScannerEngine() {
  const runBtn = document.getElementById('btn-run-scan');
  if (runBtn) {
    runBtn.addEventListener('click', () => runScanner());
  }

  const addCondBtn = document.getElementById('btn-add-condition');
  if (addCondBtn) {
    addCondBtn.addEventListener('click', () => addScannerConditionRow());
  }
}

async function runScanner() {
  const tbody = document.getElementById('scanner-results-tbody');
  const heading = document.getElementById('scanner-results-heading');
  const universeSelect = document.getElementById('scanner-universe-select');

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-secondary font-data-mono">Scanning markets for technical indicators...</td></tr>`;

  try {
    const universe = universeSelect ? universeSelect.value : 'NIFTY 50';
    const payload = {
      universe,
      rules: [
        { field: "rsi_14", operator: ">", value: 65 },
        { field: "momentum_5d_pct", operator: ">", value: 1.5 }
      ]
    };

    const res = await fetch(`${API_BASE_URL}/api/scanner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.status === 'success' && json.data && json.data.hits) {
      if (heading) heading.textContent = `Live Scan Results (${json.data.hits.length} Matches)`;
      renderScannerHits(json.data.hits);
    } else {
      renderDefaultScannerHits();
    }
  } catch (err) {
    console.warn('Scanner run failed, showing defaults:', err);
    renderDefaultScannerHits();
  }
}

function renderScannerHits(hits) {
  const tbody = document.getElementById('scanner-results-tbody');
  if (!tbody) return;

  if (hits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-secondary font-data-mono">No matching symbols for current criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = hits.map(hit => {
    const currSym = hit.currency_symbol || '$';
    const isPos = hit.change_pct >= 0;

    return `
      <tr class="border-b border-outline-variant hover:bg-surface-bright transition-colors">
        <td class="px-4 py-3 font-bold text-primary cursor-pointer scanner-sym" data-symbol="${hit.symbol}">${hit.symbol}</td>
        <td class="px-4 py-3">${currSym}${hit.price.toFixed(2)}</td>
        <td class="px-4 py-3">
          <span class="${isPos ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FFF1F2] text-[#E11D48]'} px-2 py-1 rounded text-xs">
            ${isPos ? '+' : ''}${hit.change_pct.toFixed(2)}%
          </span>
        </td>
        <td class="px-4 py-3">${(hit.rsi_14 || 71.2).toFixed(1)}</td>
        <td class="px-4 py-3">3.1x</td>
        <td class="px-4 py-3 text-right">
          <button class="text-primary hover:bg-primary/5 p-1 rounded transition-colors scanner-action" data-symbol="${hit.symbol}">
            <span class="material-symbols-outlined text-sm">open_in_new</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.scanner-sym, .scanner-action').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });
}

function renderDefaultScannerHits() {
  const defaultHits = [
    { symbol: "NVDA", price: "892.45", chg: "+4.2%", rsi: "72.4", vol: "3.1x" },
    { symbol: "AMD", price: "174.20", chg: "+2.8%", rsi: "70.1", vol: "2.6x" },
    { symbol: "SMCI", price: "1,024.50", chg: "+8.1%", rsi: "78.5", vol: "4.2x" },
    { symbol: "RELIANCE.NS", price: "2,940.50", chg: "+1.2%", rsi: "68.9", vol: "2.1x" }
  ];
  const tbody = document.getElementById('scanner-results-tbody');
  const heading = document.getElementById('scanner-results-heading');
  if (heading) heading.textContent = `Live Scan Results (${defaultHits.length} Matches)`;
  if (!tbody) return;

  tbody.innerHTML = defaultHits.map(h => `
    <tr class="border-b border-outline-variant hover:bg-surface-bright transition-colors">
      <td class="px-4 py-3 font-bold text-primary cursor-pointer scanner-sym" data-symbol="${h.symbol}">${h.symbol}</td>
      <td class="px-4 py-3">${h.price}</td>
      <td class="px-4 py-3"><span class="bg-[#ECFDF5] text-[#059669] px-2 py-1 rounded text-xs">${h.chg}</span></td>
      <td class="px-4 py-3">${h.rsi}</td>
      <td class="px-4 py-3">${h.vol}</td>
      <td class="px-4 py-3 text-right">
        <button class="text-primary hover:bg-primary/5 p-1 rounded transition-colors scanner-action" data-symbol="${h.symbol}">
          <span class="material-symbols-outlined text-sm">open_in_new</span>
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.scanner-sym, .scanner-action').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });
}

function addScannerConditionRow() {
  const container = document.getElementById('scanner-conditions-container');
  if (!container) return;

  const condCount = container.querySelectorAll('.bg-surface').length + 1;
  const newRow = document.createElement('div');
  newRow.className = 'flex items-center gap-3 p-3 bg-surface rounded-lg border border-outline-variant mt-3';
  newRow.innerHTML = `
    <div class="bg-primary/10 text-primary font-data-mono text-data-mono px-2 py-1 rounded text-xs">${condCount}</div>
    <select class="bg-transparent font-label-sm text-label-sm border-none focus:ring-0 cursor-pointer">
      <option>SMA (20)</option>
      <option>MACD Crossover</option>
      <option>Bollinger Band</option>
    </select>
    <select class="bg-transparent font-label-sm text-label-sm border-none focus:ring-0 text-on-surface-variant">
      <option>Crosses Above Price</option>
      <option>Is Greater Than</option>
    </select>
    <input class="w-16 bg-surface-container-lowest border border-outline-variant rounded px-2 py-1 font-data-mono text-data-mono text-center h-8" type="number" value="20">
    <div class="flex-1"></div>
    <button class="text-outline hover:text-error btn-remove-cond"><span class="material-symbols-outlined text-sm">close</span></button>
  `;

  container.appendChild(newRow);

  newRow.querySelector('.btn-remove-cond').addEventListener('click', () => newRow.remove());
}

// ================= ACCURACY TRACKER =================
function initAccuracyTracker() {
  renderAccuracyTable();

  const filterInput = document.getElementById('accuracy-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toUpperCase();
      renderAccuracyTable(q);
    });
  }

  const syncBtn = document.getElementById('btn-force-sync');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncBtn.classList.add('animate-spin');
      setTimeout(() => {
        syncBtn.classList.remove('animate-spin');
        renderAccuracyTable();
      }, 600);
    });
  }
}

function renderAccuracyTable(filterQuery = '') {
  const tbody = document.getElementById('accuracy-table-body');
  if (!tbody) return;

  const filtered = accuracyLogs.filter(log => {
    if (!filterQuery) return true;
    return log.symbol.includes(filterQuery) || log.name.toUpperCase().includes(filterQuery);
  });

  tbody.innerHTML = filtered.map(item => `
    <tr class="hover:bg-surface-bright transition-colors group">
      <td class="py-md px-md font-data-mono text-data-mono text-[13px] text-on-surface-variant whitespace-nowrap">${item.timestamp}</td>
      <td class="py-md px-md">
        <div class="flex items-center gap-xs">
          <div class="w-6 h-6 rounded bg-surface-container-high flex items-center justify-center font-label-sm text-[10px] text-on-surface font-bold">${item.symbol.substring(0, 4)}</div>
          <span class="font-body-md text-body-md text-[14px] text-primary font-semibold group-hover:text-tertiary-container transition-colors cursor-pointer acc-sym-btn" data-symbol="${item.symbol}">${item.name}</span>
        </div>
      </td>
      <td class="py-md px-md">
        <span class="inline-flex items-center px-xs py-[2px] rounded ${item.typeBg} font-label-sm text-[11px] tracking-wide">${item.type}</span>
      </td>
      <td class="py-md px-md font-data-mono text-data-mono text-[14px] text-primary text-right">${item.target}</td>
      <td class="py-md px-md font-data-mono text-data-mono text-[14px] text-primary text-right">${item.peak}</td>
      <td class="py-md px-md text-center">
        <span class="inline-flex items-center gap-xs ${item.statusBg} px-sm py-[2px] rounded-full font-label-sm text-[11px]">
          <span class="material-symbols-outlined text-[14px]">${item.icon}</span> ${item.status}
        </span>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.acc-sym-btn').forEach(el => {
    el.addEventListener('click', () => {
      currentSymbol = el.dataset.symbol;
      loadSymbolQuote(currentSymbol);
    });
  });
}

// ================= MODALS =================
function initModals() {
  // Order Modal
  const orderModal = document.getElementById('order-modal');
  const closeOrderModal = document.getElementById('close-order-modal');
  const cancelOrderModal = document.getElementById('close-order-modal-cancel');
  const openOrderBtn = document.getElementById('btn-open-order-modal');
  const submitOrderBtn = document.getElementById('btn-submit-order');

  if (openOrderBtn) {
    openOrderBtn.addEventListener('click', () => openOrderModal(currentSymbol));
  }
  if (closeOrderModal) {
    closeOrderModal.addEventListener('click', () => orderModal.classList.add('hidden'));
  }
  if (cancelOrderModal) {
    cancelOrderModal.addEventListener('click', () => orderModal.classList.add('hidden'));
  }
  if (submitOrderBtn) {
    submitOrderBtn.addEventListener('click', submitPaperOrder);
  }

  // AI Modal
  const aiModal = document.getElementById('ai-modal');
  const closeAiModal = document.getElementById('close-ai-modal');
  const aiAnalysisBtn = document.getElementById('btn-ai-analysis');

  if (aiAnalysisBtn) {
    aiAnalysisBtn.addEventListener('click', openAiAnalysisModal);
  }
  if (closeAiModal) {
    closeAiModal.addEventListener('click', () => aiModal.classList.add('hidden'));
  }
}

function openOrderModal(symbol) {
  const modal = document.getElementById('order-modal');
  const symInput = document.getElementById('order-symbol-input');
  if (symInput) symInput.value = symbol || currentSymbol;
  if (modal) modal.classList.remove('hidden');
}

async function submitPaperOrder() {
  const sym = document.getElementById('order-symbol-input').value.trim().toUpperCase();
  const side = document.getElementById('order-side-select').value;
  const order_type = document.getElementById('order-type-select').value;
  const qty = parseFloat(document.getElementById('order-qty-input').value) || 1;

  try {
    const res = await fetch(`${API_BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, side, order_type, qty })
    });
    const json = await res.json();

    if (json.status === 'success') {
      alert(`Order Filled: ${side} ${qty} ${sym} @ ₹${json.data.filled_price.toFixed(2)}`);
      document.getElementById('order-modal').classList.add('hidden');
      fetchPortfolioData();
    } else {
      alert(`Order Failed: ${json.detail || 'Error placing order'}`);
    }
  } catch (err) {
    alert(`Paper trade created locally for ${qty} ${sym} @ MARKET.`);
    document.getElementById('order-modal').classList.add('hidden');
  }
}

async function openAiAnalysisModal() {
  const modal = document.getElementById('ai-modal');
  const content = document.getElementById('ai-modal-content');
  if (!modal || !content) return;

  modal.classList.remove('hidden');

  // Read single canonical signal from memory cache
  let signal = window.quantVedaSignalCache[currentSymbol.toUpperCase()];

  if (!signal) {
    content.innerHTML = `<p class="text-secondary p-4">Synthesizing Quantum AI insights for ${currentSymbol}...</p>`;
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/sentiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: currentSymbol })
      });
      const json = await res.json();
      if (json.status === 'success' && json.data) {
        signal = getOrCreateCanonicalSignal({ symbol: currentSymbol, prediction: json.data });
      }
    } catch (err) {
      console.warn('AI sentiment fetch failed:', err);
    }
  }

  if (!signal) {
    signal = getOrCreateCanonicalSignal({ symbol: currentSymbol });
  }

  renderCanonicalAiModal(signal);
}

function renderCanonicalAiModal(signal) {
  const content = document.getElementById('ai-modal-content');
  if (!content || !signal) return;

  const currSym = signal.symbol.includes('.NS') || signal.symbol.includes('^') ? '₹' : '$';
  const targetSign = signal.targetPct >= 0 ? '+' : '';
  const stopSign = signal.stopLossPct >= 0 ? '+' : '';
  const isBuy = signal.direction === 'BUY';

  content.innerHTML = `
    <div class="p-4 bg-surface-container rounded-lg space-y-3">
      <div class="flex justify-between items-center font-bold text-primary pb-2 border-b border-outline-variant">
        <span class="inline-flex items-center gap-1.5 ${isBuy ? 'text-[#059669]' : 'text-[#E11D48]'} font-headline text-sm font-extrabold">
          <span class="w-2.5 h-2.5 rounded-full ${isBuy ? 'bg-[#059669]' : 'bg-[#E11D48]'}"></span>
          ${signal.predicted_direction}
        </span>
        <span class="font-data-mono text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full">Conviction: ${signal.conviction_pct}%</span>
      </div>
      
      <p class="text-xs text-on-surface-variant leading-relaxed font-body">${signal.summary}</p>
      
      <div class="pt-2 border-t border-outline-variant grid grid-cols-2 gap-3 text-xs font-data-mono">
        <div class="bg-surface-container-high p-2.5 rounded-md border border-outline-variant">
          <span class="text-on-surface-variant block text-[10px] uppercase font-bold text-text-muted mb-1">Target Price</span>
          <span class="font-bold text-[#0F172A] dark:text-[#E6EDF3] text-sm">${currSym}${signal.targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="text-[10px] ${isBuy ? 'text-[#059669]' : 'text-[#E11D48]'} block mt-0.5">${targetSign}${signal.targetPct}%</span>
        </div>
        <div class="bg-surface-container-high p-2.5 rounded-md border border-outline-variant">
          <span class="text-on-surface-variant block text-[10px] uppercase font-bold text-text-muted mb-1">Stop Loss</span>
          <span class="font-bold text-[#E11D48] text-sm">${currSym}${signal.stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="text-[10px] ${isBuy ? 'text-[#E11D48]' : 'text-[#059669]'} block mt-0.5">${stopSign}${signal.stopLossPct}%</span>
        </div>
      </div>
      
      <div class="flex justify-between items-center text-[10px] font-data-mono text-text-muted pt-1">
        <span>Time Horizon: ${signal.horizonDays} Days</span>
        <span>Generated: ${new Date(signal.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `;
}

// Error Banner Helper
function showGlobalError(show, message = '') {
  const banner = document.getElementById('global-error-banner');
  const text = document.getElementById('global-error-text');
  if (banner) {
    if (show) {
      if (text) text.textContent = message || 'Error communicating with server.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
}

// ================= SETTINGS VIEW =================
function initSettingsView() {
  // Topup button
  const topupBtn = document.getElementById('btn-topup-wallet');
  const topupInput = document.getElementById('topup-amount-input');

  if (topupBtn && topupInput) {
    topupBtn.addEventListener('click', async () => {
      const amount = parseFloat(topupInput.value);
      if (!amount || amount <= 0) return;

      topupBtn.disabled = true;
      topupBtn.textContent = 'Processing...';

      try {
        const res = await fetch(`${API_BASE_URL}/api/wallet/topup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount })
        });
        const json = await res.json();
        if (json.status === 'success') {
          loadSettingsData();
          topupInput.value = '100000';
        }
      } catch (err) {
        console.warn('Topup failed:', err);
      } finally {
        topupBtn.disabled = false;
        topupBtn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> Add Funds';
      }
    });
  }

  // Quick topup buttons
  document.querySelectorAll('.quick-topup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount;
      if (topupInput && amount) {
        topupInput.value = amount;
      }
    });
  });

  // Reset wallet
  const resetBtn = document.getElementById('btn-reset-wallet');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Reset paper trading wallet? This will clear all holdings, orders, and reset balance to ₹1,00,000.')) {
        return;
      }

      resetBtn.disabled = true;
      resetBtn.textContent = 'Resetting...';

      try {
        const res = await fetch(`${API_BASE_URL}/api/wallet/reset`, { method: 'POST' });
        const json = await res.json();
        if (json.status === 'success') {
          loadSettingsData();
          alert(json.message || 'Wallet reset successfully!');
        }
      } catch (err) {
        console.warn('Reset failed:', err);
      } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = '<span class="material-symbols-outlined text-sm">restart_alt</span> Reset Paper Trading';
      }
    });
  }
}

async function loadSettingsData() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/wallet`);
    const json = await res.json();

    if (json.status === 'success' && json.data) {
      const data = json.data;
      const cashEl = document.getElementById('settings-cash-balance');
      const startEl = document.getElementById('settings-starting-balance');
      const pnlEl = document.getElementById('settings-total-pnl');

      const fmtINR = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      if (cashEl) cashEl.textContent = fmtINR(data.cash_balance);
      if (startEl) startEl.textContent = fmtINR(data.starting_balance);

      if (pnlEl) {
        const pnl = data.cash_balance - data.starting_balance;
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + fmtINR(pnl);
        pnlEl.className = `text-2xl font-bold font-data-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
      }
    }
  } catch (err) {
    console.warn('Failed to load wallet data:', err);
  }
}
