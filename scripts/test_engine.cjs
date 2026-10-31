const assert=require('node:assert/strict');
const E=require('../engine.js');
const amount=E.totalByFund({tr:{nasdaq:120,sp500:50},deg:{nasdaq:80,sp500:75,world:20}});
assert.deepEqual(amount,{nasdaq:200,sp500:125,world:20});
assert.equal(E.signal([]).state,'none');
assert.equal(E.signal([{date:'2026-10-31',close:100}]).state,'none');
assert.deepEqual(E.normalize([{date:'2026-01-02',close:10},{date:'2026-01-02',close:12},{date:'invalid',close:0}]),[{date:'2026-01-02',close:10}]);
// Every synthetic day is a trading day for the unit test (not real market history).
const base=Date.parse('2020-01-01T00:00:00Z');
const rows=Array.from({length:1250},(_,i)=>({date:new Date(base+i*86400000).toISOString().slice(0,10),close:100+i*.2}));
assert.equal(E.signal(rows).state,'green');
const shock=rows.map(x=>({...x}));shock.at(-1).close=shock.at(-2).close*.95;
assert.equal(E.signal(shock).state,'red');
assert.ok(E.signal(shock).day<-3);
assert.equal(E.maxDrawdown([100,120,60,100]),-50);
assert.equal(E.isFresh('2026-10-30',new Date('2026-10-31T16:00:00Z')),true);
assert.equal(E.isFresh('2026-10-01',new Date('2026-10-31T16:00:00Z')),false);
let decision=E.guardCandidate({fresh:true,candidate:true},{});
assert.equal(decision.ok,false);
const macro={vix:{fresh:true,close:22},us:{fresh:true,above200:true,day:-.2},ndx:{fresh:true,above200:true,day:-1}};
assert.equal(E.guardCandidate({fresh:true,candidate:true},macro).ok,true);
assert.equal(E.guardCandidate({fresh:true,candidate:true},{...macro,vix:{fresh:true,close:32}}).ok,false);
assert.equal(E.guardCandidate({fresh:true,candidate:false},macro).ok,false);
const history=Object.fromEntries(Object.keys(E.FUNDS).map(id=>[id,{prices:rows}]));
const r=E.runBacktest(history,amount);
assert.equal(r.ok,true);
assert.equal(r.sessions,1050);
assert.equal(r.from,rows[200].date);
assert.ok(r.hold.end>1000);
assert.ok(r.adapt.end>0);
assert.ok(r.holdout&&r.training);
assert.equal(r.holdout.from, r.dates?.[Math.floor(r.sessions*.75)] || rows[200+Math.floor(r.sessions*.75)].date);
assert.ok(r.feeCost.adapt>=0);
assert.ok(r.highFee.adapt.end<=r.adapt.end+1e-6);
assert.equal(E.runBacktest({nasdaq:{prices:rows}},amount).ok,false);
assert.equal(E.runBacktest(history,{nasdaq:0,sp500:0,world:0}).ok,false);
const summary=E.contextSummary({vix:{ticker:'^VIX',prices:[{date:'2026-10-29',close:18},{date:'2026-10-30',close:23}]}},new Date('2026-10-31T16:00:00Z'));
assert.equal(summary.vix.fresh,true);
assert.equal(summary.vix.close,23);
console.log('OK: identificação ETFs, datas, filtros macro, drawdown, custos, stress e janela temporal reservada (dados sintéticos de teste).');

// V3 paper trading must not fill with the already known signal-day close.
const sample=[
 {date:'2026-10-29',close:100},
 {date:'2026-10-30',close:100},
 {date:'2026-11-02',close:98},
 {date:'2026-11-03',close:101},
 {date:'2026-11-09',close:97.5},
 {date:'2026-12-02',close:107}
];
const trial={ref:'test-1',id:'nasdaq',amount:250,signalDate:'2026-10-30',signalPrice:100};
assert.equal(E.executeTrial(trial,sample.slice(0,2)).fillDate,undefined);
const placed=E.executeTrial(trial,sample);
const late=E.executeTrial({...trial,recordedAt:'2026-11-02T21:00:00Z'},sample);
assert.equal(late.fillDate,'2026-11-03'); // Never back-fill a session already closed when accepted.
assert.equal(placed.fillDate,'2026-11-02'); // Monday's close, not Friday's
assert.equal(placed.fillPrice,98);
assert.equal(placed.entryFee,0.5);
assert.ok(Math.abs(placed.units-249.5/98)<1e-9);
assert.equal(E.calendarPlus('2026-10-30',7),'2026-11-06');
assert.equal(E.trialOutcome(placed,sample.slice(0,4),7).status,'pending');
const week=E.trialOutcome(placed,sample,7);
assert.equal(week.targetDate,'2026-11-09');
assert.equal(week.observedDate,'2026-11-09');
assert.ok(week.pnl<0); // pessimistic including fees; losing experiments preserved
assert.ok(E.trialOutcome(placed,sample,'session').pnl>0);
assert.equal(E.trialOutcome(placed,sample,30).observedDate,'2026-12-02');
const state=E.paperSummary([trial],{nasdaq:{prices:sample}});
assert.equal(state.available,750);
assert.equal(state.items[0].week.status,'complete');
assert.equal(state.value,750+state.items[0].current);
assert.equal(E.paperSummary([trial],{nasdaq:{prices:sample.slice(0,2)}}).reserved,250);
assert.equal(E.paperSummary([trial],{nasdaq:{prices:sample.slice(0,2)}}).value,1000);
console.log('OK: simulação v3 — execução apenas no fecho seguinte, perdas, prazos de 7/30 dias e taxas de entrada/saída.');
