"""Deterministic FOREX paper-only autopilot. No broker, no leverage, no real orders.

Requires a validated fresh data/market.json from update_market.py. Runs at most
once per new common FOREX workday. State is a public simulation journal saved
in data/forex_autopilot.json and committed by GitHub Actions.

A pending signal executes at the NEXT observed daily close; never on the signal
bar. Signals are hypotheses and not proof of predictive performance.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[1]
MARKET = ROOT / 'data' / 'market.json'
STATE = ROOT / 'data' / 'forex_autopilot.json'
PAIRS = {'eurusd': 'EURUSD=X', 'eurgbp': 'EURGBP=X', 'eurjpy': 'EURJPY=X'}
BUDGET = 1000.0
TICKET = 250.0
FEE = 0.0015
MAX_TRADES = 4
# v4.3 safety gate: no simulated conversions until strategy validation.
ALLOW_VIRTUAL_EXECUTION = False
MAX_HOLD_BARS = 10
STOP_NET_PCT = -1.5
TARGET_NET_PCT = 2.5


def new_state(date: str) -> dict:
    return {'schema': 1, 'engine': 'forex-autopilot-4.2', 'started_on': date,
            'last_processed': date, 'cash': BUDGET, 'trade_count': 0,
            'pending': None, 'position': None, 'closed': [], 'events': [],
            'market_date': date, 'status': 'initialised', 'last_attempt_utc': None}


def load_state(path: Path, start_date: str) -> tuple[dict, bool]:
    if not path.exists():
        return new_state(start_date), True
    obj = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(obj, dict) or obj.get('schema') != 1 or
        obj.get('engine') != 'forex-autopilot-4.2' or
        not isinstance(obj.get('cash'), (int, float)) or
        not (0 <= obj['cash'] <= BUDGET * 1.5) or
        not isinstance(obj.get('trade_count'), int) or
        not (0 <= obj['trade_count'] <= MAX_TRADES) or
        not isinstance(obj.get('closed'), list) or
        not isinstance(obj.get('events'), list) or
        not isinstance(obj.get('last_processed'), str) or
        (obj.get('pending') is not None and not isinstance(obj['pending'], dict)) or
        (obj.get('position') is not None and not isinstance(obj['position'], dict))):
        raise ValueError('Estado existente inválido; não substituir nem reiniciar silenciosamente')
    return obj, False


def quotes(feed: dict, today: dt.date) -> tuple[str, dict]:
    if feed.get('status') != 'ok' or not isinstance(feed.get('forex'), dict):
        raise ValueError('Feed Forex sem estado validado')
    aligned = {}
    for key, ticker in PAIRS.items():
        block = feed['forex'].get(key)
        if not isinstance(block, dict) or block.get('ticker') != ticker or block.get('base') != 'EUR':
            raise ValueError(f'Par {key} ausente ou identificação errada')
        clean = {}
        for row in block.get('prices', []):
            if not isinstance(row, dict):
                continue
            d = row.get('date')
            v = row.get('close')
            try:
                day = dt.date.fromisoformat(d)
            except (ValueError, TypeError):
                continue
            if day.weekday() >= 5:  # Avoid Saturday metadata bars until independently verified.
                continue
            if day > today or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 < v < 100000:
                continue
            clean[d] = float(v)
        if len(clean) < 210:
            raise ValueError(f'{key}: menos de 210 observações úteis')
        aligned[key] = clean
    common = set.intersection(*(set(rows) for rows in aligned.values()))
    if not common:
        raise ValueError('Nenhuma sessão comum entre pares')
    last = max(common)
    age = (today - dt.date.fromisoformat(last)).days
    if age < 0 or age > 4:
        raise ValueError(f'Fecho comum desatualizado: {last}')
    ordered = {key: [{'date': d, 'close': vals[d]} for d in sorted(vals) if d <= last] for key, vals in aligned.items()}
    for key, arr in ordered.items():
        tail = arr[-15:]
        for prev, curr in zip(tail, tail[1:]):
            if abs(curr['close'] / prev['close'] - 1) > .06:
