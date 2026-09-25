"""
QuantVeda AI 2.0 — Chartink-Style Stock Scanner Engine
Handles NIFTY universe definitions, technical indicator caching, and multi-rule condition matching.
"""

import math
import logging
from datetime import datetime
from typing import List, Dict, Any
import requests

logger = logging.getLogger("quantveda.scanner")

# Curated Indian Stock Universes
UNIVERSES = {
    "NIFTY 50": [
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
        "BHARTIARTL.NS", "SBIN.NS", "LTIM.NS", "ITC.NS", "KOTAKBANK.NS",
        "LT.NS", "AXISBANK.NS", "HINDUNILVR.NS", "TATAMOTORS.NS", "BAJFINANCE.NS",
        "MARUTI.NS", "SUNPHARMA.NS", "ASIANPAINT.NS", "TITAN.NS", "ULTRACEMCO.NS",
        "NTPC.NS", "POWERGRID.NS", "TATASTEEL.NS", "M&M.NS", "ADANIENT.NS",
        "ADANIPORTS.NS", "COALINDIA.NS", "ONGC.NS", "JSWSTEEL.NS", "HDFCLIFE.NS",
        "TECHM.NS", "BAJAJFINSV.NS", "GRASIM.NS", "BRITANNIA.NS", "HEROMOTOCO.NS",
        "EICHERMOT.NS", "DIVISLAB.NS", "BPCL.NS", "CIPLA.NS", "APOLLOHOSP.NS",
        "WIPRO.NS", "DLF.NS", "HAL.NS", "BEL.NS", "VBL.NS",
        "TRENT.NS", "SIEMENS.NS", "PIDILITIND.NS", "ABB.NS", "VEDL.NS"
    ],
    "NIFTY BANK": [
        "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS",
        "PNB.NS", "BANKBARODA.NS", "INDUSINDBK.NS", "IDFCFIRSTB.NS", "FEDERALBNK.NS",
        "AUBANK.NS", "BANDHANBNK.NS"
    ],
    "NIFTY IT": [
        "TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS", "LTIM.NS",
        "TECHM.NS", "PERSISTENT.NS", "COFORGE.NS", "MPHASIS.NS", "LTTS.NS"
    ],
    "NIFTY AUTO": [
        "TATAMOTORS.NS", "MARUTI.NS", "M&M.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS",
        "EICHERMOT.NS", "TVSMOTOR.NS", "ASHOKLEY.NS", "BHARATFORG.NS", "BALKRISIND.NS"
    ]
}

PRESET_SCANNERS = [
    {
        "id": "preset_volume_breakout",
        "name": "🚀 Volume Breakout (>1.5x 10D Avg Vol)",
        "universe": "NIFTY 50",
        "rules": [
            {"field": "volume", "operator": ">", "value_type": "field_multiplier", "value": "avg_volume_10d", "multiplier": 1.5},
            {"field": "change_pct", "operator": ">", "value": 0.5}
        ]
    },
    {
        "id": "preset_rsi_oversold",
        "name": "🟢 Oversold RSI (<35 Dip Buy)",
        "universe": "NIFTY 50",
        "rules": [
            {"field": "rsi_14", "operator": "<=", "value": 35.0}
        ]
    },
    {
        "id": "preset_rsi_overbought",
        "name": "🔴 Overbought RSI (>70 Momentum/Sell)",
        "universe": "NIFTY 50",
        "rules": [
            {"field": "rsi_14", "operator": ">=", "value": 70.0}
        ]
    },
    {
        "id": "preset_bullish_sma",
        "name": "📈 Golden Bullish (Price > SMA 20 & Change > +1%)",
        "universe": "NIFTY 50",
        "rules": [
            {"field": "price", "operator": ">", "value_type": "field", "value": "sma_20"},
            {"field": "change_pct", "operator": ">=", "value": 1.0}
        ]
    }
]

def evaluate_single_rule(quote_snapshot: Dict[str, Any], rule: Dict[str, Any]) -> bool:
    """
    Evaluates a single scanner rule against a stock quote snapshot.
    Supports operators: '>', '>=', '<', '<=', '==', '!='
    Supports value_type: 'number' (default), 'field', 'field_multiplier'
    """
    field = rule.get("field")
    operator = rule.get("operator", "==")
    val_type = rule.get("value_type", "number")

    left_val = quote_snapshot.get(field)
    if left_val is None or (isinstance(left_val, float) and math.isnan(left_val)):
        return False

    right_val = 0.0
    if val_type == "number":
        right_val = float(rule.get("value", 0.0))
    elif val_type == "field":
        target_field = rule.get("value")
        right_val = quote_snapshot.get(target_field, 0.0)
    elif val_type == "field_multiplier":
        target_field = rule.get("value")
        target_val = quote_snapshot.get(target_field, 0.0)
        mult = float(rule.get("multiplier", 1.0))
        right_val = target_val * mult

    if right_val is None or (isinstance(right_val, float) and math.isnan(right_val)):
        return False

    left_val = float(left_val)
    right_val = float(right_val)

    if operator == ">":
        return left_val > right_val
    elif operator == ">=":
        return left_val >= right_val
    elif operator == "<":
        return left_val < right_val
    elif operator == "<=":
        return left_val <= right_val
    elif operator == "==":
        return abs(left_val - right_val) < 1e-5
    elif operator == "!=":
        return abs(left_val - right_val) >= 1e-5

    return False

def evaluate_scanner_rules(quote_snapshot: Dict[str, Any], rules: List[Dict[str, Any]]) -> tuple[bool, List[str]]:
    """
    Evaluates all rules for a symbol. Returns (is_match, matched_rule_descriptions).
    """
    if not rules:
        return True, ["All symbols matched (No rules)"]

    matched_reasons = []
    for rule in rules:
        if evaluate_single_rule(quote_snapshot, rule):
            field = rule.get("field")
            op = rule.get("operator")
            val = rule.get("value")
            val_type = rule.get("value_type", "number")
            if val_type == "field_multiplier":
                val = f"{rule.get('multiplier')}x {val}"
            matched_reasons.append(f"{field} {op} {val}")
        else:
            return False, []

    return True, matched_reasons
