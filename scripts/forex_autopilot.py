"""Deterministic FOREX paper-only autopilot. No broker, no leverage, no real orders.

Requires a validated fresh data/market.json from update_market.py. Runs at most
once per new common FOREX workday. State is a public simulation journal saved
in data/forex_autopilot.json and committed by GitHub Actions.

Paper mode: virtual fills at subsequent validated daily closes; never real orders.
Signals are hypotheses and not proof of predictive performance.
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
MAX_HOLD_BARS = 10
STOP_NET_PCT = -1.5
TARGET_NET_PCT = 2.5
ALLOW_VIRTUAL_EXECUTION = True


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
                raise ValueError(f'{key}: variação extrema, verificar possível outlier')
    return last, ordered


def sma(nums: list[float], n: int) -> float:
    return sum(nums[-n:]) / n


def entry_candidate(series: dict, d: str, vix: dict | None = None) -> dict | None:
    # No new trades if macro context is missing or panic volatility is high.
    if not vix or not vix.get('date') or not isinstance(vix.get('value'), (int, float)):
        return None
    if not math.isfinite(vix['value']) or vix['value'] >= 30:
        return None
    candidates = []
    for key, rows in series.items():
        past = [x for x in rows if x['date'] <= d]
        if len(past) < 205:
            continue
        p = [x['close'] for x in past]
        m20, m50 = sma(p, 20), sma(p, 50)
        change5 = p[-1] / p[-6] - 1
        lr = [math.log(p[i] / p[i - 1]) for i in range(len(p)-19, len(p))]
        vol = statistics.stdev(lr) * math.sqrt(252) if len(lr) > 2 else 1
        # Buying foreign currency in a confirmed downward EUR quote trend.
        if not (p[-1] < .998 * m20 and p[-2] < m20 and m20 < .999 * m50 and
                -.025 <= change5 <= -.004 and vol <= .14):
            continue
        score = -change5 - min(0.02, (m20 - p[-1]) / m20) * .15
        candidates.append((score, key, change5, vol))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], x[1]))
    _, pair, momentum, volatility = candidates[0]
    return {'pair': pair, 'momentum_5d_pct': round(100*momentum, 3),
            'annual_vol_pct': round(100*volatility, 2)}


def record(s: dict, date: str, what: str, details: str) -> None:
    s['events'].append({'date': date, 'event': what, 'details': details})
    s['events'] = s['events'][-250:]


def market_value(pos: dict, rate: float) -> float:
    return pos['foreign_units'] / rate * (1 - FEE)


def process(s: dict, date: str, series: dict, vix: dict | None = None) -> dict:
    if date <= s['last_processed']:
        return s
    s['last_processed'] = date
    s['market_date'] = date
    # Only the latest market-close gets acted on. Do not fabricate missed executions.
    pending = s.get('pending')
    # Discard legacy proposals generated while execution was disabled.
    # Never convert an old observation into a retroactive paper fill.
    if pending and s.get('status') == 'validation-only' and ALLOW_VIRTUAL_EXECUTION:
        record(s, date, 'cancel', 'Proposta antiga de validação anulada na ativação da simulação')
        s['pending'] = None
        pending = None
    if pending and not ALLOW_VIRTUAL_EXECUTION:
        record(s, date, 'execution-blocked', 'Proposta anterior mantida sem execução; modo validação')
    if ALLOW_VIRTUAL_EXECUTION and pending and date > pending['signal_date']:
        if (dt.date.fromisoformat(date) - dt.date.fromisoformat(pending['signal_date'])).days > 7:
            record(s, date, 'cancel', f'Proposta {pending["side"]} expirou após falta de fechos')
            s['pending'] = None
        elif pending['pair'] in series:
            pair = pending['pair']
            candidates = [r['close'] for r in series[pair] if r['date'] == date]
            if candidates:
                fx = candidates[-1]
                if pending['side'] == 'buy' and s['position'] is None and s['cash'] >= TICKET and s['trade_count'] < MAX_TRADES and vix and isinstance(vix.get('value'), (int, float)) and math.isfinite(vix['value']) and vix['value'] < 30:
                    s['cash'] = round(s['cash'] - TICKET, 8)
                    s['trade_count'] += 1
                    s['position'] = {'pair': pair, 'buy_date': date, 'entry_rate': fx,
                                     'foreign_units': TICKET * (1 - FEE) * fx,
                                     'eur_debited': TICKET, 'bars_held': 0}
                    record(s, date, 'buy-filled', f'{pair}: 250 EUR virtuais; fecho {fx:.6f}; custo entrada 0,15%')
                elif pending['side'] == 'sell' and s['position'] is not None and s['position']['pair'] == pair:
                    pos = s['position']
                    proceeds = market_value(pos, fx)
                    gain = proceeds - pos['eur_debited']
                    closed = {**pos, 'sell_date': date, 'exit_rate': fx,
                              'received_eur': round(proceeds, 8), 'pnl_eur': round(gain, 8),
                              'exit_reason': pending['reason']}
                    s['closed'].append(closed)
                    s['cash'] = round(s['cash'] + proceeds, 8)
                    s['position'] = None
                    record(s, date, 'sell-filled', f'{pair}: lucro/prejuízo virtual {gain:+.2f} EUR; fecho {fx:.6f}; custo saída 0,15%')
                else:
                    record(s, date, 'cancel', f'{pair}: entrada virtual anulada por limite de risco, falta de VIX ou estado inválido')
                s['pending'] = None
    pos = s.get('position')
    if ALLOW_VIRTUAL_EXECUTION and pos and not s.get('pending'):
        # Don't evaluate an exit at the same close that just filled the entry.
        if pos['buy_date'] < date:
            current = next((x['close'] for x in reversed(series[pos['pair']]) if x['date'] == date), None)
            if current:
                pos['bars_held'] += 1
                net = (market_value(pos, current) / pos['eur_debited'] - 1) * 100
                reason = ('fecho abaixo da perda teórica' if net <= STOP_NET_PCT else
                          'objetivo atingido ao fecho' if net >= TARGET_NET_PCT else
                          'prazo máximo de 10 sessões' if pos['bars_held'] >= MAX_HOLD_BARS else None)
                if reason:
                    s['pending'] = {'side': 'sell', 'pair': pos['pair'], 'signal_date': date, 'reason': reason}
                    record(s, date, 'sell-signal', f'{pos["pair"]}: {reason}; P/L indicativo {net:+.2f}%; saída somente no próximo fecho')
    if s.get('position') is None and s.get('pending') is None and s['trade_count'] < MAX_TRADES and s['cash'] >= TICKET:
        candidate = entry_candidate(series, date, vix)
        if candidate:
            pair = candidate['pair']
            if ALLOW_VIRTUAL_EXECUTION:
                s['pending'] = {'side': 'buy', 'pair': pair, 'signal_date': date,
                                'reason': 'queda persistente do EUR face à moeda, com filtros técnicos'}
            record(s, date, 'buy-signal' if ALLOW_VIRTUAL_EXECUTION else 'observation',
                   f'{pair}: tendência cambial; mudança 5d {candidate["momentum_5d_pct"]:+.2f}%; ' +
                   ('entrada somente no próximo fecho' if ALLOW_VIRTUAL_EXECUTION else 'sem execução virtual'))
    s['status'] = ('active' if (s.get('position') or s.get('pending')) else 'monitoring') if ALLOW_VIRTUAL_EXECUTION else 'validation-only'
    return s


def run(feed_path=MARKET, state_path=STATE, *, today=None) -> dict:
    today = today or dt.datetime.now(dt.timezone.utc).date()
    feed = json.loads(Path(feed_path).read_text(encoding='utf-8'))
    date, series = quotes(feed, today)
    s, first = load_state(Path(state_path), date)
    if first:
        record(s, date, 'initialised', 'Início da observação prospetiva; sem transações retroativas')
    elif date > s['last_processed']:
        # If sessions were skipped, do not pretend to have executed at dates we missed.
        if ALLOW_VIRTUAL_EXECUTION and s.get('pending'):
            prev = dt.date.fromisoformat(s['last_processed'])
            elapsed = (dt.date.fromisoformat(date) - prev).days
            if elapsed > 7:
                record(s, date, 'cancel', 'Ordem pendente anulada após ausência prolongada de dados')
                s['pending'] = None
        vix = None
        block = feed.get('context', {}).get('vix', {})
        available = [x for x in block.get('prices', []) if isinstance(x, dict) and x.get('date', '') <= date]
        if available:
            last_vix = available[-1]
            if (dt.date.fromisoformat(date) - dt.date.fromisoformat(last_vix['date'])).days <= 4:
                vix = {'date': last_vix['date'], 'value': last_vix['close']}
        process(s, date, series, vix)
    if not ALLOW_VIRTUAL_EXECUTION:
        s['status'] = 'validation-only'
    elif s['status'] == 'validation-only':
        # No new market session yet: switch status only, not simulated positions.
        s['status'] = 'monitoring'
    s['last_attempt_utc'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    # Market data freshness is independently verified before state mutation.
    path = Path(state_path)
    path.parent.mkdir(exist_ok=True, parents=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)
    return s


if __name__ == '__main__':
    st = run()
    print('Forex Autopilot simulação:', st['status'], 'fecho', st['market_date'],
          'transações fictícias iniciadas', st['trade_count'], 'caixa EUR', round(st['cash'], 2))
