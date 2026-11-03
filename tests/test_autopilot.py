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
    def setUp(self):
        self.original_execution = a.ALLOW_VIRTUAL_EXECUTION
        a.ALLOW_VIRTUAL_EXECUTION = False

    def tearDown(self):
        a.ALLOW_VIRTUAL_EXECUTION = self.original_execution

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


    def test_deterministic_entry_rejects_high_vix(self):
        f=dataset()
        last=f['eurusd'][-1]['date']
        self.assertIsNone(a.entry_candidate(f,last, {'date':last,'value':31}))
        self.assertIsNone(a.entry_candidate(f,last, None))

    def test_pending_sell_is_blocked_and_position_preserved(self):
        f=dataset()
        current=f['eurusd'][-1]['date']; previous=f['eurusd'][-2]['date']
        entry=f['eurusd'][-2]['close']
        s=a.new_state(previous)
        s['cash']=750
        s['trade_count']=1
        s['position']={'pair':'eurusd','buy_date':previous,'entry_rate':entry,
                       'foreign_units':250*(1-a.FEE)*entry,'eur_debited':250,'bars_held':1}
        s['pending']={'side':'sell','pair':'eurusd','signal_date':previous,'reason':'teste'}
        old_position=dict(s['position']); old_pending=dict(s['pending'])
        a.process(s,current,f,{'date':current,'value':18})
        self.assertEqual(s['position'],old_position)
        self.assertEqual(s['pending'],old_pending)
        self.assertEqual(s['cash'],750)
        self.assertEqual(s['trade_count'],1)
        self.assertEqual(s['closed'],[])
        self.assertTrue(any(e['event']=='execution-blocked' for e in s['events']))

    def test_run_preserves_existing_ledger(self):
        f=dataset()
        current=f['eurusd'][-1]['date']; previous=f['eurusd'][-2]['date']
        with tempfile.TemporaryDirectory() as d:
            market=Path(d)/'market.json'; state=Path(d)/'state.json'
            market.write_text(json.dumps(feed(f)))
            s=a.new_state(previous)
            s['pending']={'side':'buy','pair':'eurgbp','signal_date':previous,'reason':'legacy'}
            s['events']=[{'date':previous,'event':'buy-signal','details':'historical'}]
            state.write_text(json.dumps(s))
            result=a.run(market,state,today=dt.date.fromisoformat(current))
            self.assertEqual(result['cash'],1000)
            self.assertEqual(result['trade_count'],0)
            self.assertEqual(result['pending'],s['pending'])
            self.assertEqual(result['events'][0],s['events'][0])
            self.assertEqual(result['status'],'validation-only')
            self.assertEqual(json.loads(state.read_text())['cash'],1000)


    def test_stale_pending_is_preserved_in_validation_mode(self):
        f=dataset()
        current=f['eurusd'][-1]['date']
        old=(dt.date.fromisoformat(current)-dt.timedelta(days=12)).isoformat()
        with tempfile.TemporaryDirectory() as d:
            market=Path(d)/'market.json'; state=Path(d)/'state.json'
            market.write_text(json.dumps(feed(f)))
            s=a.new_state(old)
            s['pending']={'side':'buy','pair':'eurgbp','signal_date':old,'reason':'legacy'}
            state.write_text(json.dumps(s))
            result=a.run(market,state,today=dt.date.fromisoformat(current))
            self.assertEqual(result['pending'],s['pending'])
            self.assertEqual(result['cash'],1000)
            self.assertEqual(result['trade_count'],0)
            self.assertEqual(result['status'],'validation-only')


    def test_activation_cancels_legacy_pending_without_buying(self):
        a.ALLOW_VIRTUAL_EXECUTION = True
        f=dataset()
        current=f['eurusd'][-1]['date']; previous=f['eurusd'][-2]['date']
        s=a.new_state(previous)
        s['status']='validation-only'
        s['pending']={'side':'buy','pair':'eurgbp','signal_date':previous,'reason':'legacy'}
        a.process(s,current,f,{'date':current,'value':31})
        self.assertEqual(s['cash'],1000)
        self.assertEqual(s['trade_count'],0)
        self.assertIsNone(s['pending'])
        self.assertIsNone(s['position'])
        self.assertTrue(any(e['event']=='cancel' for e in s['events']))

    def test_paper_buy_and_sell_account_for_both_fees(self):
        a.ALLOW_VIRTUAL_EXECUTION = True
        f=dataset()
        d0=f['eurusd'][-3]['date']; d1=f['eurusd'][-2]['date']; d2=f['eurusd'][-1]['date']
        s=a.new_state(d0)
        s['status']='monitoring'
        s['pending']={'side':'buy','pair':'eurusd','signal_date':d0,'reason':'test'}
        a.process(s,d1,f,{'date':d1,'value':19})
        self.assertEqual(s['cash'],750)
        self.assertEqual(s['trade_count'],1)
        self.assertIsNotNone(s['position'])
        s['pending']={'side':'sell','pair':'eurusd','signal_date':d1,'reason':'test'}
        a.process(s,d2,f,{'date':d2,'value':19})
        self.assertIsNone(s['position'])
        self.assertEqual(len(s['closed']),1)
        expected=250*(1-a.FEE)*f['eurusd'][-2]['close']/f['eurusd'][-1]['close']*(1-a.FEE)
        self.assertAlmostEqual(s['closed'][0]['received_eur'],expected,places=6)
        self.assertAlmostEqual(s['cash'],750+expected,places=6)

    def test_high_vix_cancels_pending_paper_buy(self):
        a.ALLOW_VIRTUAL_EXECUTION = True
        f=dataset()
        d0=f['eurusd'][-2]['date']; d1=f['eurusd'][-1]['date']
        s=a.new_state(d0)
        s['status']='monitoring'
        s['pending']={'side':'buy','pair':'eurusd','signal_date':d0,'reason':'test'}
        a.process(s,d1,f,{'date':d1,'value':31})
        self.assertEqual(s['cash'],1000)
        self.assertEqual(s['trade_count'],0)
        self.assertIsNone(s['position'])

if __name__=='__main__':unittest.main()
