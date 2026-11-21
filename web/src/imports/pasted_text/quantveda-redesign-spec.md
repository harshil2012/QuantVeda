QuantVeda Full UI Analysis — Figma Redesign Spec
0. Routes / Pages (5 URLs, 2 screens)
Route	File	Screen
/, /login, /auth	frontend/auth.html	Auth portal (gate). Auto-redirect to /terminal if valid token. ?logout=1, ?switch=1, ?redirect= supported
/terminal, /trade, /app, /dashboard, /app.js, static	frontend/index.html + app.js	Trading terminal (7 views, SPA via currentView, initNavigation)
API docs	backend	http://127.0.0.1:8000/docs (not designed)
Auth guard (index.html:58-65): no token + no ?guest=1 → redirect /auth. Guest mode skips login, read-only.
1. Global Shell (terminal, every view)
- Background layers (qv-ambient, qv-grid-overlay, index.html:952-953): fixed radial blue/cyan/purple glows + 36px grid masked to top. Light/dark aware via html.dark. Redesign: keep as Background/Ambient component with light + dark variants.
- Desktop sidenav (#desktop-sidenav, w-64, collapsible to 68px icon rail via #btn-toggle-sidebar): logo mark (QV) + "QuantVeda / Live Engine", 7 nav buttons (data-target-view: dashboard, charts, watchlists, portfolio, scanner, accuracy, settings, icons: dashboard, query_stats, list_alt, account_balance_wallet, search_insights, track_changes, settings), footer Support + Help (currently dead buttons — decide: wire or drop in redesign).
- Mobile drawer (#mobile-drawer): same 7 links, hamburger #open-mobile-drawer, close #close-mobile-drawer.
- Topbar (h-16, sticky): mobile brand, search (#main-search-input, default RELIANCE.NS, clear #clear-search-btn, dropdown #search-autocomplete-dropdown → GET /api/search?q=), live IST clock (#header-live-clock), AI Analysis button (#btn-ai-analysis → AI modal), notifications bell (#btn-notifications, dot, currently no panel — needs design or removal), theme toggle (#btn-theme-toggle / #theme-toggle-icon), auth widget (Sign In #btn-open-auth-modal ↔ profile pill #auth-user-pill: avatar #user-avatar-badge, name #user-display-name, dropdown: name #dropdown-user-name, id #dropdown-user-id, cash #dropdown-wallet-bal, logout #btn-auth-logout).
- Global error banner (#global-error-banner + #global-error-text, #close-error-banner).
- Fonts: Plus Jakarta Sans (UI) + JetBrains Mono (numbers) + Material Symbols Outlined icons. Redesign must keep mono numerals.
2. Design Tokens (must replicate as Figma styles)
- Light: bg #f7f9fb, cards #fff, borders #e2e8f0, text #0f172a/#475569/#64748b, accent #2563eb, bull #059669, bear #e11d48.
- Dark: bg #090d16, cards #131926/#161b22, borders #1f2633/#30363d, text #f0f6fc/#8b949e/#6e7681, accent #388bfd, bull #3fb950, bear #f85149.
- Radius: cards 12–16px, pills full, modal 16–24px. Shadows: panel/modal/dropdown tiers. Theme switch: light / dark / system (localStorage quantveda-theme), no-flash pre-hydration. Auth page is dark-only.
3. View-by-View (7 terminal views)
V1 Dashboard (#view-dashboard, default)
- Hero quote card (2-col span): exchange badge (NSE), #dash-symbol-name, #dash-company-name, #dash-exchange-info, #dash-price-val, #dash-change-val pill, intraday area chart #dash-chart-container + loader #dash-chart-loader. Skeleton pulse blocks before load. Click symbol → charts view. Data: GET /api/quote/{sym} + GET /api/candles/{sym}?interval=1d&range=1d, WS micro-ticks (applyOneSecondMicroTicks), 30s auto-refresh (startCorrelatedAutoRefresh).
- AI Signal card: badge #ai-signal-badge (BUY/SELL/HOLD), #ai-conviction-val, #ai-target-price, #ai-stop-loss, horizon 14D. Data: quote prediction (canonical signal).
- Sentiment panel: #bullish-pct-label, #bearish-pct-label, bars #bullish-bar/#bearish-bar, bullets #sentiment-bullet-list. Data: GET /api/analyze/{sym}.
- Correlated table: #dash-correlated-table-body columns Name / Correlation / Price / 24h Chg / AI Bias, refresh #btn-view-matrix.
Charts View (#view-charts, TradingView clone)
- Toolbar: symbol picker (#chart-symbol-dropdown-btn, #chart-current-symbol), interval menu (#chart-interval-dropdown-btn/menu, 1m/5m/15m/1H/4H/1D/1W/1M → currentChartInterval), chart-type menu (#chart-type-dropdown-btn/menu: Candles/Hollow/Line/Area/Bars/Heikin Ashi), applied-indicators bar (#applied-indicators-list), Indicators #btn-chart-indicators, Alert #btn-chart-alert (stub), Replay #btn-chart-replay (stub), Settings #btn-chart-settings, Fullscreen #btn-chart-fullscreen.
- Left rail #drawing-tools: select/trendline/hline/vline/rectangle/text/magnet/stay/zoom/measure/clear (mostly visual stubs — confirm scope in redesign).
- Canvas #tv-chart-container (Lightweight Charts) + legend (#tv-legend-name/tf/exch, quick SELL #tv-sell-price / BUY #tv-buy-price → opens order modal), OHLC row (#ohlc-o/h/l/c/chg), active indicator values (#tv-active-indicators-legend), paper-trading bar (#quantveda-paper-trading-bar, balance #chart-paper-wallet-balance), crosshair lines/tooltips, loader #chart-loading-spinner. Data: GET /api/candles/{sym}?interval&range, GET /api/candles/{sym}/max, WS  /ws/price/{sym} + 3s polling fallback. Persist: quantveda_chart_settings.
V3 Watchlists (#view-watchlists)
- Header: title + Add-symbol input (#add-watchlist-symbol-input + dropdown #wl-search-dropdown) + #btn-add-to-watchlist → POST /api/watchlists/{id}/items.
- Table card: #active-watchlist-name, filter #watchlist-search-filter, count #watchlist-count-badge, rows #watchlist-table-body: Asset / Price / 24h Change / AI Bias / Action (chart/trade) / Remove (DELETE .../items/{itemId}). Data: GET /api/watchlists, quotes GET /api/watchlists/{id}/quotes.
- Analytics card: sentiment score 68 + bar + note. Note: single-list UI though API supports many lists — redesign should add list switcher or confirm single-list.
V4 Portfolio (#view-portfolio)
- Header: topup #btn-portfolio-topup (scrolls to settings? confirm), Place Trade #btn-open-order-modal.
- 4 metric cards: #port-total-value + #port-total-pnl-badge, #port-cash-balance, #port-invested-val + #port-current-holding-val, #port-unrealized-pnl + #port-days-pnl. Data: GET /api/portfolio (auto-refresh 30s).
- Tabs: Holdings #tab-portfolio-holdings (#port-holdings-count-badge) / Orders #tab-portfolio-orders (#port-orders-count-badge), LIVE STREAM pill, Refresh #btn-refresh-portfolio.
- Holdings table #portfolio-table-body: Asset / Qty / Avg Buy / LTP / Invested / Current / P&L / Trade Actions (Buy More/Sell → order modal).
- Orders blotter #portfolio-orders-tbody (hidden default): ID+Date / Symbol / Side / Type / Qty / Exec price / Status (FILLED/PENDING/CANCELLED) / Cancel (DELETE /api/orders/{id}).
V5 Scanner (#view-scanner)
- Header: title + Save #btn-save-scanner-rule (persists POST /api/scanner/configs) + Run #btn-run-scan (POST /api/scanner/run).
- Universe card: #scanner-universe-select (NIFTY 50/BANK/IT/AUTO), Market-cap min/max inputs (visual only — wire or drop).
- Conditions card: #scanner-conditions-container rows: index badge, field select (rsi_14/change_pct/momentum_5d_pct/price), op (>=/<=/>/<), value input, Add #btn-add-condition (addScannerConditionRow).
- Results: #scanner-results-heading, Engine Active pill, #scanner-results-tbody: Ticker / Price / Change% / RSI / Rel Vol / Action (chart + add-to-watchlist).
V6 Accuracy (#view-accuracy)
- Header: Export CSV #btn-export-accuracy, Force Sync #btn-force-sync (POST /api/predictions/resolve).
- 3 stat cards: #accuracy-win-rate (+delta), #accuracy-signal-count, Engine Status (Q-Beta 4.2, 14ms, >85%).
- Log table #accuracy-table-body + filter #accuracy-filter-input: Timestamp / Asset / Signal Type / Predicted Target / Actual Peak / Validation HIT-MISS. Data: GET /api/predictions/scorecard.
V7 Settings (#view-settings)
- Theme card: #theme-light/#theme-dark/#theme-system + check .theme-check.
- Wallet card: #settings-cash-balance, #settings-starting-balance, #settings-total-pnl; topup #topup-amount-input + #btn-topup-wallet (POST /api/wallet/topup) + quick chips .quick-topup-btn (50K/1L/5L/10L); reset #btn-reset-wallet (POST /api/wallet/reset, clears holdings+orders).
- Preferences: #settings-default-market (NSE/BSE/NASDAQ/NYSE), #settings-currency (₹/$), #settings-default-tf.
- Chart prefs toggles: #settings-show-volume/grid/auto-scale/crosshair.
4. Modals / Overlays (4)
1. Auth modal (#auth-modal, terminal): tabs #tab-channel-email/phone, email #auth-email-input, phone #auth-country-code + #auth-phone-input, Send #btn-send-otp, verify step (#auth-target-display, #auth-otp-input, #btn-verify-otp, #otp-timer/#otp-countdown-text, #btn-resend-otp, Change #btn-change-identifier), Google #btn-google-signin, alert #auth-alert-box, link to /auth. Flows: send-otp → verify-otp (backend JWT) or Google popup → firebase-login.
2. Order modal (#order-modal): title #order-modal-title, badge #order-modal-symbol-badge, LTP #order-modal-live-price, side toggle (hidden #order-side-select), symbol #order-symbol-input, type toggle (hidden #order-type-select), limit group #order-limit-price-group/#order-limit-price-input, qty stepper (#order-qty-input, #order-max-qty-label), cash #order-modal-avail-cash, est value #order-modal-est-value, margin #order-modal-req-margin, Cancel #close-order-modal-cancel, Submit #order-submit-btn-text (POST /api/orders, updateOrderCalculations).
3. AI modal (#ai-modal): opened #btn-ai-analysis, content #ai-modal-content (renderCanonicalAiModal: direction, conviction, target/SL, horizon, rationale), close #close-ai-modal. Data: GET /api/analyze/{sym} + POST /api/ai/sentiment.
4. Indicators modal (#indicators-modal): search #indicator-search-input, categories .indicator-cat-btn (Trending/Moving Averages/Oscillators/Volatility/Volume), rows .indicator-item: SMA (#toggle-sma/#sma-period), EMA (#toggle-ema/#ema-period), BB (#toggle-bb/#bb-period), VWAP + more (applyIndicators, persist quantveda_indicators).
5. Auth Page (/auth, dark-only, 3 stages)
- Stage 1 (#auth-card-step1): tabs #tab-email/#tab-phone, email modes #btn-email-mode-magic/login/signup (#input-email, #box-password/#input-password, #btn-forgot-password, #hint-magic-link, domain chips), phone (#select-country-code, #input-phone, #recaptcha-container), Firebase banner (#firebase-config-banner), submit #btn-submit-identifier, Google #btn-google-signin, alert #auth-status-alert, guest link /terminal?guest=1, settings gear #btn-firebase-settings → config modal (#modal-firebase-setup: paste box #fb-config-paste-box, fields #fb-inp-*, save #btn-save-fb-config → POST /api/auth/save-firebase-config).
- Stage 2 (#auth-card-step2): target #auth-sent-target, 6 boxes .otp-digit-input (auto-advance, paste, auto-submit), #btn-verify-code, timer #timer-display/#timer-label, resend #btn-resend-code, alert #otp-status-alert, edit #btn-edit-target. Firebase phone → confirmationResult.confirm() → firebase-login; backend OTP → verify-otp.
- Stage 3 (#auth-card-step3): success id #success-user-id, balance #success-wallet-balance, msg #success-welcome-msg, progress #redirect-progress, #redirect-seconds → /terminal.
- Backend auth API: send-otp / verify-otp / firebase-login / firebase-config / save-firebase-config / me / logout. JWT (quantveda_auth_token + quantveda_user), auto-attached to /api/*, 401 clears session.
6. All Functions Map (app.js, for behavior parity)
Clock/theme/nav/search (initClock, applyTheme/initTheme, loadChartSettings/saveChartSettings/applyDefaultZoom, initNavigation, initSearchAutocomplete/fetchSearchResults), dashboard (showDashboardHeroSkeleton, loadSymbolQuote, updateDashboardHero/Fallback, updateChartHeader, initDashboard, startCorrelatedAutoRefresh, applyOneSecondMicroTicks, renderCorrelatedTable), charts (initChartsView, loadDashboardCandles, loadCandlesData, renderCandleData, updateDataProvenance, startRealtimeChartFeed/PollingFallback, stopRealtimeChartFeed, updateChartWithLivePrice, applyIndicators, load/saveIndicatorSettings, initIndicatorsModal, initSidebarToggle), watchlist/portfolio (fetchWatchlistData/Quotes, renderWatchlistTable, add/removeWatchlistItem, startPortfolioAutoRefresh, initWatchlistsAndPortfolio, fetchPortfolioData, renderPortfolioSummary/Table/OrdersTable), scanner (initScannerEngine, renderScannerHits, addScannerConditionRow, saveScannerPreset), accuracy (initAccuracyTracker, renderAccuracyTable), modals (initModals, updateOrderCalculations, openOrderModal, openAiAnalysisModal, renderCanonicalAiModal, showGlobalError), settings (initSettingsView, loadSettingsData), auth (initFirebaseFromBackend, handleGoogleSignInModal, initAuthSystem, updateAuthHeaderUI, open/closeAuthModal, show/clearAuthAlert, handleSendOTP, startOTPCountdown, handleVerifyOTP, handleAuthLogout/Local).
7. States to Design (every component needs these)
Loading (skeleton pulses dashboard, spinners charts/modal), empty (no holdings/orders/watchlist/results/logs), error (banner + field alerts + 401 logout), live (WS badges, pulse dots, countdown timers), disabled (sending/verifying buttons), guest (auth-gated actions → modal).
8. Send Back for Implementation (Figma handoff checklist)
Per screen: desktop 1440 + mobile 390 frames, light + dark variants, all states above, component variants (buttons, inputs, tabs, tables, cards, modals, badges, toasts), icon set (Material Symbols names used), redlines (spacing 8pt, radius, type scale: UI Plus Jakarta / numbers JetBrains Mono), click-prototype flows (auth 3 stages, order submit, scan run, tab switches), API field map per component (IDs listed above stay stable — I rebind by ID, so keep every id="..." or list renames).