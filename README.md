# Radar ETFs v3 — diário de simulações de 250 €

**Novidade:** quando surgir um sinal validado, usa **Aceitar sinal · simular 250 €**. Não são realizadas compras reais.

## Como funciona a experiência de uma semana

1. Os dados dos ETFs e os indicadores de contexto precisam de estar recentes. A aplicação pode bloquear entradas por riscos, falta de dados ou concentração.
2. A app regista a data do sinal. A entrada virtual **não** é executada ao fecho do próprio sinal, porque esse preço já seria conhecido; é preenchida ao **primeiro fecho publicado posterior à data de registo do sinal**, com 0,20% de custo de compra hipotético.
3. A avaliação de **1 sessão, 7 dias e 30 dias** utiliza o primeiro fecho publicado elegível depois do prazo, simulando também 0,20% de custo de venda. São contados **dias de calendário** nos prazos de 7 e 30 dias; fins de semana e feriados podem deslocar a observação.
4. Aparecem ganhos **e perdas** e uma síntese dos resultados completos a 7 dias. Prazos que ainda não chegaram mostram "A aguardar fecho".
5. A experiência tem quatro entradas de 250 € e **não permite editar o passado** ou repetir o mesmo sinal. Pode ser reiniciada manualmente, mas isso apaga as observações locais. Exporta um backup antes.

As simulações são determinísticas e reproduzíveis com os mesmos dados publicados, mas o fecho do dia seguinte não é garantia de preço executável. Não incluem impostos reais, spreads variáveis, dividendos não capturados pela fonte ou impacto de mercado. Nunca há ordem enviada a corretoras.

**Privacidade e persistência:** as experiências ficam no armazenamento local do navegador, separadas dos ficheiros públicos do projeto. Usa **Exportar histórico** para guardar um `radar-etfs-simulacoes-privado.json` nos Ficheiros do iPhone e **Importar histórico** para o restaurar. Não publiques o JSON de simulações nem o JSON privado de carteira no GitHub.

**Limitações:** uma semana e quatro experiências não bastam para inferir taxa de sucesso nem robustez estatística. A app só atualiza resultados quando consegue ler cotações fiáveis publicadas; não envia notificações automáticas dos resultados semanais, nem funciona sem dados de mercado atualizados.

---

# Radar ETFs — v2.0 (iPhone / PWA)

Aplicação pessoal de investigação e gestão de risco para três ETFs UCITS. **Não promete ganhos**; não executa ordens. As entradas de 250 € só existem em simulação. O valor máximo de 1.000 € é experimental, separado da carteira real.

## O que mudou da v1

- **Quatro entradas virtuais fixas de 250 €**, sem reutilizar uma entrada após venda. Desconto de **0,20%** como custo *ilustrativo* de cada compra/venda.
- **Nove indicadores de contexto**: Nasdaq-100, S&P 500, VIX, STOXX Europe 600, Nikkei 225, taxa a 10 anos EUA, EUR/USD, petróleo WTI e ouro. Fontes indisponíveis aparecem como tal; não se inventam valores.
- **Travões de entrada**: dados dos três ETFs recentes; VIX, Nasdaq-100 e S&P 500 recentes; VIX abaixo de 30; índices EUA acima das respetivas MM200; ausência de choque diário importante; ETF em regime verde após queda de 3% a 8% desde máximo de 60 sessões e dois fechos de recuperação; a nova compra não deve elevar nenhum ETF acima de **45%** do valor agregado de referência. Estes limiares são **hipóteses de teste, não regras comprovadas de lucro**.
- Histórico de preços ajustados dos três ETFs **até dez anos ou desde a existência da classe**, nunca séries fictícias.
- Comparação de manter investido vs regime defensivo, com volatilidade, drawdown, custos de 0,20%, cenário de custos de 0,50%, períodos históricos de tensão que existam no ficheiro e divisão temporal **primeiros 75% / últimos 25%** (mínimo 504 sessões comparáveis). A divisão temporal não significa validação prospectiva independente: as regras já foram concebidas antes deste teste.

## ETFs exatos — importância do ISIN

| Fundo | ISIN | Cotação usada | Moeda de negociação |
|---|---|---|---|
| Invesco EQQQ Nasdaq-100 UCITS ETF (Acc) | IE00BFZXGZ54 | EQAC.MI, Milão | EUR (fundo com exposição USD **sem cobertura cambial EUR**) |
| iShares S&P 500 EUR Hedged UCITS ETF (Acc) | IE00B3ZW0K18 | IBCF.DE, Xetra | EUR (**cobertura cambial EUR**) |
| iShares Core MSCI World UCITS ETF USD (Acc) | IE00B4L5Y983 | EUNL.DE, Xetra | EUR (fundo com exposição a moedas globais, não EUR hedged) |

**EUR de cotação não significa EUR hedged**. Os dois fundos não cobertos continuam a ter risco cambial. Não confundir Nasdaq-100 com Nasdaq Composite. Os índices de contexto não são preços dos fundos.

## Segurança e privacidade

A aplicação **não inclui os montantes da tua carteira nos ficheiros publicados**. O ficheiro `carteira_etfs_privada.json`, entregue à parte, é para importar no iPhone **e não deve ser carregado para o GitHub**. O browser guarda os valores e a simulação no `localStorage` do dispositivo. Isto protege-os da publicação direta, mas **não constitui um cofre cifrado**; limpar dados do browser apaga o registo, e quem tiver acesso ao dispositivo/perfil do browser poderá vê-los.

Não existem credenciais bancárias, ligação às corretoras, dinheiro real, ordens de bolsa, pagamentos ou chamadas automáticas a brokers. Verificar sempre ISIN, preço, spreads, custos, fiscalidade e liquidez na corretora antes de qualquer compra real.

## Publicar no GitHub Pages

1. Cria um repositório GitHub novo (por exemplo `radar-etfs`) e coloca os **ficheiros deste ZIP na raiz**, incluindo a pasta oculta `.github`.
2. **Não carregues** o ficheiro JSON separado da carteira privada.
3. Em **Settings > Pages**, escolhe **GitHub Actions** como origem de publicação.
4. Na aba **Actions**, executa **Atualizar cotações e publicar Radar ETFs > Run workflow** e verifica se a tarefa terminou com sucesso. Se a fonte não responder, a app mostrará ausência de dados em vez de criar sinais.
5. Abre o URL de publicação no **Safari** do iPhone e escolhe **Partilhar > Adicionar ao ecrã principal**.
6. Importa o `carteira_etfs_privada.json` pelo botão **Importar JSON privado**, ou edita os valores na app.

O workflow tenta atualizar o histórico em dias úteis após os mercados. **A simples existência do repositório não ativa cotações**; será necessário obter o histórico com sucesso. A biblioteca yfinance/Yahoo é **não oficial**, sujeita a falhas, alterações, limites e condições de utilização. Dados desatualizados bloqueiam entradas. Dados de bolsas europeias e americanas referem-se a fusos e fechos diferentes. Em produção, escolher uma fonte de cotações licenciada e fiável.

## Executar e testar no computador

```bash
python -m http.server 8000
# abrir http://localhost:8000
node scripts/test_engine.cjs
node --check app.js
# opcional, para obter cotações reais com acesso à internet
pip install -r requirements.txt
python scripts/update_market.py
```

Os testes `test_engine.cjs` utilizam **dados sintéticos apenas para testar o código**. Estes dados **não são apresentados como resultados de mercado**. O ficheiro `data/market.json` fornecido está vazio intencionalmente até ser atualizado por uma fonte real.

## Metodologia — e por que não é “quase infalível”

**Regime técnico**: vermelho se perda diária ≤ −3%, perda em cinco sessões ≤ −6% ou preço e MM50 abaixo de MM200; amarelo abaixo da MM200, após correção de 10% ou queda diária de 2%; verde com preço acima de MM200 e MM50 ≥ MM200. Candidato à **observação**: verde, 3–8% abaixo do pico recente e dois fechos de recuperação. Macro + concentração definem se uma *compra virtual* pode ser registada. A cor verde não equivale a recomendação de comprar.

**Comparação histórica**: investe 1.000 € por hipótese nas proporções da carteira importada, ou aplica o filtro adaptativo 100%/50%/0% para verde/amarelo/vermelho por ETF. Os sinais de **ontem** determinam a exposição negociada ao **fecho de hoje** (preço do fecho sem spread real; hipótese otimista). Há custo no movimento negociado, caixa sem juros e sem incidência fiscal. Uma estratégia com custos altos pode ficar muito pior do que o índice. A divisão 75%/25% é uma verificação adicional, não prova científica de superioridade.

**Ensaios históricos desejados**: 2020 (pandemia), 2022 (inflação/subida de juros), 2026 (tecnologia), e outros períodos abrangidos pelas cotações. Os ETFs específicos não têm todos série de cotação desde 2008; estudar 2008 exigiria índices/proxies explicitamente identificados e **nunca misturados** com resultados dos ETFs reais.

**Critérios de rejeição**: poucos períodos, grandes buracos na série, preços antigos, resultados sensíveis a uma só janela, subdesempenho sem redução material de risco, demasiadas transações, custos que consomem vantagem, risco elevado ou ausência de validação prospectiva. Antes de passar a dinheiro real é necessária observação em papel durante meses, com avaliação formal do erro e da evolução do saldo virtual.

**Fontes de investigação**:
- [AQR — A Century of Evidence on Trend-Following Investing](https://www.aqr.com/insights/research/journal-article/a-century-of-evidence-on-trend-following-investing) — evidência de tendências em múltiplas classes de ativos; não comprova esta regra específica de ETFs.
- [Vanguard — Staying the course](https://advisors.vanguard.com/insights/article/staying-the-course-does-not-mean-set-it-and-forget-it) — os melhores dias frequentemente surgem perto dos piores, complicando entradas/saídas.
- [US SEC — Investor Bulletin: Performance Claims](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47) — limitações de backtesting e seleção oportunista de históricos.
- [Invesco EQQQ Acc — emitente](https://www.invesco.com/be/en/financial-products/etfs/invesco-eqqq-nasdaq-100-ucits-etf-acc.html)
- [iShares S&P 500 EUR Hedged — emitente](https://www.ishares.com/uk/individual/en/products/251903/IUSE)
- [iShares Core MSCI World — emitente](https://www.ishares.com/uk/individual/en/products/251882/ISHARES_MSCI_WORLD_UCITS_ETF)

**Não existe taxa de acerto quase perfeita**. Acertar na cor do regime não equivale a gerar retorno líquido superior ou a conseguir antecipar um crash. Este protótipo ajuda a tomar decisões coerentes e a **evitar operações quando a evidência é insuficiente**; não substitui aconselhamento financeiro personalizado, verificação fiscal nem gestão da reserva do curso de piloto.
