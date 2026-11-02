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
                if pending['side'] == 'buy' and s['position'] is None and s['cash'] >= TICKET and s['trade_count'] < MAX_TRADES:
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
        if s.get('pending'):
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
