'use strict';
/* Forex Autopilot v4.2. Read-only view of a scheduled GitHub Actions paper account.
   No broker connection, no real trading, no secrets, no user financial data. */
(() => {
  const $ = x => document.getElementById(x);
  const fmt = v => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(v);
  const pct = v => new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v) + '%';
  const pairs = {eurusd:'EUR/USD',eurgbp:'EUR/GBP',eurjpy:'EUR/JPY'};
  const put = (el, tag, cls, value) => {
    const child=document.createElement(tag);if(cls)child.className=cls;
    child.textContent=String(value);el.appendChild(child);return child;
  };
  async function update() {
    $('auto-status').textContent='A verificar o diário automático...';
    let state, feed;
    try {
      const [r,m] = await Promise.all([
        fetch('data/forex_autopilot.json?t='+Date.now(),{cache:'no-store'}),
        fetch('data/market.json?t='+Date.now(),{cache:'no-store'})
      ]);
      if(!r.ok||!m.ok)throw new Error('Os dados ainda não foram publicados');
      state=await r.json();feed=await m.json();
      if(state.schema!==1||state.engine!=='forex-autopilot-4.2'||
         !Array.isArray(state.events)||!Array.isArray(state.closed)||
         !Number.isFinite(state.cash))throw new Error('Diário incompatível');
    }catch(e){
      $('auto-status').textContent=`Autopilot não inicializado ou indisponível: ${e.message}. Verifica o próximo workflow verde.`;
      return;
    }
    const latest=state.market_date||'—';
    const latestMs=Date.parse(latest+'T23:59:59Z');
    const age=(Date.now()-latestMs)/86400000;
    const fresh=age>=-1&&age<=4;
    $('auto-status').textContent=(fresh?'Diário publicado':'Diário antigo / sem atualização recente')+
      ` · último fecho comum: ${latest} · simulação EOD · sem ordens reais`;
    $('auto-status').className='market-banner '+(fresh?'success':'warn');
    $('auto-cash').textContent=fmt(state.cash);
    $('auto-trades').textContent=String(state.trade_count)+' / 4';
    const position=state.position;
    let mtm=0;
    if(position){
      const prices=feed.forex?.[position.pair]?.prices;
      const arr=Array.isArray(prices)?prices.filter(x=>x?.date<=latest &&
        /^\d{4}-\d{2}-\d{2}$/.test(x?.date)&&Number.isFinite(x?.close)&&x.close>0):[];
      const fx=arr.at(-1)?.close;
      if(fx)mtm=position.foreign_units/fx*.9985;
    }
    const est=state.cash+(position?mtm:0);
    $('auto-value').textContent=position&&!mtm?'— (sem cotação)':fmt(est);
    $('auto-pl').textContent=position&&!mtm?'Valor não calculável':
      (est>=1000?'+':'')+fmt(est-1000)+' face a 1.000 €; inclui custos hipotéticos';
    const p=$('auto-position');p.replaceChildren();
    if(position){
      const card=put(p,'article','auto-entry','');
      put(card,'strong','',pairs[position.pair]+' · compra virtual executada');
      put(card,'p','muted',`250 € · fecho de entrada ${position.buy_date} · taxa ${position.entry_rate}`);
      put(card,'p','muted',`Valor atual de liquidação hipotética: ${mtm?fmt(mtm):'indisponível'} · ${position.bars_held} sessões acompanhadas`);
    }else{put(p,'p','muted','Sem moeda virtual em carteira. Isto pode significar ausência de sinal ou posição já encerrada.');}
    const pending=$('auto-pending');pending.replaceChildren();
    if(state.pending){
      const o=state.pending;
      put(pending,'p','muted',`${o.side==='buy'?'Compra':'Venda'} virtual ${pairs[o.pair]||o.pair} sinalizada em ${o.signal_date}. Apenas poderá executar no próximo fecho elegível.`);
    }else{put(pending,'p','muted','Nenhuma operação pendente.');}
    const history=$('auto-log');history.replaceChildren();
    const records=state.events.slice(-16).reverse();
    if(records.length===0)put(history,'p','muted','Sem decisões ainda.');
    for(const ev of records){
      const item=put(history,'div','auto-log-item','');
      put(item,'small','',ev.date+' · '+ev.event);
      put(item,'p','',ev.details);
    }
    const exits=$('auto-closed');exits.replaceChildren();
    if(!state.closed.length)put(exits,'p','muted','Ainda não existem operações completas.');
    for(const tr of state.closed.slice().reverse()){
      const item=put(exits,'div','auto-log-item','');
      put(item,'small','',`${pairs[tr.pair]} · ${tr.buy_date} → ${tr.sell_date}`);
      put(item,'p',tr.pnl_eur>=0?'result-plus':'result-minus',
        `${tr.pnl_eur>=0?'+':''}${fmt(tr.pnl_eur)} (${pct(100*tr.pnl_eur/250)}) · ${tr.exit_reason}`);
    }
  }
  $('auto-reload')?.addEventListener('click',update);
  update();
})();
