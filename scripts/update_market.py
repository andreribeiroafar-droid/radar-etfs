"""Radar ETF v2 data job. Download adjusted ETF closes and optional macro context.

Data provider: Yahoo Finance via yfinance (unofficial). This is not a live feed.
Exit nonzero and leave previous snapshot unchanged if one of three essential ETFs fails.
Optional context symbols can fail independently. ETF series must be checked against
issuer ISIN/currency mapping manually: Yahoo does not independently attest ISIN.
"""
import datetime as dt
import json
import math
from pathlib import Path
import sys

import yfinance as yf

OUT = Path(__file__).resolve().parents[1] / "data" / "market.json"
FUNDS = {
    "nasdaq": ("EQAC.MI", "IE00BFZXGZ54", "EUR"),
    "sp500": ("IBCF.DE", "IE00B3ZW0K18", "EUR"),
    "world": ("EUNL.DE", "IE00B4L5Y983", "EUR"),
}
# Relevant cross-asset indicators, not a claim to analyze literally every market.
CONTEXT = {
    "vix": "^VIX", "ndx": "^NDX", "us": "^GSPC", "europe": "^STOXX",
    "japan": "^N225", "us10y": "^TNX", "eurusd": "EURUSD=X",
    "oil": "CL=F", "gold": "GC=F",
}

def load_prices(ticker, minimum=0):
    frame = ticker.history(period="10y", interval="1d", auto_adjust=True,
                           actions=False, raise_errors=True)
    if frame is None or frame.empty:
        raise ValueError("Sem histórico")
    unique = {}
    for stamp, r in frame.iterrows():
        value = float(r["Close"])
        if math.isfinite(value) and 0 < value < 100_000_000:
            unique[stamp.date().isoformat()] = {"date": stamp.date().isoformat(), "close": round(value, 6)}
    prices = [unique[d] for d in sorted(unique)]
    if len(prices) < minimum:
        raise ValueError(f"Apenas {len(prices)} fechos, são necessários {minimum}")
    return prices

def get_data():
    today = dt.datetime.now(dt.timezone.utc).date()
    funds, context, latest_dates, notes = {}, {}, [], []
    for key, (symbol, isin, ccy) in FUNDS.items():
        print(f"A validar ETF {key} {symbol} ISIN {isin}", flush=True)
        obj = yf.Ticker(symbol)
        meta = obj.get_history_metadata() or {}
        currency = (meta.get("currency") or "").upper()
        if currency != ccy:
            raise ValueError(f"{symbol}: moeda inesperada {currency!r}, esperado {ccy}")
        prices = load_prices(obj, 260)
        last = dt.date.fromisoformat(prices[-1]["date"])
        if not dt.timedelta(days=0) <= today - last <= dt.timedelta(days=8):
            raise ValueError(f"{symbol}: última sessão ausente/desatualizada ({last})")
        latest_dates.append(last)
        funds[key] = {"ticker": symbol, "isin": isin, "currency": ccy,
                      "exchange": "Milan" if symbol.endswith(".MI") else "Xetra",
                      "last_date": prices[-1]["date"], "prices": prices}
        print(f"{key}: {len(prices)} sessões, último dia {last}")
    if (max(latest_dates) - min(latest_dates)).days > 4:
        raise ValueError("Fechos dos três ETFs demasiado afastados")
    for key, symbol in CONTEXT.items():
        try:
            print(f"Indicador de contexto {symbol}", flush=True)
            obj = yf.Ticker(symbol)
            prices = load_prices(obj, minimum=2)
            last = dt.date.fromisoformat(prices[-1]["date"])
            if last > today or (today - last).days > 8:
                raise ValueError(f"fonte antiga: {last}")
            context[key] = {"ticker": symbol, "last_date": prices[-1]["date"], "prices": prices}
        except Exception as ex:
            msg = f"{key}/{symbol} indisponível: {ex}"
            notes.append(msg)
            print("NOTA: " + msg, file=sys.stderr)
    return {"status": "ok", "schema": 2,
            "source": "Yahoo Finance via yfinance (não oficial; adjusted daily closes)",
            "as_of": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "funds": funds, "context": context, "source_notes": notes}

if __name__ == "__main__":
    try:
        feed = get_data()
        OUT.parent.mkdir(exist_ok=True, parents=True)
        tmp = OUT.with_suffix(".tmp")
        tmp.write_text(json.dumps(feed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(OUT)
        print("Atualização concluída:", OUT)
    except Exception as ex:
        print(f"ERRO: feed anterior preservado: {ex}", file=sys.stderr)
        sys.exit(1)
