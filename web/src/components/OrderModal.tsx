import { useState, useEffect, useRef } from 'react';
import { api, fmt, subscribePriceWs, type OptionChainData, type OptionChainStrike } from '../lib/api';

interface Props {
  symbol: string;
  side: 'BUY' | 'SELL';
  onClose: () => void;
  user: { balance: number } | null;
}

export default function OrderModal({ symbol, side, onClose, user }: Props) {
  const isIndex = symbol.startsWith('^') || symbol.toUpperCase() === 'NIFTY' || symbol.toUpperCase() === 'BANKNIFTY';

  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>(side);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL'>('MARKET');
  const [instrument, setInstrument] = useState<'EQUITY' | 'CE' | 'PE'>(isIndex ? 'CE' : 'EQUITY');
  const [qty, setQty] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [target, setTarget] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChg, setLiveChg] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [fillMsg, setFillMsg] = useState('');
  const [liveCash, setLiveCash] = useState<number | null>(null);
  const [holdingQty, setHoldingQty] = useState<number | null>(null);
  const [holdingPosType, setHoldingPosType] = useState<'LONG' | 'SHORT' | null>(null);
  const [holdingAvgBuy, setHoldingAvgBuy] = useState<number | null>(null);

  // Options state
  const [optChain, setOptChain] = useState<OptionChainData | null>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [lotSize, setLotSize] = useState<number>(1);

  // Fetch initial quote, wallet, holdings & option chain
  useEffect(() => {
    let cancelled = false;

    const fetchBase = async () => {
      try {
        const [q, w, h] = await Promise.all([
          api.quote(symbol).catch(() => null),
          api.wallet().catch(() => null),
          api.holdings().catch(() => null),
        ]);
        if (cancelled) return;
        if (q?.data?.price !== undefined) {
          setLivePrice(q.data.price);
          setLiveChg(q.data.change_pct ?? 0);
          setLimitPrice(prev => prev ? prev : String(q.data.price));
          if (!stopLoss && instrument === 'EQUITY') {
            setStopLoss(String((q.data.price * 0.98).toFixed(1)));
          }
          if (!target && instrument === 'EQUITY') {
            setTarget(String((q.data.price * 1.04).toFixed(1)));
          }
        }
        if (w?.data) setLiveCash(w.data.cash_balance);
        if (h?.data) {
          const sym = symbol.toUpperCase();
          const clean = sym.replace('.NS', '').replace('^', '');
          const found = h.data.find((x: { symbol: string; qty: number; position_type?: string; avg_buy_price?: number }) => 
            x.symbol.toUpperCase() === sym || x.symbol.toUpperCase().startsWith(clean)
          );
          if (found) {
            setHoldingQty(found.qty);
            setHoldingPosType(found.qty < 0 ? 'SHORT' : (found.position_type === 'SHORT' ? 'SHORT' : 'LONG'));
            setHoldingAvgBuy(found.avg_buy_price ?? null);
          } else {
            setHoldingQty(0);
            setHoldingPosType(null);
            setHoldingAvgBuy(null);
          }
        }
      } catch {
        // silent
      }
    };

    fetchBase();
    const intervalId = setInterval(fetchBase, 3000);

    const unsubWs = subscribePriceWs(symbol, payload => {
      if (cancelled || !payload || payload.price === undefined) return;
      setLivePrice(payload.price);
    });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      unsubWs();
    };
  }, [symbol, instrument]);

  // Load option chain when CE or PE is selected
  useEffect(() => {
    if (instrument === 'EQUITY') {
      setLotSize(1);
      return;
    }
    let cancelled = false;
    setOptLoading(true);

    api.optionChain(symbol, selectedExpiry || undefined)
      .then(res => {
        if (cancelled || !res?.data) return;
        const data = res.data;
        setOptChain(data);
        setLotSize(data.lot_size || 50);
        if (qty === 1 || qty < (data.lot_size || 50)) {
          setQty(data.lot_size || 50);
        }
        if (!selectedExpiry && data.active_expiry) {
          setSelectedExpiry(data.active_expiry);
        }
        if (selectedStrike === null && data.atm_strike) {
          setSelectedStrike(data.atm_strike);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOptLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, instrument, selectedExpiry]);

  // Determine active strike option data
  const activeStrikeRow: OptionChainStrike | undefined = optChain?.strikes?.find(s => s.strike === selectedStrike);
  const activeLeg = activeStrikeRow ? (instrument === 'CE' ? activeStrikeRow.call : activeStrikeRow.put) : null;
  const optPrice = activeLeg?.price ?? null;

  // Recalculate default SL/Target when instrument or strike changes
  useEffect(() => {
    if (instrument !== 'EQUITY' && optPrice !== null && optPrice > 0) {
      setStopLoss(String((optPrice * 0.70).toFixed(1))); // 30% SL for options
      setTarget(String((optPrice * 1.50).toFixed(1)));   // 50% Target for options
    }
  }, [instrument, selectedStrike, optPrice]);

  const ltp = livePrice ?? 0;
  const chg = liveChg;
  const currentExecPrice = instrument === 'EQUITY' 
    ? (orderType === 'MARKET' ? (ltp || 0) : parseFloat(limitPrice || String(ltp || 0)))
    : (optPrice || 0);

  const estValue = qty * currentExecPrice;
  const cash = liveCash ?? user?.balance ?? 100000;

  // Margin calculation:
  // - Buying equity or options: 100% premium paid
  // - Shorting equity: 20% margin blocked (cash is credited)
  // - Shorting options: 50% margin blocked
  const isShortPosition = orderSide === 'SELL' && (holdingQty === null || holdingQty <= 0);
  const isCovering = orderSide === 'BUY' && holdingPosType === 'SHORT';
  const marginNeeded = isShortPosition ? (instrument === 'EQUITY' ? estValue * 0.20 : estValue * 0.50) : estValue;

  const handleSubmit = async () => {
    if (instrument === 'EQUITY' && isIndex) {
      setError(`Market Index '${symbol}' cannot be traded as equity. Please switch to Call (CE) or Put (PE) options above.`);
      return;
    }
    if (orderType === 'LIMIT' && !limitPrice && instrument === 'EQUITY') {
      setError('Please provide a limit price.');
      return;
    }
    setPlacing(true);
    setError('');
    try {
      const res = await api.placeOrder({
        symbol,
        side: orderSide,
        order_type: orderType,
        qty,
        ...(orderType === 'LIMIT' && limitPrice ? { limit_price: parseFloat(limitPrice) } : {}),
        ...(stopLoss ? { stop_loss_price: parseFloat(stopLoss) } : {}),
        ...(target ? { target_price: parseFloat(target) } : {}),
        instrument_type: instrument,
        ...(instrument !== 'EQUITY' && selectedStrike ? { strike_price: selectedStrike } : {}),
        ...(instrument !== 'EQUITY' && selectedExpiry ? { expiry_date: selectedExpiry } : {}),
      }) as { message?: string };

      setFillMsg(res.message || 'Order placed successfully.');
      setSubmitted(true);
      setTimeout(() => { onClose(); }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order execution failed.');
    } finally {
      setPlacing(false);
    }
  };

  const getActionLabel = () => {
    if (orderSide === 'BUY') {
      if (isCovering) return `COVER (Buy Back Short)`;
      return `BUY ${instrument !== 'EQUITY' ? `${instrument} ` : ''}`;
    } else {
      if (isShortPosition) return `SHORT (Sell First)`;
      return `SELL (Exit Long)`;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--qv-card)',
          border: '1px solid var(--qv-border)',
          borderRadius: 20,
          width: 440,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--qv-shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--qv-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: 'var(--qv-text)' }}>Order Terminal</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1, background: 'var(--qv-bg2)', color: 'var(--qv-text)' }}>
              {symbol.replace('.NS', '')}
            </span>
            {holdingQty !== null && holdingQty !== 0 && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 4,
                background: holdingPosType === 'SHORT' ? 'var(--qv-bear-bg)' : 'var(--qv-bull-bg)',
                color: holdingPosType === 'SHORT' ? 'var(--qv-bear)' : 'var(--qv-bull)'
              }}>
                {holdingPosType}: {Math.abs(holdingQty)} @ ₹{fmt(holdingAvgBuy)}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--qv-text3)', padding: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {submitted ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--qv-bull-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--qv-bull)' }}>check_circle</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--qv-text)', marginBottom: 6 }}>Order Accepted!</div>
            <div style={{ fontSize: 13, color: 'var(--qv-text3)' }}>{fillMsg}</div>
          </div>
        ) : (
          <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
            
            {/* Instrument Selection: Equity vs Call vs Put */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 6, fontWeight: 500 }}>Instrument Type</div>
              <div style={{ display: 'flex', background: 'var(--qv-bg2)', borderRadius: 10, padding: 3, gap: 4 }}>
                {[
                  { id: 'EQUITY', label: 'Equity / Cash', desc: isIndex ? 'Indices not tradable' : 'Shares' },
                  { id: 'CE', label: 'Call Option (CE)', desc: 'Bullish contract' },
                  { id: 'PE', label: 'Put Option (PE)', desc: 'Bearish contract' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setInstrument(t.id as 'EQUITY' | 'CE' | 'PE');
                      if (t.id !== 'EQUITY' && lotSize > 1) {
                        setQty(lotSize);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: instrument === t.id ? 700 : 500,
                      fontFamily: 'JetBrains Mono, monospace',
                      background: instrument === t.id ? 'var(--qv-card)' : 'transparent',
                      color: instrument === t.id ? 'var(--qv-accent)' : 'var(--qv-text3)',
                      boxShadow: instrument === t.id ? 'var(--qv-shadow)' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div>{t.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Index Equity Warning Card */}
            {isIndex && instrument === 'EQUITY' && (
              <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--qv-bear)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
                  {symbol} is an Index (Not Tradable as Equity)
                </div>
                <div style={{ fontSize: 11, color: 'var(--qv-text2)', lineHeight: 1.4 }}>
                  Exchange indices have no equity delivery shares. To trade market view, select <b>Call (CE)</b> or <b>Put (PE)</b> options above, or trade NIFTY ETF <code>NIFTYBEES.NS</code>.
                </div>
              </div>
            )}

            {/* F&O Option Details: Expiry, Strike, Premium */}
            {instrument !== 'EQUITY' && (
              <div style={{ background: 'var(--qv-bg2)', border: '1px solid var(--qv-border)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  {/* Expiry Selector */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 4 }}>Expiry Date</div>
                    <select
                      value={selectedExpiry}
                      onChange={e => setSelectedExpiry(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'var(--qv-card)',
                        border: '1px solid var(--qv-border)',
                        color: 'var(--qv-text)',
                        padding: '7px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                        outline: 'none',
                      }}
                    >
                      {optChain?.expiries?.map(exp => (
                        <option key={exp.expiry} value={exp.expiry}>
                          {exp.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Strike Selector */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 4 }}>Strike Price</div>
                    <select
                      value={selectedStrike ?? ''}
                      onChange={e => setSelectedStrike(parseFloat(e.target.value))}
                      style={{
                        width: '100%',
                        background: 'var(--qv-card)',
                        border: '1px solid var(--qv-border)',
                        color: 'var(--qv-text)',
                        padding: '7px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                        outline: 'none',
                      }}
                    >
                      {optChain?.strikes?.map(str => {
                        const tag = str.is_atm ? ' (ATM)' : (instrument === 'CE' ? (str.strike < (optChain?.spot_price || 0) ? ' (ITM)' : ' (OTM)') : (str.strike > (optChain?.spot_price || 0) ? ' (ITM)' : ' (OTM)'));
                        return (
                          <option key={str.strike} value={str.strike}>
                            ₹{str.strike}{tag}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Option Pricing Banner */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--qv-card)', padding: '8px 12px', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>{instrument} Option Premium</div>
                    <div style={{ fontSize: 18, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--qv-text)' }}>
                      {optLoading ? 'Calculating…' : `₹${fmt(optPrice)}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Lot Size: {lotSize} units</div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-accent)' }}>
                      Delta: {activeLeg?.delta ?? '—'} · IV: {activeLeg?.iv ?? '—'}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Underlying Spot Price (for Equity) */}
            {instrument === 'EQUITY' && (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 2 }}>Underlying Spot Price (LTP)</div>
                <div style={{ fontSize: 24, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--qv-text)' }}>
                  {livePrice !== null ? `₹${fmt(ltp)}` : 'Fetching…'}
                </div>
                {livePrice !== null && (
                  <div style={{ fontSize: 12, color: chg >= 0 ? 'var(--qv-bull)' : 'var(--qv-bear)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                  </div>
                )}
              </div>
            )}

            {/* Side Toggle: BUY vs SELL */}
            <div style={{ display: 'flex', background: 'var(--qv-bg2)', borderRadius: 10, padding: 4 }}>
              {(['BUY', 'SELL'] as const).map(s => {
                const isSelected = orderSide === s;
                const isSellShort = s === 'SELL' && isShortPosition;
                return (
                  <button
                    key={s}
                    onClick={() => setOrderSide(s)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, monospace',
                      background: isSelected ? (s === 'BUY' ? 'var(--qv-bull)' : 'var(--qv-bear)') : 'transparent',
                      color: isSelected ? 'white' : 'var(--qv-text3)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {s === 'BUY' ? (isCovering ? 'BUY (Cover Short)' : 'BUY (Long)') : (isSellShort ? 'SELL (Short First)' : 'SELL (Exit)')}
                  </button>
                );
              })}
            </div>

            {/* Shorting explanation helper */}
            {isShortPosition && (
              <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'var(--qv-text2)' }}>
                <span style={{ color: 'var(--qv-bear)', fontWeight: 700 }}>Real-World Short Selling:</span> You have 0 holdings. This order will open a <b>SHORT</b> position. ₹{fmt(estValue)} will be credited to cash, requiring 20% margin. Profit is made when the asset price drops.
              </div>
            )}

            {isCovering && (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'var(--qv-text2)' }}>
                <span style={{ color: 'var(--qv-bull)', fontWeight: 700 }}>Short Covering:</span> You currently hold a SHORT position of {Math.abs(holdingQty || 0)} shares @ ₹{fmt(holdingAvgBuy)}. Buying back will close this short and lock in your P&L.
              </div>
            )}

            {/* Order Type: MARKET vs LIMIT */}
            {instrument === 'EQUITY' && (
              <div style={{ display: 'flex', background: 'var(--qv-bg2)', borderRadius: 8, padding: 3 }}>
                {(['MARKET', 'LIMIT', 'SL'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: orderType === t ? 600 : 500,
                      background: orderType === t ? 'var(--qv-card)' : 'transparent',
                      color: orderType === t ? 'var(--qv-text)' : 'var(--qv-text3)',
                      boxShadow: orderType === t ? 'var(--qv-shadow)' : 'none',
                    }}
                  >
                    {t === 'SL' ? 'SL-M' : t}
                  </button>
                ))}
              </div>
            )}

            {/* Limit Price Input */}
            {orderType === 'LIMIT' && instrument === 'EQUITY' && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--qv-text3)', marginBottom: 4 }}>Limit Execution Price (₹)</div>
                <input
                  value={limitPrice}
                  onChange={e => setLimitPrice(e.target.value)}
                  type="number"
                  style={{
                    background: 'var(--qv-bg2)',
                    border: '1px solid var(--qv-border)',
                    color: 'var(--qv-text)',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 14,
                    width: '100%',
                    fontFamily: 'JetBrains Mono, monospace',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Stop Loss & Target - Loss Prevention Section */}
            <div style={{ background: 'var(--qv-bg2)', borderRadius: 12, padding: '10px 12px', border: '1px solid var(--qv-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--qv-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f59e0b' }}>shield</span>
                  Stop Loss & Target Protection
                </span>
                <span style={{ fontSize: 10, color: 'var(--qv-text3)' }}>Auto-exit on trigger</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Stop Loss */}
                <div>
                  <div style={{ fontSize: 11, color: 'var(--qv-bear)', marginBottom: 4, fontWeight: 600 }}>Stop Loss (₹)</div>
                  <input
                    value={stopLoss}
                    onChange={e => setStopLoss(e.target.value)}
                    type="number"
                    placeholder="SL Price"
                    style={{
                      background: 'var(--qv-card)',
                      border: '1px solid var(--qv-border)',
                      color: 'var(--qv-text)',
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      width: '100%',
                      fontFamily: 'JetBrains Mono, monospace',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                    {(instrument === 'EQUITY' ? [1, 2, 5] : [20, 30, 50]).map(pct => {
                      const refPrice = currentExecPrice;
                      const slVal = orderSide === 'BUY'
                        ? (refPrice * (1 - pct / 100))
                        : (refPrice * (1 + pct / 100));
                      return (
                        <button
                          key={pct}
                          onClick={() => setStopLoss(String(slVal.toFixed(1)))}
                          style={{
                            flex: 1,
                            fontSize: 10,
                            padding: '3px 0',
                            borderRadius: 4,
                            border: '1px solid var(--qv-border)',
                            background: 'var(--qv-card)',
                            color: 'var(--qv-text3)',
                            cursor: 'pointer',
                          }}
                        >
                          {pct}%
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Target */}
                <div>
                  <div style={{ fontSize: 11, color: 'var(--qv-bull)', marginBottom: 4, fontWeight: 600 }}>Target Profit (₹)</div>
                  <input
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    type="number"
                    placeholder="Target Price"
                    style={{
                      background: 'var(--qv-card)',
                      border: '1px solid var(--qv-border)',
                      color: 'var(--qv-text)',
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      width: '100%',
                      fontFamily: 'JetBrains Mono, monospace',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                    {(instrument === 'EQUITY' ? [2, 4, 8] : [30, 50, 100]).map(pct => {
                      const refPrice = currentExecPrice;
                      const tgtVal = orderSide === 'BUY'
                        ? (refPrice * (1 + pct / 100))
                        : (refPrice * (1 - pct / 100));
                      return (
                        <button
                          key={pct}
                          onClick={() => setTarget(String(tgtVal.toFixed(1)))}
                          style={{
                            flex: 1,
                            fontSize: 10,
                            padding: '3px 0',
                            borderRadius: 4,
                            border: '1px solid var(--qv-border)',
                            background: 'var(--qv-card)',
                            color: 'var(--qv-text3)',
                            cursor: 'pointer',
                          }}
                        >
                          +{pct}%
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Quantity Selector */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>
                  Quantity {instrument !== 'EQUITY' ? `(Multiple of Lot Size ${lotSize})` : ''}
                </span>
                <span style={{ fontSize: 11, color: 'var(--qv-text3)', fontFamily: 'JetBrains Mono, monospace' }}>
                  Available Cash: ₹{fmt(cash, 0)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setQty(q => Math.max(lotSize, q - (instrument !== 'EQUITY' ? lotSize : 1)))}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'var(--qv-bg2)',
                    border: '1px solid var(--qv-border)',
                    color: 'var(--qv-text)',
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  −
                </button>
                <input
                  value={qty}
                  onChange={e => {
                    const val = parseInt(e.target.value) || 1;
                    setQty(Math.max(1, val));
                  }}
                  type="number"
                  min={1}
                  step={instrument !== 'EQUITY' ? lotSize : 1}
                  style={{
                    flex: 1,
                    background: 'var(--qv-bg2)',
                    border: '1px solid var(--qv-border)',
                    color: 'var(--qv-text)',
                    padding: '8px',
                    borderRadius: 8,
                    textAlign: 'center',
                    fontSize: 15,
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => setQty(q => q + (instrument !== 'EQUITY' ? lotSize : 1))}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'var(--qv-bg2)',
                    border: '1px solid var(--qv-border)',
                    color: 'var(--qv-text)',
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Financial Summary */}
            <div style={{ background: 'var(--qv-bg2)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBlock: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Execution Price</span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text)', fontWeight: 600 }}>
                  ₹{fmt(currentExecPrice)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBlock: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>Total Contract Turnover</span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-text)', fontWeight: 600 }}>
                  ₹{fmt(estValue, 0)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBlock: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--qv-text3)' }}>
                  {isShortPosition ? 'Margin Required (Short)' : 'Required Capital'}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: marginNeeded > cash ? 'var(--qv-bear)' : 'var(--qv-text)', fontWeight: 700 }}>
                  ₹{fmt(marginNeeded, 0)}
                </span>
              </div>
              {stopLoss && (
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBlock: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--qv-bear)' }}>Maximum Risk Cap</span>
                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--qv-bear)', fontWeight: 600 }}>
                    ₹{fmt(Math.abs(currentExecPrice - parseFloat(stopLoss)) * qty, 0)}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                {error}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  background: 'var(--qv-bg2)',
                  border: '1px solid var(--qv-border)',
                  color: 'var(--qv-text2)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={placing || (isIndex && instrument === 'EQUITY')}
                style={{
                  flex: 2,
                  padding: '11px',
                  borderRadius: 10,
                  background: orderSide === 'BUY' ? 'var(--qv-bull)' : 'var(--qv-bear)',
                  border: 'none',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: (isIndex && instrument === 'EQUITY') ? 'not-allowed' : 'pointer',
                  letterSpacing: 0.5,
                  opacity: (placing || (isIndex && instrument === 'EQUITY')) ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {placing ? 'Submitting…' : getActionLabel()}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
