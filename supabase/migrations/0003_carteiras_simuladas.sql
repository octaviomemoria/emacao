-- Carteiras simuladas: várias carteiras de pregão, cada uma com capital e parâmetros próprios.
-- As ordens e execuções ganham o identificador da carteira. Registros anteriores ficam com 'pregao' (a carteira padrão).
-- A lista de carteiras e o estado de cada uma ficam na tabela kv (chaves "carteiras" e "pregao:<id>").

alter table pregao_orders add column if not exists portfolio_id text not null default 'pregao';
alter table pregao_fills add column if not exists portfolio_id text not null default 'pregao';

create index if not exists pregao_orders_portfolio_idx on pregao_orders (portfolio_id, status);
create index if not exists pregao_fills_portfolio_idx on pregao_fills (portfolio_id, date);
