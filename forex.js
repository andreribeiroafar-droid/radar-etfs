'use strict';
/* Forex Lab 4.1. Funded currency-conversion simulator; never connects to a broker. */
(()=>{
const P={
 eurusd:{ticker:'EURUSD=X',name:'EUR/USD',currency:'USD',decimals:4},
 eurgbp:{ticker:'EURGBP=X',name:'EUR/GBP',currency:'GBP',decimals:4},
 eurjpy:{ticker:'EURJPY=X',name:'EUR/JPY',currency:'JPY',decimals:2}
};
const FEE=.0015, BUDGET=1000, TICKET=250, STORE='radar-forex-trials-v1';
const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(n);
const num=(n,d=2)=>new Intl.NumberFormat('pt-PT',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
function rows(raw){
 const map=new Map();
 for(const x of Array.isArray(raw)?raw:[]){
  if(typeof x?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.close)&&x.close>0&&x.close<100000){map.set(x.date,{date:x.date,close:x.close});}
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function future(date,days){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
function fresh(date){if(!date)return false;const elapsed=(Date.now()-Date.parse(date+'T23:59:59Z'))/86400000;return elapsed>=-1&&elapsed<=5;}
function verify(raw){
 if(!Array.isArray(raw)||raw.length>4)return [];
 const refs=new Set(),out=[];
 for(const t of raw){
  if(!t||!P[t.id]||t.amount!==250||!/^\d{4}-\d{2}-\d{2}$/.test(t.signalDate)||
    !Number.isFinite(t.signalRate)||t.signalRate<=0||typeof t.recordedAt!=='string'||
    !/^\d{4}-\d{2}-\d{2}T/.test(t.recordedAt)||typeof t.ref!=='string'||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(t.ref)||refs.has(t.ref))return [];
  if(t.fillDate!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(t.fillDate)||t.fillDate<=t.recordedAt.slice(0,10)||
    !Number.isFinite(t.fillRate)||t.fillRate<=0||!Number.isFinite(t.foreignUnits)||t.foreignUnits<=0))return [];
  refs.add(t.ref);
  out.push({id:t.id,amount:TICKET,signalDate:t.signalDate,signalRate:t.signalRate,recordedAt:t.recordedAt,
   ref:t.ref,fillDate:t.fillDate||null,fillRate:t.fillRate||null,foreignUnits:t.foreignUnits||null});
 }
 return out;
}
function evaluate(t,priceRows){
 const prices=rows(priceRows),copy={...t};
 if(!copy.fillDate){
  const eligible=prices.find(x=>x.date>copy.recordedAt.slice(0,10));
  if(eligible){copy.fillDate=eligible.date;copy.fillRate=eligible.close;copy.foreignUnits=TICKET*(1-FEE)*eligible.close;}
 }
 if(!copy.fillDate)return {trial:copy,status:'pending',value:TICKET,metrics:{}};
 const recent=prices.at(-1),mark=recent?.date>=copy.fillDate?copy.foreignUnits/recent.close*(1-FEE):null;
 const metrics={};
 for(const [key,days] of [['day',null],['w7',7],['d30',30],['d90',90]]){
  const due=days===null?prices.find(x=>x.date>copy.fillDate):prices.find(x=>x.date>=future(copy.fillDate,days));
  if(!due){metrics[key]=null;continue;}
  const value=copy.foreignUnits/due.close*(1-FEE);
  metrics[key]={date:due.date,value,pnl:value-TICKET,pct:100*(value/TICKET-1)};
 }
 return {trial:copy,status:'filled',value:mark,latestDate:recent?.date,metrics};
}
window.ForexLabModel={rows,verify,evaluate,future};
let rates={},trials=[];
try{trials=verify(JSON.parse(localStorage.getItem(STORE)));}catch{trials=[];}
function save(){try{localStorage.setItem(STORE,JSON.stringify(trials));}catch{say('Não foi possível guardar as experiências neste navegador. Exporta o histórico.');}}
function say(text){$('fx-hint').textContent=text;}
function metricsMarkup(m){
 const entries=[['Após 1 sessão','day'],['Após 7 dias','w7'],['Após 30 dias','d30'],['Após 90 dias','d90']];
 return entries.map(([label,key])=>{
   const z=m[key];return `<div><span>${label}</span>${z?`<strong class="${z.pnl>=0?'result-plus':'result-minus'}">${z.pnl>=0?'+':''}${fmt(z.pnl)} (${z.pct>=0?'+':''}${num(z.pct,2)}%)</strong><small>${z.date}</small>`:'<span class="result-wait">Sem fecho elegível</span>'}</div>`;
 }).join('');
}
function render(){
 const wrap=$('fx-cards');if(!wrap)return;
 wrap.replaceChildren();
 const available=Object.entries(P).filter(([k])=>rates[k]?.prices?.length>=50&&fresh(rates[k].prices.at(-1).date));
 $('fx-status').className='market-banner '+(available.length===3?'success':'warn');
 $('fx-status').textContent=`${available.length}/3 pares com histórico e fecho recentes · fonte não oficial Yahoo/yfinance · dados EOD, não tempo real${available.length<3?' · operações sem dados bloqueadas':''}`;
 for(const [id,c] of Object.entries(P)){
  const series=rates[id]?.prices||[],last=series.at(-1),prev=series.at(-2),ok=series.length>=50&&fresh(last?.date);
  const daily=ok&&prev?100*(last.close/prev.close-1):null;
  const month=ok?series.slice(-20).reduce((sum,x)=>sum+x.close,0)/Math.min(20,series.length):null;
  const item=document.createElement('article');item.className='macro-card fx-card';
  const desc=document.createElement('small');desc.textContent=`${c.name} · Yahoo: ${c.ticker}`;
  const price=document.createElement('strong');price.textContent=ok?num(last.close,c.decimals):'Sem dados';
  const info=document.createElement('span');info.textContent=ok?`Fecho ${last.date} · variação ${daily>=0?'+':''}${num(daily,2)}%`:'Fonte ausente ou antiga';
  const hint=document.createElement('p');hint.className='muted';hint.textContent=ok?`Média 20 sessões: ${num(month,c.decimals)}. Uma queda de ${c.name} beneficia quem tem ${c.currency}. Não é sinal de compra.`:'Nenhuma previsão ou preço é inventado.';
  item.append(desc,price,info,hint);wrap.append(item);
 }
 const target=$('fx-pair').value,series=rates[target]?.prices||[],quote=series.at(-1),hasData=series.length>=50&&fresh(quote?.date);
 const same=trials.some(t=>t.id===target&&t.signalDate===quote?.date);
 $('fx-order').disabled=!hasData||trials.length>=4||same;
 say(!hasData?'Este par ainda não tem histórico validado e recente. Corre a atualização do GitHub Actions.':trials.length>=4?'As quatro experiências FX já estão registadas.':same?'Já existe uma experiência para este par no mesmo fecho.':'Conversão manual de 250 € virtuais; preço de execução apenas após um novo fecho. Sem recomendação de investimento.');
 let held=0;const position=$('fx-positions');position.replaceChildren();
 for(let i=0;i<trials.length;i++){
  const t=trials[i],z=evaluate(t,rates[t.id]?.prices||[]);
  if(z.trial.fillDate&&!t.fillDate){trials[i]=z.trial;save();}
  held+=(z.value??TICKET);
  const article=document.createElement('article');article.className='trial-card';
  const head=document.createElement('div');head.className='trial-head';
  const left=document.createElement('div'),name=document.createElement('div');name.className='trial-title';name.textContent=`${P[t.id].currency} comprados com EUR · 250 € virtuais`;
  const sub=document.createElement('small');sub.textContent=z.status==='pending'?`Registo ${t.recordedAt.slice(0,10)} · a aguardar próximo fecho`:`Conversão ${z.trial.fillDate} · 1 EUR = ${num(z.trial.fillRate,P[t.id].decimals)} ${P[t.id].currency}`;
  left.append(name,sub);const right=document.createElement('div');right.className='trial-current';right.textContent=z.status==='pending'?'250 € reservados':z.value===null?'Sem cotação atual':`Valor hipotético de liquidação: ${fmt(z.value)} (${z.latestDate})`;head.append(left,right);
  const grid=document.createElement('div');grid.className='horizon-grid';grid.innerHTML=metricsMarkup(z.metrics);if(z.status==='pending')grid.querySelectorAll('.result-wait').forEach(e=>e.textContent='A aguardar conversão');
  const note=document.createElement('div');note.className='trial-note';note.textContent='Conversão sem alavancagem. Resultado líquido ilustrativo com custos de 0,15% na entrada e 0,15% na saída; não é ordem real nem garante preço de execução.';
  article.append(head,grid,note);position.append(article);
 }
 if(!trials.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Nenhuma conversão virtual registada. Os dados históricos têm de estar atuais para começar.';position.append(empty);}
 const cash=BUDGET-trials.length*TICKET;
 $('fx-cash').textContent=fmt(cash);$('fx-value').textContent=fmt(cash+held);$('fx-pl').textContent=`${fmt(cash+held-BUDGET)} face ao orçamento de 1.000 € · resultados meramente ilustrativos`;
}
async function load(){
 try{
  const resp=await fetch('data/market.json?v='+Date.now(),{cache:'no-store'});if(!resp.ok)throw new Error('HTTP');
  const obj=await resp.json();let found={};
  for(const [k,c] of Object.entries(P)){
   const e=obj.forex?.[k];if(e?.ticker!==c.ticker||e.base!=='EUR')continue;
   found[k]={prices:rows(e.prices)};
  }
  rates=found;
 }catch{rates={};}
 render();
}
function create(){
 const id=$('fx-pair').value,series=rates[id]?.prices||[],quote=series.at(-1);
 if(!P[id]||series.length<50||!fresh(quote?.date)||trials.length>=4||trials.some(t=>t.id===id&&t.signalDate===quote.date)){render();return;}
 if(!confirm(`Reservar 250 € APENAS VIRTUAIS para comprar ${P[id].currency} com euros ao primeiro fecho futuro? Esta experiência não é sinal do algoritmo nem ordem real.`))return;
 const item={id,amount:TICKET,signalDate:quote.date,signalRate:quote.close,recordedAt:new Date().toISOString(),ref:`fx_${Date.now()}_${trials.length}`};
 trials.push(item);save();render();
}
function backup(){
 const blob=new Blob([JSON.stringify({schema:'radar-forex-v1',exportedAt:new Date().toISOString(),trials},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='radar-forex-experiencias-privado.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
async function restore(ev){
 const file=ev.target.files?.[0];ev.target.value='';if(!file)return;
 if(file.size>50000){say('Ficheiro demasiado grande');return;}
 try{
  const obj=JSON.parse(await file.text());if(obj.schema!=='radar-forex-v1'||!Array.isArray(obj.trials))throw Error('invalid');
  const input=verify(obj.trials);if(input.length!==obj.trials.length)throw Error('invalid');
  if(!confirm('Substituir o histórico Forex deste navegador pelo ficheiro importado?'))return;
  trials=input;save();render();
 }catch{say('Histórico Forex inválido. Não foram alterados os dados existentes.');}
}
function wire(){
 $('fx-pair').addEventListener('change',render);
 $('fx-order').addEventListener('click',create);
 $('fx-export').addEventListener('click',backup);
 $('fx-import').addEventListener('click',()=>$('fx-file').click());
 $('fx-file').addEventListener('change',restore);
 $('refresh')?.addEventListener('click',load);
 load();
}
wire();
})();
