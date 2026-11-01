'use strict';
const E=window.RadarEngine;
const euro=n=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const percent=n=>`${new Intl.NumberFormat('pt-PT',{maximumFractionDigits:1}).format(n)}%`;
const el=id=>document.getElementById(id);
const safeLoad=(key,fall)=>{try{const val=JSON.parse(localStorage.getItem(key));return val??fall;}catch{return fall;}};
const funds=E.FUNDS;
const FEE=.002;
let portfolio=safeLoad('radar-portfolio-v1',E.clone(E.DEFAULT_PORTFOLIO));
let trials=loadTrials();
let market={},marketContext={},feedTime=null;let quoteFresh=false;
const TRIAL_STORE='radar-paper-trials-v3'; // preserva as experiências existentes
const MAX_ENTRY=250;
const assetIds=['nasdaq','sp500','world'];
function validTrials(value){
 if(!Array.isArray(value)||value.length>4)return null;
 const used=new Set(),out=[];
 for(const t of value){
  if(!t||!Object.prototype.hasOwnProperty.call(funds,t.id)||t.amount!==250||
   typeof t.signalDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(t.signalDate)||
   typeof t.signalPrice!=='number'||!(t.signalPrice>0)||
   typeof t.ref!=='string'||!/^[-_a-zA-Z0-9]{1,80}$/.test(t.ref)||used.has(t.ref))return null;
  if(t.fillDate!==undefined&&t.fillDate!==null){
   if(typeof t.fillDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(t.fillDate)||t.fillDate<=t.signalDate||
     !Number.isFinite(t.fillPrice)||t.fillPrice<=0||!Number.isFinite(t.units)||t.units<=0)return null;
  }
  used.add(t.ref);
  out.push({ref:t.ref,id:t.id,amount:250,signalDate:t.signalDate,signalPrice:t.signalPrice,
    recordedAt:typeof t.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(t.recordedAt)?t.recordedAt:'',
    mode:['signal','manual','swing'].includes(t.mode)?t.mode:'signal',
    signalText:typeof t.signalText==='string'?t.signalText.slice(0,180):'',
    vix:typeof t.vix==='number'&&t.vix>0?t.vix:null,
    fillDate:t.fillDate||null,fillPrice:t.fillPrice||null,units:t.units||null,
    entryFee:t.fillDate?0.5:null,feeRate:FEE});
 }
 return out;
}
function loadTrials(){
 try{return validTrials(JSON.parse(localStorage.getItem('radar-paper-trials-v3')))??[];}catch{return [];}
}
function persistTrials(){localStorage.setItem(TRIAL_STORE,JSON.stringify(trials));}
function renderPortfolio(){
  const amounts=E.totalByFund(portfolio),total=Object.values(amounts).reduce((a,b)=>a+b,0);
  el('total-value').textContent=euro(total);
  el('valuation-date').textContent=portfolio.date?`Valores de ${String(portfolio.date).split('-').reverse().join('/')}`:'Sem valores importados';
  el('us-weight').textContent=total?percent((amounts.nasdaq+amounts.sp500)/total*100):'—';
  el('allocation-bar').innerHTML='';el('allocation-legend').innerHTML='';el('holdings').innerHTML='';
  assetIds.forEach(id=>{
    const f=funds[id],share=total?amounts[id]/total*100:0;
    const bar=document.createElement('div');bar.style.cssText=`width:${share}%;background:${f.color}`;el('allocation-bar').appendChild(bar);
    const legend=document.createElement('div');legend.innerHTML=`<i class="legend-color" style="background:${f.color}"></i>${f.short} · ${percent(share)}`;el('allocation-legend').appendChild(legend);
    const card=document.createElement('article');card.className='holding';
    const broker=id==='world'?`DEGIRO ${euro(portfolio.deg.world)}`:`DEGIRO ${euro(portfolio.deg[id])} · TR ${euro(portfolio.tr[id])}`;
    card.innerHTML=`<div class="holding-logo" style="background:${f.color}">${id==='nasdaq'?'N100':id==='sp500'?'S500':'WORLD'}</div><div><div class="holding-title">${f.name}</div><div class="holding-detail">${broker}</div><div class="holding-detail">${f.ticker} · ${f.isin}</div></div><div class="holding-amount">${euro(amounts[id])}<div class="holding-pct">${percent(share)} da carteira</div></div>`;
    el('holdings').append(card);
  });
  renderBacktest();
}
function marketDate(){return assetIds.map(id=>E.normalize(market[id]?.prices||[]).at(-1)?.date).filter(Boolean).sort().at(0)||null;}
const checkFresh=date=>E.isFresh(date);
function currentSignals(){
 const common=marketDate();
 return Object.fromEntries(assetIds.map(id=>{
   const rows=E.normalize(market[id]?.prices||[]);
   const raw=E.signalAt(rows,rows.length-1);
   return [id,{...raw,fresh:E.isFresh(rows.at(-1)?.date)&&rows.length>=201&&E.isFresh(common),rows}];
 }));
}
function renderMacro(){
 const wrap=el('macro-grid');if(!wrap)return;
 wrap.innerHTML='';const sum=E.contextSummary(marketContext);
 let good=0;
 for(const [id,meta] of Object.entries(E.CONTEXT)){
   const info=sum[id],valid=Boolean(info?.fresh);
   if(valid)good++;
   const symbol=id==='vix'?info?.close.toFixed(1):id==='us10y'?info?.close.toFixed(2)+'%':id==='eurusd'?info?.close.toFixed(4):id==='oil'||id==='gold'?info?.close.toFixed(2):info?.close.toLocaleString('pt-PT',{maximumFractionDigits:1});
   const d=document.createElement('article');d.className='macro-card';
   const movement=valid&&info.day!==null?percent(info.day):'—';
   const trend=info?.above200===true?'↑ MM200':info?.above200===false?'↓ MM200':'Sem MM200';
   d.innerHTML=`<small>${meta.name}</small><strong>${valid?symbol:'Indisponível'}</strong><span>${valid?movement+' sessão · '+info.date:'Sem dados recentes'}</span><span class="muted">${valid?trend:''}</span>`;
   wrap.appendChild(d);
 }
 el('macro-status').textContent=`${good}/${Object.keys(E.CONTEXT).length} indicadores recentes · Dados EOD, fechados em fusos horários distintos. VIX, Nasdaq e S&P 500 são exigidos para desbloquear uma entrada virtual. Uma correlação não constitui previsão.`;
}
function investmentGuard(id,s,amount=MAX_ENTRY){
 const macro=E.contextSummary(marketContext),guard=E.guardCandidate(s,macro);
 if(!guard.ok)return guard;
 const amounts=E.totalByFund(portfolio),total=Object.values(amounts).reduce((a,b)=>a+b,0);
 if(!(total>0))return {ok:false,level:'blocked',reason:'Importa a carteira para validar os limites de concentração.'};
 if((amounts[id]+amount)/(total+amount)>.45){return {ok:false,level:'wait',reason:`Uma entrada de ${euro(amount)} levaria ${funds[id].short} acima do limite experimental de 45% da carteira.`};}
 return guard;
}
function renderSignals(){
  const sig=currentSignals(),d=marketDate();
  quoteFresh=assetIds.every(id=>sig[id].fresh);
  const good=Object.values(sig).filter(s=>s.fresh).length;
  const banner=el('market-status'),pill=el('data-pill');
  if(good===3){banner.className='market-banner success';banner.textContent=`3/3 ETFs com histórico suficiente · último fecho comum ${d} · fonte não oficial Yahoo/yfinance · não é tempo real`;pill.innerHTML='<span class="dot"></span>Dados EOD recentes';}
  else {banner.className='market-banner warn';banner.textContent=`${good}/3 ETFs com dados recentes. ${d?'Último fecho identificado: '+d+'. ':''}Sem dados completos, as entradas ficam bloqueadas.`;pill.innerHTML='<span class="dot dim"></span>Dados insuficientes';}
  const wrap=el('signals');wrap.innerHTML='';
  for(const id of assetIds){
    const s=sig[id],f=funds[id],valid=s.fresh;
    const state=valid?s.state:'none';
    const guard=investmentGuard(id,s);
    const stateText={green:s.candidate?'Em observação':'Tendência favorável',yellow:'Atenção',red:'Risco elevado',none:'Indisponível'}[state];
    const message=!valid?'Histórico insuficiente ou desatualizado. Nenhum sinal de compra ou venda.':guard.ok?'Candidato à simulação de 250 €; não há garantia de retorno.':s.state==='red'?'Risco elevado: não significa venda automática.':guard.reason;
    const card=document.createElement('article');card.className='signal-card';
    card.innerHTML=`<div class="signal-header"><span class="signal-symbol">${f.ticker} · EUR</span><span class="signal-tag ${state==='none'?'':state}">${stateText}</span></div><h3>${f.short}</h3><div class="signal-price">${valid?euro(s.price):'—'}</div><div class="signal-detail">${valid?`Fecho ${s.date} · dia ${percent(s.day)} · 5 sessões ${percent(s.five)} · recuo 60 sessões ${percent(s.drawdown)}`:'Sem cotação recente validada'}</div><div class="signal-why"><b>${valid?s.reason:'Nenhuma recomendação calculada.'}</b><br>${message}</div>`;
    wrap.appendChild(card);
  }
  renderMacro();
  const selected=el('etf-select').value,chosen=sig[selected],mode=el('trade-mode').value,g=investmentGuard(selected,chosen);
  const duplicate=trials.some(t=>t.id===selected&&t.signalDate===chosen.date);
  const ready=chosen.fresh&&quoteFresh;
  const eligible=(mode==='signal'?g.ok:ready)&&trials.length<4&&!duplicate;
  el('paper-buy').disabled=!eligible;
  el('paper-buy').textContent=mode==='signal'?'Aceitar sinal · simular 250 €':mode==='swing'?'Testar swing · 250 € fictícios':'Comprar livre · 250 € fictícios';
  el('paper-hint').textContent=trials.length>=4?'As quatro experiências já estão registadas.':duplicate?'Já existe uma experiência para este ETF e fecho.':!ready?'São necessários preços dos três ETFs recentes.':mode==='signal'?g.reason:mode==='manual'?'Compra manual sem confirmação do algoritmo. Não conta para a taxa de acerto dos sinais.':'Operação swing livre: só no simulador, sem execução automática de stops.';
  renderPaper();
  renderSwing();
}
function latestQuote(id){return E.normalize(market[id]?.prices||[]).at(-1)||null;}
function valuationBadge(out){
 if(out.status==='awaiting_entry')return '<span class="result-wait">A aguardar execução</span>';
 if(out.status!=='complete')return '<span class="result-wait">A aguardar fecho</span>';
 const positive=out.pnl>=0;
 return `<strong class="${positive?'result-plus':'result-minus'}">${positive?'+':''}${euro(out.pnl)} (${positive?'+':''}${percent(out.returnPct)})</strong><small>fecho ${out.observedDate}</small>`;
}
function renderPaper(){
  const old=JSON.stringify(trials);
  const state=E.paperSummary(trials,market,FEE);
  trials=state.items.map(x=>x.trial);
  if(JSON.stringify(trials)!==old)persistTrials();
  const batches=[['signal','Sinais automáticos'],['manual','Compras livres'],['swing','Swing virtual']].map(([mode,title])=>{
    const done=state.items.filter(x=>x.trial.mode===mode&&x.week.status==='complete');
    const profit=done.reduce((n,x)=>n+x.week.pnl,0);
    const wins=done.filter(x=>x.week.pnl>0).length;
    return {mode,title,n:done.length,wins,profit};
  });
  el('paper-cash').textContent=euro(state.available);
  el('paper-value').textContent=state.value===null?'—':euro(state.value);
  el('paper-pl').textContent=state.value===null?'Sem histórico para avaliar todas as posições':`${state.value-1000>=0?'+':''}${euro(state.value-1000)} face a 1.000 € · custos hipotéticos de entrada e saída`;
  el('tranches-remaining').textContent=`${4-trials.length} de 4 experiências disponíveis · ${state.items.filter(x=>!x.trial.fillDate).length} ordem(ns) fictícia(s) a aguardar próximo fecho`;
  const weekly=el('week-summary');
  weekly.innerHTML=`<div class="week-banner"><b>Balanço após 7 dias · por modalidade</b><div class="score-grid">${batches.map(x=>`<div><small>${x.title}</small><strong>${x.n} avaliadas</strong><span class="${x.profit>=0?'result-plus':'result-minus'}">${x.n?`${x.wins}/${x.n} positivas · ${x.profit>=0?'+':''}${euro(x.profit)}`:'Sem resultados'}</span></div>`).join('')}</div><span>Resultados apenas após cada prazo. Não contamos compras livres como vitórias do algoritmo. Uma amostra pequena não prova rentabilidade.</span></div>`;
  const holdings=el('positions');holdings.innerHTML='';
  if(!state.items.length)holdings.innerHTML='<div class="empty-state">Ainda não há experiências. Podes testar um sinal automático ou registar uma compra livre de 250 € com dados válidos.</div>';
  state.items.slice().reverse().forEach(({trial,quote,current,nextSession,week,month,quarter})=>{
    const box=document.createElement('article');box.className='trial-card';
    const status=trial.fillDate?`Executada virtualmente em ${trial.fillDate} · referência ${euro(trial.fillPrice)}`:'Pendente · executa ao primeiro fecho posterior ao registo';
    const currentText=trial.fillDate?(current!==null?`Valor estimado ${euro(current)} · fecho ${quote?.date}`:'Sem cotação para estimativa'):'250 € reservados, ainda não investidos';
    box.innerHTML=`<div class="trial-head"><div><div class="trial-title">${funds[trial.id].short} <span class="trial-chip">${trial.mode==='manual'?'LIVRE':trial.mode==='swing'?'SWING':'SINAL'} · 250 € VIRTUAIS</span></div><small>Referência ${trial.signalDate} · ${status}</small></div><div class="trial-current">${currentText}</div></div><div class="horizon-grid"><div><span>Após 1 sessão</span>${valuationBadge(nextSession)}</div><div><span>Após 7 dias</span>${valuationBadge(week)}</div><div><span>Após 30 dias</span>${valuationBadge(month)}</div><div><span>Após 90 dias</span>${valuationBadge(quarter)}</div></div><div class="trial-note">Resultados hipotéticos se vendesses no primeiro fecho elegível de cada prazo, descontando 0,20% na compra e 0,20% na venda. Não são ordens executadas.</div>`;
    holdings.append(box);
  });
  const ledger=el('ledger');ledger.innerHTML='';
  if(!state.items.length)ledger.innerHTML='<div class="empty-state">Sem experiências registadas.</div>';
  state.items.slice().reverse().forEach(({trial})=>{
    const row=document.createElement('div');row.className='ledger-row';
    const recorded=trial.recordedAt?trial.recordedAt.slice(0,16).replace('T',' '):'data não registada';
    row.innerHTML=`<span>${trial.mode==='manual'?'[LIVRE] ':trial.mode==='swing'?'[SWING] ':'[SINAL] '}${funds[trial.id].short}<br><small>Registo ${recorded} UTC · sinal ${trial.signalDate} · VIX ${trial.vix===null?'—':trial.vix.toFixed(1)}</small></span><b>250 € fictícios</b>`;
    ledger.append(row);
  });
}
function buyPosition(){
  const id=el('etf-select').value,s=currentSignals()[id],g=investmentGuard(id,s),mode=el('trade-mode').value;
  if(!quoteFresh||!s.fresh||(mode==='signal'&&!g.ok)){notify('Entrada não validada: '+(!s.fresh?'Cotação desatualizada':g.reason));return;}
  if(trials.length>=4){notify('Limite de quatro experiências virtuais atingido.');return;}
  if(trials.some(t=>t.id===id&&t.signalDate===s.date)){notify('Este sinal já está registado para o ETF.');return;}
  if(!confirm(`Registar ${mode==='signal'?'um sinal automático':mode==='swing'?'um swing livre':'uma compra manual'} de 250 € VIRTUAIS em ${funds[id].short}? Só será executada no próximo fecho posterior ao registo. Sem compra real.`))return;
  const macro=E.contextSummary(marketContext);
  const ref=(globalThis.crypto?.randomUUID?.()||('t'+Date.now()+Math.random().toString(36).slice(2))).replaceAll('.','');
  trials.push({ref,id,amount:250,mode,signalDate:s.date,signalPrice:s.price,signalText:s.reason,
    recordedAt:new Date().toISOString(),vix:macro.vix?.close??null,fillDate:null,fillPrice:null,units:null,entryFee:null,feeRate:FEE});
  persistTrials();renderSignals();notify(`Experiência de ${funds[id].short} registada para simulação. Os 250 € estão reservados. A entrada só será modelada num fecho posterior à data de registo.`);
}
function downloadTrials(){
 const data={schema:'radar-etf-trials-v4',exportedAt:new Date().toISOString(),trials};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='radar-etfs-simulacoes-privado.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
 notify('Cópia de segurança gerada. Guarda-a nos Ficheiros do iPhone, não num repositório público.');
}
async function importTrials(event){
 const file=event.target.files?.[0];event.target.value='';if(!file)return;
 if(file.size>100000){notify('O ficheiro é demasiado grande.');return;}
 try{
   const data=JSON.parse(await file.text());
   if(!['radar-etf-trials-v3','radar-etf-trials-v4'].includes(data.schema))throw Error('Versão incompatível');
   const records=validTrials(data.trials);if(records===null)throw Error('Formato inválido');
   if(!confirm(`Substituir as ${trials.length} experiências atuais pelas ${records.length} do ficheiro privado?`))return;
   trials=records;persistTrials();renderSignals();notify('Histórico virtual importado neste dispositivo.');
 }catch{notify('Histórico inválido. Escolhe a exportação v3 ou v4.');}
}
function notify(message){el('notice').innerHTML='';const box=document.createElement('div');box.className='message';box.textContent=message;el('notice').append(box);}
function linePath(values,min,max){const w=760,h=250;return values.map((v,i)=>`${i?'L':'M'}${(i/Math.max(1,values.length-1)*w).toFixed(1)},${(h-(v-min)/(max-min||1)*h).toFixed(1)}`).join(' ');}
function renderBacktest(){
  const box=el('backtest'),weights=E.totalByFund(portfolio),r=E.runBacktest(market,weights);
  if(!r.ok){box.innerHTML=`<div class="empty-state">${r.why}</div>`;return;}
  const values=r.holdSeries.concat(r.adaptSeries),min=Math.min(...values)*.97,max=Math.max(...values)*1.03;
  const card=(name,s,c)=>`<div class="test-card"><span>${name}</span><h3 style="color:${c}">${euro(s.end)}</h3><small>Retorno ${percent(s.returnPct)} · perda máx. ${percent(s.drawdown)} · volatilidade anual. ${percent(s.volatility)}</small></div>`;
  const smallCard=(name,r)=>`<div class="test-card"><span>${name}</span><h3>Manter ${percent(r.hold.returnPct)} · filtro ${percent(r.adapt.returnPct)}</h3><small>Drawdown manter ${percent(r.hold.drawdown)} · filtro ${percent(r.adapt.drawdown)} · ${r.from} a ${r.to}</small></div>`;
  box.innerHTML=`<div class="test-cards">${card('Manter os ETFs',r.hold,'#64a9fa')}${card('Filtro defensivo',r.adapt,'#61e2c4')}</div>
    <div class="test-chart"><svg viewBox="0 0 760 270" role="img" aria-label="Retorno hipotético: manter vs filtro defensivo"><g transform="translate(0 10)"><path d="${linePath(r.holdSeries,min,max)}" stroke="#64a9fa" stroke-width="3" fill="none" vector-effect="non-scaling-stroke"/><path d="${linePath(r.adaptSeries,min,max)}" stroke="#61e2c4" stroke-width="3" fill="none" vector-effect="non-scaling-stroke"/></g></svg><div class="chart-legend"><span><i class="legend-color" style="background:#64a9fa"></i>Manter</span><span><i class="legend-color" style="background:#61e2c4"></i>Filtro</span></div></div>
    <div class="test-cards">${r.training&&r.holdout?smallCard('Primeiros 75% · exploração',r.training)+smallCard('Últimos 25% · validação separada',r.holdout):'<div class="empty-state">Histórico insuficiente para separar 75% / 25%: exigimos pelo menos 504 sessões comparáveis.</div>'}</div>
    <p class="muted">Histórico comum ${r.from} a ${r.to} (${r.sessions} sessões). ${r.rebalances} ajustes do filtro · custos estimados com taxa 0,20%: ${euro(r.feeCost.adapt)}. Com custo de 0,50% por transação: retorno do filtro ${percent(r.highFee.adapt.returnPct)} (vs ${percent(r.adapt.returnPct)} no cenário base). Valores hipotéticos: sem impostos e sem rendimento da caixa.</p>
    <div class="scenario-list"><b>Janelas de tensão histórica disponíveis</b>${r.stressCases.length?r.stressCases.map(c=>`<div><span>${c.title}</span><span>Manter ${percent(c.hold.returnPct)} · filtro ${percent(c.adapt.returnPct)}</span></div>`).join(''):'<p class="muted">Ainda não há histórico dos ETFs suficiente para mostrar crises completas. Não substituímos por dados inventados.</p>'}</div>
    <div class="info-panel"><b>Critério de aceitação:</b> esta estratégia só merece dinheiro real após testes com dados fidedignos, vários regimes, custos, análise das falsas entradas e acompanhamento virtual. Um backtest favorável não é uma promessa de resultados futuros.</div>`;
}
function portfolioEditor(){
  for(const broker of ['tr','deg'])for(const id of assetIds){const target=el(`p-${broker}-${id}`);if(target)target.value=portfolio[broker]?.[id]??0;}
  el('p-date').value=portfolio.date||new Date().toISOString().slice(0,10);el('portfolio-dialog').showModal();
}
async function importPortfolio(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(file.size>20000){notify('O ficheiro é demasiado grande.');return;}
  try{
    const data=JSON.parse(await file.text());
    if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date))throw new Error('Data inválida');
    const obj=E.clone(E.DEFAULT_PORTFOLIO);obj.date=data.date;
    for(const broker of ['tr','deg'])for(const id of assetIds){
      if(broker==='tr'&&id==='world')continue;
      const value=data[broker]?.[id];
      if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Montante inválido');
      obj[broker][id]=value;
    }
    portfolio=obj;localStorage.setItem('radar-portfolio-v1',JSON.stringify(portfolio));renderPortfolio();renderSignals();notify('Carteira privada importada apenas para este dispositivo.');
  }catch(err){notify('Ficheiro privado inválido. Usa o JSON fornecido ou edita os montantes manualmente.');}
}
function savePortfolio(ev){ev.preventDefault();
  const next=E.clone(portfolio);for(const broker of ['tr','deg'])for(const id of assetIds){const target=el(`p-${broker}-${id}`);if(target){const v=Number(target.value);if(!Number.isFinite(v)||v<0){notify('Os valores devem ser números positivos.');return;}next[broker][id]=Math.round(v*100)/100;}}
  next.date=el('p-date').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(next.date)){notify('Data inválida.');return;}
  portfolio=next;localStorage.setItem('radar-portfolio-v1',JSON.stringify(next));el('portfolio-dialog').close();renderPortfolio();renderSignals();
}
async function fetchMarket(){
  try{
    const response=await fetch(`data/market.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const feed=await response.json();
    // Só permite uso após confirmação explícita do identificador e da moeda.
    market={};marketContext={};feedTime=feed.as_of||null;
    for(const id of assetIds){
      const f=feed.funds?.[id];
      if(f?.ticker!==funds[id].ticker||f?.isin!==funds[id].isin||f?.currency!=='EUR')continue;
      market[id]={prices:E.normalize(f.prices)};
    }
    for(const [id,c] of Object.entries(E.CONTEXT)){
      const item=feed.context?.[id];
      if(item?.ticker===c.ticker)marketContext[id]={ticker:item.ticker,prices:E.normalize(item.prices)};
    }
  }catch(err){market={};marketContext={};notify('Não foi possível obter as cotações. A carteira continua disponível sem sinais.');}
  renderSignals();renderBacktest();renderEntryStudy();
}

function renderSwing(){
 const box=el('swing-cards');if(!box)return;
 box.innerHTML='';
 for(const id of assetIds){
  const s=E.swingSnapshot(market[id]?.prices||[],marketContext),card=document.createElement('article');card.className='macro-card swing-card';
  const title=document.createElement('small');title.textContent=funds[id].short+' · '+funds[id].ticker;card.append(title);
  const badge=document.createElement('strong');badge.textContent=!s.ready?'Sem dados':s.watch?'Em observação':'Aguardar';card.append(badge);
  const detail=document.createElement('span');detail.textContent=s.ready?`Fecho ${s.date} · ${euro(s.price)} · dia ${percent(s.day)} · vol. anual. ${percent(s.vol)}`:'Histórico indisponível';card.append(detail);
  const reason=document.createElement('p');reason.className='muted';reason.textContent=s.reason;card.append(reason);
  const btn=document.createElement('button');btn.className='btn secondary';btn.textContent='Experimentar swing virtual ↗';btn.disabled=!s.ready||trials.length>=4||!quoteFresh;
  btn.addEventListener('click',()=>{el('etf-select').value=id;el('trade-mode').value='swing';renderSignals();document.getElementById('plano').scrollIntoView({behavior:'smooth'});});card.append(btn);
  box.append(card);
 }
}
function renderEntryStudy(){
 const elbox=el('entry-study');if(!elbox)return;
 const r=E.entryStudy(market,FEE);
 if(!r.ok){elbox.innerHTML='<div class="empty-state">Histórico insuficiente para analisar entradas técnicas. Não apresentamos resultados inventados.</div>';return;}
 elbox.innerHTML='';
 for(const id of assetIds){
  const x=r.funds[id],wrap=document.createElement('div');wrap.className='study-card';
  if(!x?.ok){wrap.textContent=funds[id].short+' — sem histórico suficiente';elbox.append(wrap);continue;}
  const title=document.createElement('h3');title.textContent=funds[id].short+' · '+x.count+' sinais históricos';wrap.append(title);
  const subtitle=document.createElement('p');subtitle.className='muted';subtitle.textContent='Amostra '+x.from+' a '+x.to+' · custos de entrada e saída simulados · resultados em %';wrap.append(subtitle);
  const table=document.createElement('table');table.className='study-table';
  const tr=document.createElement('tr');['Prazo','Sinais técnicos','Compra mensal','Sinais últimos 25%'].forEach(t=>{const th=document.createElement('th');th.textContent=t;tr.append(th);});table.append(tr);
  for(const h of [7,30,90]){
   const r=document.createElement('tr');const vals=[`${h} dias`,x.candidates[h],x.monthly[h],x.holdout[h]];
   for(const item of vals){const td=document.createElement('td');td.textContent=typeof item==='string'?item:item.n?`${percent(item.avg)} média · ${item.wins}/${item.n} positivos`:'Sem observações';r.append(td);}table.append(r);
  }
  wrap.append(table);elbox.append(wrap);
 }
 const note=document.createElement('p');note.className='muted';note.textContent='Comparação exploratória, não emparelhada e não causal. As amostras têm datas e tamanhos diferentes. O estudo usa apenas o candidato técnico; não reproduz as restrições macro e de concentração, nem evita a posterior seleção de parâmetros.';elbox.append(note);
}

function wire(){
  el('edit-portfolio').addEventListener('click',portfolioEditor);
  el('import-portfolio').addEventListener('click',()=>el('portfolio-file').click());
  el('portfolio-file').addEventListener('change',importPortfolio);
  el('close-dialog').addEventListener('click',()=>el('portfolio-dialog').close());
  el('portfolio-form').addEventListener('submit',savePortfolio);
  el('refresh').addEventListener('click',fetchMarket);
  el('etf-select').addEventListener('change',renderSignals);
  el('trade-mode').addEventListener('change',renderSignals);
  el('paper-buy').addEventListener('click',buyPosition);
  el('export-paper').addEventListener('click',downloadTrials);
  el('import-paper').addEventListener('click',()=>el('paper-file').click());
  el('paper-file').addEventListener('change',importTrials);
  el('clear-paper').addEventListener('click',()=>{if(confirm('APAGAR as quatro experiências e todo o histórico de resultados? Exporta uma cópia antes, se quiseres guardá-los.')){trials=[];persistTrials();renderSignals();notify('Experiências virtuais eliminadas deste dispositivo.');}});
  if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
  renderPortfolio();renderPaper();fetchMarket();
}
wire();
