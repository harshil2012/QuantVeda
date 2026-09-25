"""
QuantVeda Real-World F&O Options Pricing & Chain Engine.
Implements Black-Scholes pricing, NSE lot sizes, realistic IV, Greeks, and option chain generation.
"""

import math
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

# Standard NSE F&O Lot Sizes
NSE_LOT_SIZES: Dict[str, int] = {
    "^NSEI": 50,
    "NIFTY": 50,
    "^NSEBANK": 15,
    "BANKNIFTY": 15,
    "RELIANCE.NS": 250,
    "RELIANCE": 250,
    "TCS.NS": 175,
    "TCS": 175,
    "INFY.NS": 400,
    "INFY": 400,
    "HDFCBANK.NS": 550,
    "HDFCBANK": 550,
    "ICICIBANK.NS": 700,
    "ICICIBANK": 700,
    "TATAMOTORS.NS": 700,
    "TATAMOTORS": 700,
    "SBIN.NS": 750,
    "SBIN": 750,
    "BHARTIARTL.NS": 475,
    "BHARTIARTL": 475,
    "ITC.NS": 1600,
    "ITC": 1600,
    "LT.NS": 150,
    "LT": 150,
}

def get_lot_size(symbol: str) -> int:
    """Return standard NSE lot size for symbol, defaulting to 100."""
    sym_u = symbol.upper().strip()
    clean = sym_u.replace(".NS", "").replace(".BO", "")
    return NSE_LOT_SIZES.get(sym_u, NSE_LOT_SIZES.get(clean, 100))

def _norm_cdf(x: float) -> float:
    """Cumulative distribution function for standard normal distribution."""
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

def _get_next_thursday(weeks_ahead: int = 0) -> datetime:
    """Find next Thursday for standard NSE weekly/monthly option expiries."""
    now = datetime.utcnow()
    # Thursday is weekday 3 (Monday is 0)
    days_ahead = (3 - now.weekday()) % 7
    if days_ahead == 0 and now.hour >= 10:  # If today is Thursday after market close, take next
        days_ahead += 7
    target = now + timedelta(days=days_ahead + (weeks_ahead * 7))
    return target.replace(hour=10, minute=0, second=0, microsecond=0)

def get_option_expiries() -> List[Dict[str, Any]]:
    """Return upcoming weekly and monthly NSE expiry dates."""
    expiries = []
    # Current weekly expiry
    thurs1 = _get_next_thursday(0)
    thurs2 = _get_next_thursday(1)
    thurs3 = _get_next_thursday(3)
    
    for idx, dt in enumerate([thurs1, thurs2, thurs3]):
        label = dt.strftime("%d-%b-%Y").upper()
        tag = "Current Weekly" if idx == 0 else ("Next Weekly" if idx == 1 else "Monthly")
        expiries.append({
            "expiry": label,
            "days_to_expiry": max(1, (dt - datetime.utcnow()).days),
            "label": f"{label} ({tag})"
        })
    return expiries

def calculate_black_scholes(
    spot: float,
    strike: float,
    days_to_expiry: float,
    option_type: str,
    iv: float = 0.22,
    r: float = 0.065
) -> Dict[str, float]:
    """
    Calculate Black-Scholes theoretical option premium and Greeks.
    option_type: 'CE' (Call) or 'PE' (Put)
    """
    if spot <= 0 or strike <= 0:
        return {"price": 0.05, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "iv": iv}

    t = max(days_to_expiry, 0.5) / 365.0
    sig = max(iv, 0.05)
    
    d1 = (math.log(spot / strike) + (r + (sig ** 2) / 2.0) * t) / (sig * math.sqrt(t))
    d2 = d1 - sig * math.sqrt(t)

    is_call = option_type.upper() == "CE"

    if is_call:
        price = spot * _norm_cdf(d1) - strike * math.exp(-r * t) * _norm_cdf(d2)
        delta = _norm_cdf(d1)
    else:
        price = strike * math.exp(-r * t) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)
        delta = _norm_cdf(d1) - 1.0

    # Ensure minimum tick of 0.05
    premium = max(round(price, 2), 0.05)

    # Standard gamma
    gamma = math.exp(-(d1 ** 2) / 2.0) / (spot * sig * math.sqrt(2 * math.pi * t))
    theta = -(spot * sig * math.exp(-(d1 ** 2) / 2.0)) / (2 * math.sqrt(2 * math.pi * t)) / 365.0

    return {
        "price": premium,
        "delta": round(delta, 3),
        "gamma": round(gamma, 5),
        "theta": round(theta, 2),
        "iv": round(sig * 100, 1),
    }

def get_strike_step(spot: float, symbol: str) -> float:
    """Determine strike interval spacing based on asset spot price and symbol."""
    sym_u = symbol.upper()
    if "^NSEI" in sym_u or "NIFTY" in sym_u:
        return 50.0
    if "^NSEBANK" in sym_u or "BANKNIFTY" in sym_u:
        return 100.0
    if spot > 5000:
        return 100.0
    elif spot > 2000:
        return 50.0
    elif spot > 1000:
        return 20.0
    elif spot > 500:
        return 10.0
    elif spot > 100:
        return 5.0
    return 2.5

def get_option_chain(symbol: str, spot_price: float, expiry_str: Optional[str] = None) -> Dict[str, Any]:
    """Generate realistic NSE-style option chain for a given underlying asset."""
    expiries = get_option_expiries()
    active_expiry = expiries[0]
    if expiry_str:
        match = next((e for e in expiries if e["expiry"] == expiry_str), None)
        if match:
            active_expiry = match

    days_to_exp = active_expiry["days_to_expiry"]
    lot_size = get_lot_size(symbol)
    step = get_strike_step(spot_price, symbol)

    # Round spot to nearest strike (ATM)
    atm_strike = round(spot_price / step) * step

    # Generate 5 ITM strikes, ATM, and 5 OTM strikes (total 11 strikes)
    strikes = []
    for i in range(-5, 6):
        strikes.append(round(atm_strike + (i * step), 2))

    chain_rows = []
    base_iv = 0.21 if "^NSEI" in symbol.upper() else 0.26

    for k in strikes:
        # Slight volatility smile/skew
        moneyness = (k - spot_price) / spot_price
        skew_iv = base_iv + (abs(moneyness) * 0.15)

        ce_calc = calculate_black_scholes(spot_price, k, days_to_exp, "CE", iv=skew_iv)
        pe_calc = calculate_black_scholes(spot_price, k, days_to_exp, "PE", iv=skew_iv)

        ce_price = ce_calc["price"]
        pe_price = pe_calc["price"]

        # Synthetic bid/ask spread
        ce_bid = max(round(ce_price - 0.25, 2), 0.05)
        ce_ask = round(ce_price + 0.25, 2)
        pe_bid = max(round(pe_price - 0.25, 2), 0.05)
        pe_ask = round(pe_price + 0.25, 2)

        chain_rows.append({
            "strike": k,
            "is_atm": k == atm_strike,
            "call": {
                "symbol": f"{symbol.replace('.NS', '')}_{int(k)}_CE_{active_expiry['expiry'][:6]}",
                "instrument_type": "CE",
                "strike": k,
                "price": ce_price,
                "bid": ce_bid,
                "ask": ce_ask,
                "delta": ce_calc["delta"],
                "iv": ce_calc["iv"],
                "oi": int((10000 - abs(k - spot_price) * 10) * (lot_size / 25)),
            },
            "put": {
                "symbol": f"{symbol.replace('.NS', '')}_{int(k)}_PE_{active_expiry['expiry'][:6]}",
                "instrument_type": "PE",
                "strike": k,
                "price": pe_price,
                "bid": pe_bid,
                "ask": pe_ask,
                "delta": pe_calc["delta"],
                "iv": pe_calc["iv"],
                "oi": int((11000 - abs(k - spot_price) * 12) * (lot_size / 25)),
            }
        })

    return {
        "symbol": symbol,
        "spot_price": spot_price,
        "lot_size": lot_size,
        "active_expiry": active_expiry["expiry"],
        "days_to_expiry": days_to_exp,
        "expiries": expiries,
        "atm_strike": atm_strike,
        "strikes": chain_rows
    }
