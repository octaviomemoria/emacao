# Radar de Rompimentos

Aplicativo que rastreia quais ativos da B3 estão aptos à compra pela estratégia **Rompimento N / saída M, só comprado**
(padrão: compra quando o fechamento supera a maior máxima de fechamento dos 100 dias anteriores; vende quando cai abaixo da
menor mínima de 10 dias; ordens na abertura seguinte; 10% do patrimônio por posição, até 10 posições), simula a carteira
que "deveria estar aberta", acompanha as posições reais do usuário e envia alertas de compra, venda e dados suspeitos.

> Simulação histórica e sinais de uma regra de análise técnica. **Não é recomendação de investimento** e o app **nunca envia
> ordens**: confira preços e decida na sua corretora.

## Telas
| Tela | O que faz |
|---|---|
| **Hoje** | Comprar/vender na próxima abertura, resumo da simulação, alertas novos, botão "Atualizar agora" |
| **Radar** | Os ativos com estado, gatilho de compra, nível de saída, liquidez, avisos de dados; gráfico com canais |
| **Simulação** | Carteira simulada (posições, ordens pendentes, trades, curva vs CDI líquido e BOVA11); reiniciar a partir de uma data |
| **Carteira** | Suas compras/vendas reais, preço médio, divergências com a simulação, IR por mês (DARF) |
| **Alertas** | Caixa de mensagens (COMPRAR, VENDER, simulação encerrada, divergência, dado suspeito) |
| **Backtest** | Roda a regra com outros parâmetros sobre os preços salvos; tabela 2000–2026 da pesquisa em Python |
| **Config.** | Parâmetros, custos, IR, alertas, canais, lista de ativos, estado das chaves |

## Como funciona (resumo técnico)
- `lib/engine/signals.ts` — sinais (estado diário, gatilhos, liquidez, dados suspeitos).
- `lib/engine/simulation.ts` — carteira simulada dia a dia (espelha `bolsa/swing4.py::sim`).
- `lib/engine/real.ts` — posições reais por preço médio e IR mensal.
- `lib/jobs/daily.ts` — rotina: baixa preços (Yahoo) e CDI (Banco Central), calcula sinais, avança a simulação, cria alertas e notifica.
- `lib/store/` — armazenamento: arquivos locais (`STORE=file`) ou Supabase (`STORE=supabase`).
- `tests/parity/` — compara o motor com o backtest em Python (mesmos sinais, **mesmas 85 compras e vendas**, patrimônio final 0,01% de diferença).

Diferenças deliberadas em relação ao backtest em Python: compras em **ações inteiras** (a posição flutua); compras de ativos com
salto diário > 35% nos últimos N+10 pregões ficam **bloqueadas** (possível desdobramento/grupamento mal ajustado).

## Rodar no seu computador
```bash
npm install
cp .env.example .env.local        # STORE=file já é o padrão local
npm run dev                       # http://localhost:3000
```
Na tela **Hoje**, clique em "Fazer a primeira atualização". Testes: `npm test`. Rotina pelo terminal: `npm run daily`.

## Publicar na nuvem (Vercel + Supabase)
1. **Supabase**: crie um projeto e rode `supabase/migrations/0001_init.sql` (SQL Editor). As tabelas ficam com RLS ligada e sem
   políticas: só o servidor (chave `service_role`) acessa.
2. **Vercel**: importe o projeto. Em *Settings → Environment Variables* defina:
   `STORE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`
   (e os canais de alerta que for usar). O arquivo `vercel.json` já agenda a rotina noturna (21h30 UTC ≈ 18h30 BRT, após o
   fechamento) e o lembrete da manhã (12h30 UTC ≈ 09h30 BRT), em dias úteis.
3. Abra o site, entre com a senha, vá em **Hoje → Fazer a primeira atualização**.

### Alertas
- **Telegram**: crie um bot no `@BotFather`, coloque o token em `TELEGRAM_BOT_TOKEN`, mande uma mensagem ao bot, descubra seu *chat id*
  (por exemplo com o bot `@userinfobot`) e informe em **Config. → Canais**.
- **E-mail**: SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). No Gmail, use "senha de app".
- **Notificação no navegador/celular (inclui o Windows)**: `npm run vapid`, copie as chaves para as variáveis de ambiente e use
  **Config. → Ativar notificações neste dispositivo**. No celular, instale o app pela opção "Adicionar à tela inicial".
- Use **Config. → Enviar alerta de teste** para conferir cada canal.

## Limites conhecidos
- Fonte de preços: endpoint não oficial do Yahoo Finance. Se mudar ou limitar acessos, o provedor está isolado em `lib/providers/yahoo.ts`.
- O histórico guardado cobre cerca de 3 anos (configurável); o backtest completo 2000–2026 está na pesquisa em Python.
- Day trade (compra e venda do mesmo ativo no mesmo dia) tem IR de 20% e não é apurado aqui; o app apenas avisa.
- A estimativa de IR é só uma ajuda: confirme com seu contador.
