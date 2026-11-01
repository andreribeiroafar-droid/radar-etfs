/* Radar ETF v4 — deterministic research engine, zero broker connections. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.RadarEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const FUNDS={
 nasdaq:{name:'Invesco EQQQ Nasdaq-100 UCITS ETF (Acc)',short:'Nasdaq-100',ticker:'EQAC.MI',isin:'IE00BFZXGZ54',color:'#64a9fa'},
 sp500:{name:'iShares S&P 500 EUR Hedged UCITS ETF (Acc)',short:'S&P 500',ticker:'IBCF.DE',isin:'IE00B3ZW0K18',color:'#61e2c4'},
 world:{name:'iShares Core MSCI World UCITS ETF USD (Acc)',short:'MSCI World',ticker:'EUNL.DE',isin:'IE00B4L5Y983',color:'#f5bd61'}
};
const CONTEXT={vix:{name:'VIX · volatilidade EUA',ticker:'^VIX'},ndx:{name:'Nasdaq-100 · EUA',ticker:'^NDX'},us:{name:'S&P 500 · EUA',ticker:'^GSPC'},europe:{name:'STOXX Europe 600 · Europa',ticker:'^STOXX'},japan:{name:'Nikkei 225 · Japão',ticker:'^N225'},us10y:{name:'Treasury 10 anos · yield',ticker:'^TNX'},eurusd:{name:'EUR/USD',ticker:'EURUSD=X'},oil:{name:'Petróleo WTI',ticker:'CL=F'},gold:{name:'Ouro',ticker:'GC=F'}};
const DEFAULT_PORTFOLIO={date:'',tr:{nasdaq:0,sp500:0},deg:{nasdaq:0,sp500:0,world:0}};
const clone=x=>JSON.parse(JSON.stringify(x));
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:0;
const totalByFund=p=>({nasdaq:num(p?.tr?.nasdaq)+num(p?.deg?.nasdaq),sp500:num(p?.tr?.sp500)+num(p?.deg?.sp500),world:num(p?.deg?.world)});
function normalize(rows){if(!Array.isArray(rows))return [];const out=[],seen=new Set();for(const r of rows){if(typeof r?.date!=='string'||!/^(19|20)\d\d-\d\d-\d\d$/.test(r.date))continue;const price=Number(r.close);if(!Number.isFinite(price)||price<=0||price>100000000||seen.has(r.date))continue;seen.add(r.date);out.push({date:r.date,close:price});}return out.sort((a,b)=>a.date.localeCompare(b.date));}
const pct=(current,old)=>old>0?(current/old-1)*100:NaN;
const avg=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
function signalAt(rows,i){
 if(i<200||i>=rows.length)return {state:'none',candidate:false,reason:'Histórico insuficiente: são exigidos 201 fechos.'};
 const price=rows[i].close,sma50=avg(rows.slice(i-49,i+1).map(r=>r.close)),sma200=avg(rows.slice(i-199,i+1).map(r=>r.close));
 const high60=Math.max(...rows.slice(i-59,i+1).map(r=>r.close)),drawdown=pct(price,high60),day=pct(price,rows[i-1].close),five=pct(price,rows[i-5].close);
 const realizedVol=Math.sqrt(252)*Math.sqrt(avg(rows.slice(i-19,i+1).map((r,j,a)=>j?Math.pow(Math.log(r.close/a[j-1].close),2):0).slice(1)))*100;
 let state,reason;
 if(day<=-3||five<=-6||(price<sma200&&sma50<sma200)) {state='red';reason=day<=-3?'Queda diária igual ou superior a 3%.':five<=-6?'Queda acumulada superior a 6% em cinco sessões.':'Preço e média de 50 sessões abaixo da média de 200.';}
 else if(price<sma200||drawdown<=-10||day<=-2){state='yellow';reason=price<sma200?'Preço abaixo da média de 200 sessões.':drawdown<=-10?'Queda superior a 10% desde o máximo de 60 sessões.':'Queda diária de 2% ou mais.';}
 else if(sma50>=sma200){state='green';reason='Preço e tendência de 50 sessões acima da média de 200.';}
 else{state='yellow';reason='Média de 50 sessões ainda inferior à média de 200.';}
 const recovery=rows[i].close>rows[i-1].close&&rows[i-1].close>rows[i-2].close;
 const candidate=state==='green'&&drawdown<=-3&&drawdown>=-8&&recovery&&day<2;
 return {state,candidate,reason,date:rows[i].date,price,sma50,sma200,drawdown,day,five,vol:realizedVol,recovery};
}
function signal(rows){const data=normalize(rows);return signalAt(data,data.length-1);}
function isFresh(date,now=new Date(),maxAge=8){if(!date)return false;const parsed=new Date(date+'T22:00:00Z'),age=(now.getTime()-parsed.getTime())/86400000;return age<maxAge&&age>-1;}
function contextSummary(context,now=new Date()){
 const out={};for(const [id,c] of Object.entries(CONTEXT)){
  const f=context?.[id];if(!f||f.ticker!==c.ticker)continue;
  const data=normalize(f.prices);if(!data.length)continue;
  const last=data.at(-1),prev=data.at(-2),sma200=data.length>=200?avg(data.slice(-200).map(r=>r.close)):null;
  out[id]={...last,fresh:isFresh(last.date,now),day:prev?pct(last.close,prev.close):null,above200:sma200!==null?last.close>sma200:null,sma200,n:data.length};
 }
 return out;
}
function guardCandidate(etfSignal,macro){
 if(!etfSignal?.fresh)return {ok:false,level:'blocked',reason:'Cotação ausente, desatualizada ou histórico insuficiente.'};
 if(!etfSignal.candidate)return {ok:false,level:'wait',reason:'Ainda não se verificam todas as condições técnicas de observação.'};
 for(const id of ['vix','us','ndx'])if(!macro?.[id]?.fresh)return {ok:false,level:'blocked',reason:'Falta validação recente do VIX, S&P 500 ou Nasdaq-100.'};
 if(macro.vix.close>=30)return {ok:false,level:'wait',reason:'VIX igual ou superior a 30: suspender novas entradas na experiência.'};
 if(!macro.us.above200||!macro.ndx.above200)return {ok:false,level:'wait',reason:'Índices americanos não confirmam tendência acima de 200 sessões.'};
 if(macro.us.day<=-2||macro.ndx.day<=-3)return {ok:false,level:'wait',reason:'Queda de mercado anormal na sessão: evitar compra por impulso.'};
 return {ok:true,level:'candidate',reason:'Condições de observação satisfeitas. É um candidato, não uma previsão de lucro.'};
}
const factor=state=>state==='green'?1:state==='yellow'?.5:0;
function maxDrawdown(values){let peak=0,worst=0;for(const v of values){peak=Math.max(peak,v);if(peak>0)worst=Math.min(worst,(v/peak-1)*100);}return worst;}
function runBacktest(history,weights,feeRate=.002){
 const ids=Object.keys(FUNDS),rows=Object.fromEntries(ids.map(id=>[id,normalize(history?.[id]?.prices||history?.[id]||[])]));
 const lookups=Object.fromEntries(ids.map(id=>[id,new Map(rows[id].map((r,i)=>[r.date,{price:r.close,index:i}]))]));
 const dates=rows.nasdaq.map(r=>r.date).filter(d=>ids.every(id=>lookups[id].has(d)&&lookups[id].get(d).index>=200));
 const all=ids.reduce((n,id)=>n+num(weights?.[id]),0);
 if(!all)return {ok:false,why:'Importa a carteira privada para criar ponderações reais.'};
 if(dates.length<80)return {ok:false,why:'Histórico comparável insuficiente: são exigidas 201 sessões para calcular o sinal e pelo menos 80 sessões em comum.'};
 const w=Object.fromEntries(ids.map(id=>[id,num(weights[id])/all]));
 const signals=Object.fromEntries(ids.map(id=>[id,rows[id].map((r,i)=>signalAt(rows[id],i))]));
 const price=(id,d)=>lookups[id].get(d).price;
 function simulate(period,fee){
   const start=1000,unitsHold=Object.fromEntries(ids.map(id=>[id,0])),unitsAdapt=Object.fromEntries(ids.map(id=>[id,0]));
   let cashHold=start,cashAdapt=start,feesH=0,feesA=0,trades=0;
   const bh=[],ad=[];
   for(let j=0;j<period.length;j++){
     const d=period[j],p=Object.fromEntries(ids.map(id=>[id,price(id,d)]));
     if(j===0){feesH=start*fee;cashHold=0;for(const id of ids)unitsHold[id]=(start-feesH)*w[id]/p[id];}
     const before=cashAdapt+ids.reduce((acc,id)=>acc+unitsAdapt[id]*p[id],0);
     const desired={};
     for(const id of ids){const idx=lookups[id].get(d).index; // Sinal anterior ao dia de negociação: sem olhar para o fecho atual.
       desired[id]=w[id]*factor(signals[id][idx-1].state);
     }
     const turnover=ids.reduce((sum,id)=>sum+Math.abs(before*desired[id]-unitsAdapt[id]*p[id]),0);
     if(turnover>before*0.005){ // zona morta para evitar custos de microajustes
       const cost=turnover*fee;feesA+=cost;const equity=Math.max(0,before-cost);
       for(const id of ids)unitsAdapt[id]=equity*desired[id]/p[id];
       cashAdapt=equity*(1-ids.reduce((sum,id)=>sum+desired[id],0));trades++;
     }
     const bhVal=cashHold+ids.reduce((sum,id)=>sum+unitsHold[id]*p[id],0);
     const adVal=cashAdapt+ids.reduce((sum,id)=>sum+unitsAdapt[id]*p[id],0);
     bh.push(bhVal);ad.push(adVal);
   }
   const metrics=s=>{
     const d=Math.max((period.length-1)/252,.01),daily=s.slice(1).map((v,i)=>Math.log(v/s[i])),mean=daily.length?avg(daily):0;
     const varlog=daily.length>1?avg(daily.map(x=>(x-mean)**2)):0;
     return {end:s.at(-1),returnPct:pct(s.at(-1),start),drawdown:maxDrawdown([start,...s]),annualized:(Math.pow(s.at(-1)/start,1/d)-1)*100,volatility:Math.sqrt(varlog*252)*100};
   };
   return {from:period[0],to:period.at(-1),sessions:period.length,hold:metrics(bh),adapt:metrics(ad),holdSeries:bh,adaptSeries:ad,rebalances:trades,feeCost:{hold:feesH,adapt:feesA}};
 }
 const whole=simulate(dates,feeRate);
 const pivot=Math.floor(dates.length*.75),holdout=dates.length>=504?simulate(dates.slice(pivot),feeRate):null;
 const training=dates.length>=504?simulate(dates.slice(0,pivot),feeRate):null;
 const costly=simulate(dates,Math.max(.005,feeRate));
 const cases=[];
 for(const c of [{title:'Covid · fevereiro–abril 2020',start:'2020-02-19',end:'2020-04-30'}, {title:'Inflação e taxas · 2022',start:'2022-01-03',end:'2022-12-30'}, {title:'Tecnologia · outubro 2026',start:'2026-10-01',end:'2026-10-30'}]){
   const window=dates.filter(d=>d>=c.start&&d<=c.end);
   if(window.length>=20)cases.push({title:c.title,...simulate(window,feeRate)});
 }
 return {ok:true,...whole,training,holdout,stressCases:cases,highFee:{hold:costly.hold,adapt:costly.adapt},feeRate,historyStart:rows.nasdaq[0].date};
}

/* Paper-trading v3: deterministic results, with no retroactive fills. */
function calendarPlus(date,days){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const d=new Date(date+'T12:00:00Z');
 if(!Number.isFinite(d.getTime()))return null;
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
function executeTrial(trial,rows,feeRate=.002){
 const t={...trial};
 if(t.fillDate&&t.fillPrice>0&&t.units>0)return t;
 const prices=normalize(rows);
 const recordDate=typeof t.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(t.recordedAt)?t.recordedAt.slice(0,10):t.signalDate;
 const cutoff=recordDate>t.signalDate?recordDate:t.signalDate;
 const first=prices.find(r=>r.date>cutoff);
 if(!first)return t; // Only a close after the signal and recording date can fill the paper order.
 const amount=Number(t.amount);
 if(!(amount>0))return t;
 const fee=amount*feeRate;
 return {...t,fillDate:first.date,fillPrice:first.close,entryFee:fee,units:(amount-fee)/first.close,feeRate};
}
function trialOutcome(trial,rows,horizon,feeRate=.002){
 if(!trial?.fillDate||!(trial.fillPrice>0)||!(trial.units>0))return {status:'awaiting_entry'};
 const prices=normalize(rows),dayCount=horizon==='session'?null:Number(horizon);
 if(horizon!=='session'&&(!Number.isInteger(dayCount)||dayCount<=0))return {status:'invalid_horizon'};
 const target=horizon==='session'?null:calendarPlus(trial.fillDate,dayCount);
 const after=prices.find(r=>horizon==='session'?r.date>trial.fillDate:r.date>=target);
 if(!after)return {status:'pending',targetDate:target};
 const fee=Number.isFinite(trial.feeRate)?trial.feeRate:feeRate;
 const proceeds=trial.units*after.close*(1-fee);
 const pnl=proceeds-trial.amount;
 return {status:'complete',targetDate:target,observedDate:after.date,price:after.close,proceeds,pnl,returnPct:pct(proceeds,trial.amount)};
}
function paperSummary(trials,marketData,feeRate=.002){
 const items=[];let available=1000,reserved=0,markToMarket=0,unknown=0;
 for(const original of trials){
   if(!Object.prototype.hasOwnProperty.call(FUNDS,original?.id)||Number(original?.amount)!==250)continue;
   const rows=normalize(marketData?.[original.id]?.prices||[]);
   const trial=executeTrial(original,rows,feeRate);
   const quote=rows.at(-1);
   available-=250;
   let current=null;
   if(!trial.fillDate)reserved+=250;
   else if(quote&&quote.date>=trial.fillDate){
     const fee=Number.isFinite(trial.feeRate)?trial.feeRate:feeRate;
     current=trial.units*quote.close*(1-fee);
     markToMarket+=current;
   } else unknown++;
   items.push({trial,quote,current,
     nextSession:trialOutcome(trial,rows,'session',feeRate),
     week:trialOutcome(trial,rows,7,feeRate),
     month:trialOutcome(trial,rows,30,feeRate),quarter:trialOutcome(trial,rows,90,feeRate)});
 }
 return {items,available,reserved,markToMarket,value:unknown?null:available+reserved+markToMarket,unknown};
}

/* v4: historical event-study, separate from the defensive regime backtest.
   Decisions at close i, entry at close i+1, results on first close >= calendar horizon.
   Candidate rule only: macro guards and portfolio concentration intentionally NOT backtested. */
function entryStudy(history,feeRate=.002){
 const horizons=[7,30,90],funds={};let total=0;
 for(const id of Object.keys(FUNDS)){
  const rows=normalize(history?.[id]?.prices||[]),candidates=[],monthly=[];
  if(rows.length<350){funds[id]={ok:false,reason:'Histórico inferior a 350 fechos.'};continue;}
  const dateMap=new Map(rows.map((r,i)=>[r.date,i]));
  const valueAt=(i,days)=>{const target=calendarPlus(rows[i].date,days);const found=rows.find((r,j)=>j>i&&r.date>=target);return found||null;};
  const out=(i)=>{
   const buy=rows[i+1];if(!buy)return null;
   const values=Object.fromEntries(horizons.map(h=>{const sell=valueAt(i+1,h);return [h,sell?((250*(1-feeRate)/buy.close*sell.close*(1-feeRate)/250)-1)*100:null];}));
   if(values[90]===null)return null;
   return {signalDate:rows[i].date,entryDate:buy.date,values};
  };
  let previousDay=-999;
  for(let i=200;i<rows.length-1;i++){
   const sg=signalAt(rows,i);
   if(!sg.candidate||i-previousDay<10)continue;
   const r=out(i);if(r){candidates.push(r);previousDay=i;}
  }
  let lastMonth='';
  for(let i=200;i<rows.length-1;i++){
   const month=rows[i].date.slice(0,7);
   if(month===lastMonth)continue;
   lastMonth=month;
   const result=out(i);if(result)monthly.push(result);
  }
  const summarize=list=>Object.fromEntries(horizons.map(h=>{
   const vals=list.map(i=>i.values[h]).filter(Number.isFinite);
   return [h,{n:vals.length,avg:vals.length?avg(vals):null,wins:vals.filter(x=>x>0).length,worst:vals.length?Math.min(...vals):null}];
  }));
  const cutDate=rows[Math.floor(rows.length*.75)]?.date;
  funds[id]={ok:true,candidates:summarize(candidates),monthly:summarize(monthly),holdout:summarize(candidates.filter(t=>t.signalDate>=cutDate)),count:candidates.length,cutDate,from:rows[200].date,to:rows.at(-1).date};total+=candidates.length;
 }
 return {ok:total>0,funds,total,feeRate};
}
function swingSnapshot(rows,context){
 const p=normalize(rows),s=signalAt(p,p.length-1),macro=contextSummary(context);
 if(!Number.isFinite(s?.price)||p.length<201||!isFresh(s.date))return {ready:false,reason:'Histórico insuficiente ou preço desatualizado.'};
 const prices=p.slice(-20).map(x=>x.close),sma20=avg(prices),previous20=avg(p.slice(-21,-1).map(x=>x.close));
 const vol=s.vol,check=s.state==='green'&&s.price>sma20&&sma20>previous20&&s.day>0&&s.day<=2;
 const macroOk=macro.vix?.fresh&&macro.ndx?.fresh&&macro.us?.fresh&&macro.vix.close<25&&macro.ndx.day>-2.5&&macro.us.day>-2;
 return {ready:true,watch:!!(check&&macroOk),date:s.date,price:s.price,vol,day:s.day,sma20,reason:check&&macroOk?'Condições de observação swing reunidas. Não é prova de rentabilidade.':!macroOk?'Mercado global volátil, em queda ou com dados insuficientes.':'Sem configuração técnica de observação swing.'};
}

return {FUNDS,CONTEXT,DEFAULT_PORTFOLIO,clone,totalByFund,normalize,pct,signalAt,signal,isFresh,contextSummary,guardCandidate,runBacktest,maxDrawdown,calendarPlus,executeTrial,trialOutcome,paperSummary,entryStudy,swingSnapshot};
});
