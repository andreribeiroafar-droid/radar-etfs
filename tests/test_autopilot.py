import datetime as dt
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path

MOD = Path(__file__).resolve().parents[1] / 'scripts' / 'forex_autopilot.py'
spec = importlib.util.spec_from_file_location('forex_autopilot', MOD)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def dataset(start=dt.date(2025,1,1), n=265):
    result = {}
    d = start
    while len(result) < n:
        if d.weekday() < 5:
            result[d.isoformat()] = len(result)
        d += dt.timedelta(days=1)
    base=list(result.keys())
    # steady downtrend with periodic small movements to exercise the rule
    fx={}
    for p,initial in [('eurusd',1.15),('eurgbp',.87),('eurjpy',175.)]:
        fx[p] = [{'date':x,'close':initial*(.9995**i)*(1+.001*math.sin(i*.45))} for i,x in enumerate(base)]
    return fx


def feed(series):
    return {'status':'ok','forex':{k:{'ticker':a.PAIRS[k],'base':'EUR','prices':v} for k,v in series.items()},
            'context':{'vix':{'prices':[{'date':x['date'],'close':19} for x in series['eurusd']]}}}


class ForexAutopilotTest(unittest.TestCase):
    def test_initialisation_never_backtrades(self):
        f=dataset(); now=dt.date.fromisoformat(f['eurusd'][-1]['date'])
        with tempfile.TemporaryDirectory() as d:
            market=Path(d)/'market.json'; state=Path(d)/'state.json'
            market.write_text(json.dumps(feed(f)))
            s=a.run(market,state,today=now)
            self.assertEqual(s['trade_count'],0)
            self.assertEqual(s['cash'],1000)
            self.assertIsNone(s['pending'])
            self.assertEqual(s['events'][0]['event'],'initialised')
            s2=a.run(market,state,today=now)
            self.assertEqual(s2['trade_count'],0)
            self.assertEqual(len(s2['events']),1)

    def test_outdated_feed_blocks_any_write(self):
        f=dataset(); now=dt.date.fromisoformat(f['eurusd'][-1]['date'])+dt.timedelta(days=10)
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'market.json'; state=Path(d)/'state.json'
            path.write_text(json.dumps(feed(f)))
            with self.assertRaisesRegex(ValueError,'desatualizado'):
                a.run(path,state,today=now)
            self.assertFalse(state.exists())

    def test_weekend_fx_bar_ignored(self):
        f=dataset(); today=dt.date.fromisoformat(f['eurusd'][-1]['date'])
        saturday=today+dt.timedelta(days=(5-today.weekday())%7)
        if saturday==today:saturday+=dt.timedelta(days=7)
        f['eurjpy'].append({'date':saturday.isoformat(),'close':9999})
        day, series=a.quotes(feed(f), saturday)
        self.assertEqual(day,today.isoformat())

    def test_buy_signal_is_observation_only(self):
        f=dataset(n=263)
        initial=f['eurusd'][-3]['date']; next_day=f['eurusd'][-2]['date']; later=f['eurusd'][-1]['date']
        s=a.new_state(initial)
        segment={k:[r for r in v if r['date']<=next_day] for k,v in f.items()}
        s=a.process(s,next_day,segment,{'date':next_day,'value':18})
        self.assertFalse(a.ALLOW_VIRTUAL_EXECUTION)
        self.assertEqual(s['trade_count'],0)
        self.assertEqual(s['cash'],1000)
        self.assertIsNone(s['pending'])
        self.assertIsNone(s['position'])
        self.assertEqual(s['status'],'validation-only')
        s=a.process(s,later,f,{'date':later,'value':18})
        self.assertEqual(s['trade_count'],0)
        self.assertEqual(s['cash'],1000)
        self.assertIsNone(s['position'])

    def test_pending_buy_is_blocked_and_preserved(self):
        f=dataset()
        previous=f['eurusd'][-2]['date']; current=f['eurusd'][-1]['date']
        s=a.new_state(previous)
        s['pending']={'side':'buy','pair':'eurgbp','signal_date':previous,'reason':'legacy'}
        original=dict(s['pending'])
        a.process(s,current,f,{'date':current,'value':18})
        self.assertEqual(s['cash'],1000)
        self.assertEqual(s['trade_count'],0)
        self.assertIsNone(s['position'])
        self.assertEqual(s['pending'],original)
        self.assertTrue(any(e['event']=='execution-blocked' for e in s['events']))
