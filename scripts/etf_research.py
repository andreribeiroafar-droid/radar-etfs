"""Reproducible ETF research: distinct swing and accumulation sandboxes.
Historical research ONLY; no paper orders or broker. Signals at close t fill at close t+1.
The first 70% of dates are development; final 30% is untouched evaluation.
Prices are Yahoo adjusted daily closes: indicative, not executable; no spread data.
"""
import json, math, statistics
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/"data/market.json"
OUTPUT=ROOT/"data/strategy_research.json"
CAPITAL=1000.0
TICKET=250.0
FEE=.0015  # illustrative per side; excludes unknown spreads/taxes
NAMES=("nasdaq","sp500","world")

def maximum_drawdown(values):
    peak=values[0]; worst=0.0
    for value in values:
        peak=max(peak,value)
        worst=min(worst,value/peak-1)
    return round(100*worst,3)

def metrics(curve, trades, invested, benchmark):
    final=curve[-1]
    return {"final_eur":round(final,2),"return_pct":round(100*(final/CAPITAL-1),3),
            "max_drawdown_pct":maximum_drawdown(curve),"trade_count":trades,
            "invested_eur":round(invested,2),
            "benchmark_return_pct":round(100*(benchmark[-1]/CAPITAL-1),3),
            "benchmark_max_drawdown_pct":maximum_drawdown(benchmark),
            "excess_return_pp":round(100*(final-benchmark[-1])/CAPITAL,3)}

def simulate(prices, strategy):
    """No lookahead: decisions based on prices[:i], fill on next close.
    Cash not invested remains at zero interest. One ETF per sandbox.
    """
    cash=CAPITAL; units=0.0; trades=0; invested=0.0
    curve=[CAPITAL]; benchmark=[CAPITAL]
    bench_units=(CAPITAL*(1-FEE))/prices[0]
    holding=0; pending=None; entry=0.0
    for i,p in enumerate(prices):
        if i and pending:
            side=pending; pending=None
            if side=="buy" and cash>=TICKET:
                cash-=TICKET; units+=TICKET*(1-FEE)/p; trades+=1; invested+=TICKET
                entry=p; holding=0
            elif side=="sell" and units>0:
                cash+=units*p*(1-FEE); units=0.0; trades+=1; holding=0
        if units: holding+=1
        value=cash+units*p*(1-FEE)
        curve.append(value)
        benchmark.append(bench_units*p*(1-FEE))
        if i==len(prices)-1: continue
        if strategy=="swing":
            if units:
                pnl=(p/entry)*(1-FEE)**2-1
                if pnl<=-.025 or pnl>=.04 or holding>=15:
                    pending="sell"
            elif i>=21:
                # At least 4% below previous 20-day high, followed by two up-closes.
                high=max(prices[i-20:i])
                if p<=high*.96 and p>prices[i-1]>prices[i-2]:
                    pending="buy"
        elif strategy=="accumulate":
            # Fixed monthly contribution, up to four tickets; independent of market direction.
            if i in (0,21,42,63) and cash>=TICKET:
                pending="buy"
        else: raise ValueError(strategy)
    return metrics(curve,trades,invested,benchmark)

def run(feed):
    if feed.get("status")!="ok" or feed.get("schema")!=3:
        raise ValueError("Unverified data schema")
    result={"schema":1,"type":"historical-research-not-live-trading",
            "data_source":feed.get("source"),"data_as_of":feed.get("as_of"),
            "method":"signals at close t; virtual fills at next adjusted close; illustrative 0.15% each side",
            "limitations":["adjusted prices may not represent tradeable fills",
                "unknown spreads, slippage and tax","development/test split is not independent forward validation",
                "parameters are hypotheses, not optimized or proven",
                "buy-and-hold benchmark deploys full 1000 EUR at outset; different exposure from staged strategies"],
            "results":{}}
    for name in NAMES:
        fund=feed["funds"][name]
        rows=fund["prices"]
        dates=[r["date"] for r in rows]
        prices=[float(r["close"]) for r in rows]
        if len(prices)<300 or dates!=sorted(set(dates)) or any(not math.isfinite(p) or p<=0 for p in prices):
            raise ValueError(name+": insufficient or invalid series")
        cut=int(len(prices)*.7)
        result["results"][fund["ticker"]]={
            "isin_unverified":fund.get("isin"),"currency":fund.get("currency"),
            "train_end":dates[cut-1],"test_start":dates[cut],
            "train":{"swing":simulate(prices[:cut],"swing"),
                     "accumulate":simulate(prices[:cut],"accumulate")},
            "test":{"swing":simulate(prices[cut:],"swing"),
                    "accumulate":simulate(prices[cut:],"accumulate")}}
    return result

if __name__=="__main__":
    output=run(json.loads(INPUT.read_text(encoding="utf-8")))
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Research written:",OUTPUT)
