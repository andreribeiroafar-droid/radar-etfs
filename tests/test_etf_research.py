import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("etf_research",Path(__file__).resolve().parents[1]/"scripts"/"etf_research.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ETFResearchTests(unittest.TestCase):
    def test_flat_market_costs_and_no_free_profit(self):
        for strategy in ("swing","accumulate"):
            out=m.simulate([100.0]*120,strategy)
            self.assertLessEqual(out["return_pct"],0)
            self.assertEqual(out["benchmark_return_pct"],-.3)
    def test_rising_market_no_fabricated_swing(self):
        out=m.simulate([100+i*.1 for i in range(120)],"swing")
        self.assertEqual(out["trade_count"],0)
        self.assertEqual(out["final_eur"],1000)
    def test_drawdown(self):
        self.assertEqual(m.maximum_drawdown([100,120,60,90]),-50)
    def test_invalid_series_rejected(self):
        with self.assertRaises(ValueError):
            m.run({"schema":3,"status":"ok","funds":{k:{"prices":[{"date":"2026-01-01","close":1}]} for k in m.NAMES}})
if __name__=="__main__":unittest.main()
